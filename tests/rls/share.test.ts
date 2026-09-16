import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rlsEnv, seedLogins, seedPasswords } from './setup';

/**
 * The shared results link, pressed the way a stranger and the other brands would press it:
 * who can publish, what a client role can read of the row, how the password check fails,
 * when the link locks, and what the aggregates contain.
 */
const sql = postgres(rlsEnv.dbUrl, { max: 2 });
let owner: SupabaseClient;
let analyst: SupabaseClient;
let otherOwner: SupabaseClient;
let admin: SupabaseClient;
let campaignId = '';
const created: string[] = [];

async function login(brand: string, role: 'owner' | 'analyst') {
  const l = seedLogins().find((x) => x.brand === brand && x.role === role)!;
  const c = createClient(rlsEnv.url, rlsEnv.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c.auth.signInWithPassword({
    email: l.email,
    password: seedPasswords()[l.email],
  });
  if (error) throw new Error(`${l.email}: ${error.message}`);
  return c;
}

async function publish(password = 'correct horse battery') {
  const r = await owner.rpc('publish_results', {
    p_campaign_id: campaignId,
    p_password: password,
  });
  expect(r.error).toBeNull();
  const token = r.data as string;
  const [row] = await sql<{ id: string }[]>`
    select id from public.share_links where token_hash = encode(extensions.digest(${token}, 'sha256'), 'hex')`;
  created.push(row.id);
  return { token, id: row.id };
}

beforeAll(async () => {
  owner = await login('KAROO', 'owner');
  analyst = await login('KAROO', 'analyst');
  otherOwner = await login('KILELE', 'owner');
  admin = createClient(rlsEnv.url, rlsEnv.serviceKey, { auth: { persistSession: false } });
  const { data } = await owner
    .from('campaigns')
    .select('id')
    .eq('external_id', 'KAR-0001')
    .single();
  campaignId = data!.id;
});

afterAll(async () => {
  if (created.length) await sql`delete from public.share_links where id = any(${created})`;
  await sql.end();
});

describe('publishing', () => {
  it('an analyst cannot publish', async () => {
    const r = await analyst.rpc('publish_results', {
      p_campaign_id: campaignId,
      p_password: 'correct horse battery',
    });
    expect(r.error?.code).toBe('42501');
  });

  it("another brand's owner gets the same answer for a foreign id and a ghost id", async () => {
    const foreign = await otherOwner.rpc('publish_results', {
      p_campaign_id: campaignId,
      p_password: 'correct horse battery',
    });
    const ghost = await otherOwner.rpc('publish_results', {
      p_campaign_id: '00000000-0000-4000-8000-000000000000',
      p_password: 'correct horse battery',
    });
    expect(foreign.error?.code).toBe('42501');
    expect(ghost.error?.code).toBe(foreign.error?.code);
    expect(ghost.error?.message).toBe(foreign.error?.message);
  });

  it('a short password is refused before anything is stored', async () => {
    const before = await sql<{ n: number }[]>`select count(*)::int as n from public.share_links`;
    const r = await owner.rpc('publish_results', {
      p_campaign_id: campaignId,
      p_password: 'short',
    });
    expect(r.error).not.toBeNull();
    const after = await sql<{ n: number }[]>`select count(*)::int as n from public.share_links`;
    expect(after[0].n).toBe(before[0].n);
  });

  it('the owner gets a 64-hex token once and the row stores only hashes', async () => {
    const { token, id } = await publish();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const [row] = await sql<{ token_hash: string; password_hash: string }[]>`
      select token_hash, password_hash from public.share_links where id = ${id}`;
    expect(row.token_hash).not.toBe(token);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.password_hash).toMatch(/^\$2[aby]\$10\$/);
  });

  it('the owner can list the link but cannot read either hash; the other brand sees nothing', async () => {
    const { id } = await publish();
    const visible = await owner
      .from('share_links')
      .select('id, expires_at, revoked_at, failed_attempts')
      .eq('id', id);
    expect(visible.error).toBeNull();
    expect(visible.data).toHaveLength(1);
    const secret = await owner.from('share_links').select('id, token_hash').eq('id', id);
    expect(secret.error).not.toBeNull();
    const pw = await owner.from('share_links').select('password_hash').eq('id', id);
    expect(pw.error).not.toBeNull();
    const foreign = await otherOwner.from('share_links').select('id').eq('id', id);
    expect(foreign.error).toBeNull();
    expect(foreign.data).toEqual([]);
  });
});

describe('opening', () => {
  it('open_share_link and share_results are not callable by anon or a signed-in user', async () => {
    const anon = createClient(rlsEnv.url, rlsEnv.anonKey, { auth: { persistSession: false } });
    for (const c of [anon, owner]) {
      const a = await c.rpc('open_share_link', { p_token: 'x', p_password: 'y' });
      expect(a.error).not.toBeNull();
      const b = await c.rpc('share_results', { p_link_id: '00000000-0000-4000-8000-000000000000' });
      expect(b.error).not.toBeNull();
    }
  });

  it('the right password opens; the wrong one counts; an unknown token looks the same as a wrong password', async () => {
    const { token, id } = await publish();
    const wrong = await admin.rpc('open_share_link', {
      p_token: token,
      p_password: 'nope nope nope',
    });
    expect(wrong.error).toBeNull();
    expect(wrong.data?.[0]?.outcome).toBe('unavailable');
    const unknown = await admin.rpc('open_share_link', {
      p_token: 'f'.repeat(64),
      p_password: 'correct horse battery',
    });
    expect(unknown.data?.[0]).toEqual(wrong.data?.[0]);
    const [after] = await sql<{ failed_attempts: number }[]>`
      select failed_attempts from public.share_links where id = ${id}`;
    expect(after.failed_attempts).toBe(1);

    const right = await admin.rpc('open_share_link', {
      p_token: token,
      p_password: 'correct horse battery',
    });
    expect(right.error).toBeNull();
    expect(right.data?.[0]?.outcome).toBe('ok');
    expect(right.data?.[0]?.link_id).toBe(id);
    expect(right.data?.[0]?.campaign_id).toBe(campaignId);
    const [reset] = await sql<{ failed_attempts: number }[]>`
      select failed_attempts from public.share_links where id = ${id}`;
    expect(reset.failed_attempts).toBe(0);
  });

  it('ten wrong passwords lock the link, and the right password does not open it while locked', async () => {
    const { token, id } = await publish();
    for (let i = 0; i < 10; i++) {
      const r = await admin.rpc('open_share_link', { p_token: token, p_password: `wrong ${i}` });
      expect(r.data?.[0]?.outcome).toBe('unavailable');
    }
    const locked = await admin.rpc('open_share_link', {
      p_token: token,
      p_password: 'correct horse battery',
    });
    expect(locked.data?.[0]?.outcome).toBe('locked');
    const [row] = await sql<{ failed_attempts: number; locked_until: string | null }[]>`
      select failed_attempts, locked_until from public.share_links where id = ${id}`;
    expect(row.failed_attempts).toBe(10);
    expect(row.locked_until).not.toBeNull();
  });

  it('twelve parallel wrong passwords still lock at ten: the row is locked during the check', async () => {
    const { token, id } = await publish();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        admin.rpc('open_share_link', { p_token: token, p_password: `parallel wrong ${i}` }),
      ),
    );
    const outcomes = results.map((r) => r.data?.[0]?.outcome);
    expect(outcomes.filter((o) => o === 'unavailable')).toHaveLength(10);
    expect(outcomes.filter((o) => o === 'locked')).toHaveLength(2);
    const [row] = await sql<{ failed_attempts: number }[]>`
      select failed_attempts from public.share_links where id = ${id}`;
    expect(row.failed_attempts).toBe(10);
  });

  it('a revoked link is unavailable to open and to render, and only an owner can revoke', async () => {
    const { token, id } = await publish();
    const byAnalyst = await analyst.rpc('revoke_share_link', { p_link_id: id });
    expect(byAnalyst.error?.code).toBe('42501');
    const byOther = await otherOwner.rpc('revoke_share_link', { p_link_id: id });
    expect(byOther.error?.code).toBe('42501');
    const byOwner = await owner.rpc('revoke_share_link', { p_link_id: id });
    expect(byOwner.error).toBeNull();
    const open = await admin.rpc('open_share_link', {
      p_token: token,
      p_password: 'correct horse battery',
    });
    expect(open.data?.[0]?.outcome).toBe('unavailable');
    const render = await admin.rpc('share_results', { p_link_id: id });
    expect(render.error?.code).toBe('P0002');
  });

  it('share_results carries aggregates for that campaign only and no contact data', async () => {
    const { id } = await publish();
    const r = await admin.rpc('share_results', { p_link_id: id });
    expect(r.error).toBeNull();
    const d = r.data![0];
    expect(d.campaign_external_id).toBe('KAR-0001');
    expect(d.brand_name).toMatch(/Karoo/);
    const keys = Object.keys(d);
    for (const k of keys) expect(k).not.toMatch(/email|phone|first_name|last_name|contact/);
    const [expected] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.engagement_events e
      join public.campaigns c on c.id = e.campaign_id where c.external_id = 'KAR-0001'`;
    const logged = Object.values(d.log_events as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(logged).toBe(expected.n);
    expect(
      d.delivered +
        d.opened +
        d.clicked +
        d.bounced +
        d.complained +
        d.unsubscribed +
        d.rejected +
        d.pending,
    ).toBe(d.approved);
  });
});
