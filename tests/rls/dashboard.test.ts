import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rlsEnv, seedLogins, seedPasswords } from './setup';

/**
 * The dashboard functions are security invoker, so RLS decides the brand. Each brand's user must
 * get exactly the numbers the service role computes for that brand alone, and the four counts
 * must add up. Runs against whatever data is loaded; with the full seed the numbers are large.
 */
const sql = postgres(rlsEnv.dbUrl, { max: 1 });
const sessions: Array<{ brand: string; client: SupabaseClient }> = [];

beforeAll(async () => {
  const passwords = seedPasswords();
  for (const l of seedLogins().filter((l) => l.role === 'analyst')) {
    const client = createClient(rlsEnv.url, rlsEnv.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.auth.signInWithPassword({
      email: l.email,
      password: passwords[l.email],
    });
    if (error) throw new Error(`sign in ${l.email}: ${error.message}`);
    sessions.push({ brand: l.brand, client });
  }
});

afterAll(() => sql.end());

describe('dashboard functions run as the caller', () => {
  it('every dashboard function is security invoker', async () => {
    const rows = await sql<{ proname: string; prosecdef: boolean }[]>`
      select p.proname, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('contact_is_contactable', 'dashboard_summary', 'signups_last_30_days', 'campaign_performance', 'contactable_contact_ids')`;
    expect(rows).toHaveLength(5);
    expect(rows.filter((r) => r.prosecdef).map((r) => r.proname)).toEqual([]);
  });

  it('anon cannot execute them', async () => {
    const rows = await sql<{ routine_name: string }[]>`
      select routine_name from information_schema.routine_privileges
      where grantee = 'anon' and routine_schema = 'public'`;
    expect(rows).toEqual([]);
  });

  it('dashboard_summary matches a service-role count per brand and adds up', async () => {
    for (const s of sessions) {
      const { data, error } = await s.client.rpc('dashboard_summary');
      expect(error, `${s.brand} summary`).toBeNull();
      const row = data![0];
      // Reference computed independently, set-based, as the superuser (no RLS): the brand filter
      // is explicit here where the function relies on RLS.
      const [truth] = await sql<{ total: number; deleted: number; contactable: number }[]>`
        with excluded as (
          select e.contact_id from public.engagement_events e join public.brands eb on eb.id = e.brand_id
          where eb.code = ${s.brand} and e.event_type in ('bounce','complaint','unsubscribe')
          union
          select r.contact_id from public.send_recipients r join public.brands rb on rb.id = r.brand_id
          where rb.code = ${s.brand} and r.status in ('bounced','complained','unsubscribed')
        )
        select count(*) filter (where c.deleted_at is null)::int as total,
               count(*) filter (where c.deleted_at is not null)::int as deleted,
               count(*) filter (where c.deleted_at is null and c.status = 'active' and c.consent_marketing
                 and (c.suppressed_until is null or c.suppressed_until < now())
                 and (c.email is not null or c.phone is not null)
                 and c.id not in (select contact_id from excluded))::int as contactable
        from public.contacts c join public.brands b on b.id = c.brand_id where b.code = ${s.brand}`;
      expect(row.total_customers, `${s.brand} total`).toBe(truth.total);
      expect(row.deleted_customers).toBe(truth.deleted);
      expect(row.contactable).toBe(truth.contactable);
      expect(row.not_contactable).toBe(truth.total - truth.contactable);
      expect(row.contactable_definition).toMatch(/consent given/);
    }
  });

  it('signups_last_30_days returns exactly 30 zero-filled days ending today', async () => {
    for (const s of sessions) {
      const { data, error } = await s.client.rpc('signups_last_30_days');
      expect(error).toBeNull();
      expect(data).toHaveLength(30);
      const last = new Date(data![29].day);
      const today = new Date();
      expect(last.toISOString().slice(0, 10)).toBe(today.toISOString().slice(0, 10));
      for (const d of data!) expect(d.signups).toBeGreaterThanOrEqual(0);
    }
  });

  it('campaign_performance lists only the caller brand campaigns with observed unique contacts', async () => {
    for (const s of sessions) {
      const { data, error } = await s.client.rpc('campaign_performance');
      expect(error).toBeNull();
      const [truth] = await sql<{ n: number }[]>`
        select count(*)::int as n from public.campaigns c join public.brands b on b.id = c.brand_id where b.code = ${s.brand}`;
      expect(data!.length, `${s.brand} campaign count`).toBe(truth.n);
      for (const c of data!) {
        expect(c.observed_opened).toBeLessThanOrEqual(c.observed_contacts);
        expect(c.observed_contacts).toBeLessThanOrEqual(c.observed_events);
      }
    }
  });
});
