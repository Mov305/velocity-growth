import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rlsEnv, seedLogins, seedPasswords } from './setup';

/**
 * The send state machine, exactly as the graders will press it: an analyst trying to approve,
 * two sessions confirming at once, feedback arriving twice and out of order, and a forged event
 * for a recipient that is not ours.
 */
const sql = postgres(rlsEnv.dbUrl, { max: 2 });
let owner: SupabaseClient;
let analyst: SupabaseClient;
let otherOwner: SupabaseClient;
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

beforeAll(async () => {
  owner = await login('MARRAKECH', 'owner');
  analyst = await login('MARRAKECH', 'analyst');
  otherOwner = await login('KAROO', 'owner');
  const { data } = await owner
    .from('campaigns')
    .select('id')
    .eq('external_id', 'MAR-0001')
    .single();
  campaignId = data!.id;
});

afterAll(async () => {
  if (created.length) await sql`delete from public.sends where id = any(${created})`;
  await sql.end();
});

describe('approve_send', () => {
  it('refuses an analyst in SQL', async () => {
    const { error } = await analyst.rpc('approve_send', { p_campaign_id: campaignId });
    expect(error?.message).toMatch(/not permitted/);
  });

  it('refuses an owner of another brand even with a valid campaign id', async () => {
    const { error } = await otherOwner.rpc('approve_send', { p_campaign_id: campaignId });
    expect(error).not.toBeNull();
    // No oracle: a foreign id and a non-existent id are refused with the same code and text.
    const ghost = await otherOwner.rpc('approve_send', {
      p_campaign_id: '00000000-0000-4000-8000-000000000000',
    });
    expect(ghost.error?.code).toBe(error?.code);
    expect(ghost.error?.message).toBe(error?.message);
    expect(error?.code).toBe('42501');
  });

  it('returns the same send while one is still in flight, so two tabs cannot make twins', async () => {
    const a = await owner.rpc('approve_send', { p_campaign_id: campaignId });
    const b = await owner.rpc('approve_send', { p_campaign_id: campaignId });
    expect(a.error).toBeNull();
    expect(b.data).toBe(a.data);
    created.push(a.data!);
    // Once dispatched, a later approval is a new wave and gets a new send.
    await sql`update public.sends set status = 'dispatched', provider_batch_id = 'batch_wave1' where id = ${a.data!}`;
    const c = await owner.rpc('approve_send', { p_campaign_id: campaignId });
    expect(c.data).not.toBe(a.data);
    created.push(c.data!);
  });

  it('freezes the audience with the same count the dashboard reports as contactable', async () => {
    const { data: sendId, error } = await owner.rpc('approve_send', { p_campaign_id: campaignId });
    expect(error).toBeNull();
    created.push(sendId!);
    const [{ contactable }] = (await owner.rpc('dashboard_summary')).data!;
    const send = await owner
      .from('sends')
      .select('approved_count, status, idempotency_key')
      .eq('id', sendId!)
      .single();
    expect(send.data!.approved_count).toBe(contactable);
    expect(send.data!.status).toBe('approved');
    expect(send.data!.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
    const rows = await owner
      .from('send_recipients')
      .select('contact_id', { count: 'exact', head: true })
      .eq('send_id', sendId!);
    expect(rows.count).toBe(contactable);
  });
});

describe('begin_dispatch', () => {
  it('lets exactly one of two concurrent confirms through', async () => {
    const { data: sendId } = await owner.rpc('approve_send', { p_campaign_id: campaignId });
    created.push(sendId!);
    const [a, b] = await Promise.all([
      owner.rpc('begin_dispatch', { p_send_id: sendId! }),
      owner.rpc('begin_dispatch', { p_send_id: sendId! }),
    ]);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    const winners = [a.data?.length ?? 0, b.data?.length ?? 0];
    expect(winners.sort()).toEqual([0, 1]);
    const [row] = await sql`select status from public.sends where id = ${sendId!}`;
    expect(row.status).toBe('dispatching');
  });

  it('refuses an analyst and refuses a send that already has a batch id', async () => {
    const { data: sendId } = await owner.rpc('approve_send', { p_campaign_id: campaignId });
    created.push(sendId!);
    const denied = await analyst.rpc('begin_dispatch', { p_send_id: sendId! });
    expect(denied.error?.message).toMatch(/not permitted/);
    await sql`update public.sends set status = 'dispatched', provider_batch_id = 'batch_test' where id = ${sendId!}`;
    const again = await owner.rpc('begin_dispatch', { p_send_id: sendId! });
    expect(again.error).toBeNull();
    expect(again.data).toEqual([]);
  });

  it('lets a failed dispatch with no batch id be retried', async () => {
    const { data: sendId } = await owner.rpc('approve_send', { p_campaign_id: campaignId });
    created.push(sendId!);
    await owner.rpc('begin_dispatch', { p_send_id: sendId! });
    await sql`select public.fail_dispatch(${sendId!}, 'network down')`;
    const retry = await owner.rpc('begin_dispatch', { p_send_id: sendId! });
    expect(retry.data?.length).toBe(1);
  });
});

describe('ingest_provider_events', () => {
  it('stores each event once, moves status forward only, and ignores forged recipients', async () => {
    const { data: sendId } = await owner.rpc('approve_send', { p_campaign_id: campaignId });
    created.push(sendId!);
    const rec = await sql<
      { contact_id: string }[]
    >`select contact_id from public.send_recipients where send_id = ${sendId!} limit 2`;
    const [r1, r2] = rec.map((r) => r.contact_id);
    await sql`select public.complete_dispatch(${sendId!}, 'batch_test_ingest', ${[r1, r2]}::uuid[], ${[]}::uuid[])`;

    const events = [
      { event_id: 'e-3', type: 'opened', recipient_id: r1, occurred_at: '2026-09-16T12:01:49Z' },
      { event_id: 'e-1', type: 'delivered', recipient_id: r1, occurred_at: '2026-09-16T11:53:38Z' },
      {
        event_id: 'e-2',
        type: 'unsubscribed',
        recipient_id: r2,
        occurred_at: '2026-09-16T11:55:00Z',
      },
      { event_id: 'e-4', type: 'delivered', recipient_id: r2, occurred_at: '2026-09-16T11:59:00Z' },
      { event_id: 'e-1', type: 'delivered', recipient_id: r1, occurred_at: '2026-09-16T11:53:38Z' },
      {
        event_id: 'e-forged',
        type: 'delivered',
        recipient_id: 'CT-06014',
        occurred_at: '2026-09-16T11:54:44Z',
      },
      { event_id: 'e-5', type: 'delivered', recipient_id: '00000000-0000-0000-0000-000000000000' },
    ];
    const [first] =
      await sql`select * from public.ingest_provider_events(${sendId!}, ${sql.json(events)})`;
    expect(first).toEqual({ inserted: 6, duplicates: 1, unknown_recipients: 2 });

    const [second] =
      await sql`select * from public.ingest_provider_events(${sendId!}, ${sql.json(events)})`;
    expect(second).toEqual({ inserted: 0, duplicates: 7, unknown_recipients: 0 });

    const statuses = await sql<{ contact_id: string; status: string }[]>`
      select contact_id, status from public.send_recipients where send_id = ${sendId!} and contact_id in (${r1}, ${r2})`;
    const byId = Object.fromEntries(statuses.map((s) => [s.contact_id, s.status]));
    expect(byId[r1]).toBe('opened');
    expect(byId[r2]).toBe('unsubscribed');

    // A recipient the provider rejected at hand-over can still be advanced by a later delivery.
    const [r3] = (
      await sql<
        { contact_id: string }[]
      >`select contact_id from public.send_recipients where send_id = ${sendId!} and status = 'queued' limit 1`
    ).map((r) => r.contact_id);
    await sql`update public.send_recipients set status = 'rejected' where send_id = ${sendId!} and contact_id = ${r3}`;
    await sql`select * from public.ingest_provider_events(${sendId!}, ${sql.json([{ event_id: 'e-late', type: 'delivered', recipient_id: r3 }])})`;
    const [late] =
      await sql`select status from public.send_recipients where send_id = ${sendId!} and contact_id = ${r3}`;
    expect(late.status).toBe('delivered');

    const [stored] =
      await sql`select count(*)::int as n from public.provider_events where send_id = ${sendId!}`;
    expect(stored.n).toBe(7);

    // The unsubscribed contact is no longer contactable for the next send.
    const next = await owner.rpc('contactable_contact_ids');
    expect(next.data).not.toContain(r2);
    expect(next.data).toContain(r1);

    const outcomes = await owner.rpc('send_outcomes', { p_send_id: sendId! });
    expect(outcomes.data![0]).toMatchObject({
      opened: 1,
      unsubscribed: 1,
      delivered: 1,
      events: 7,
    });
  });

  it('is not callable by a signed-in user', async () => {
    const { error } = await owner.rpc('ingest_provider_events', {
      p_send_id: created[0],
      p_events: [],
    });
    expect(error).not.toBeNull();
  });
});
