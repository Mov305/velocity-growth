import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { rlsEnv } from './setup';

/**
 * Reads the Postgres catalog directly. If anyone removes forced RLS from a table, drops a policy,
 * grants anon a privilege, or adds a view without security_invoker, this file fails.
 */
const sql = postgres(rlsEnv.dbUrl, { max: 1 });
afterAll(() => sql.end());

type TableRow = {
  relname: string;
  rls: boolean;
  forced: boolean;
  policy_count: number;
  has_brand_id: boolean;
};

describe('RLS catalog: the isolation guarantee cannot be removed without this failing', () => {
  it('every table in public has RLS enabled and forced', async () => {
    const rows = await sql<TableRow[]>`
      select c.relname,
             c.relrowsecurity as rls,
             c.relforcerowsecurity as forced,
             (select count(*)::int from pg_policies p
               where p.schemaname = 'public' and p.tablename = c.relname) as policy_count,
             exists (select 1 from pg_attribute a
               where a.attrelid = c.oid and a.attname = 'brand_id' and not a.attisdropped) as has_brand_id
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname`;
    expect(rows.length).toBeGreaterThanOrEqual(13);
    const unprotected = rows.filter((r) => !r.rls || !r.forced).map((r) => r.relname);
    expect(unprotected, 'tables without forced RLS').toEqual([]);
  });

  it('every brand_id table a client role can reach has a policy; the rest have no grants at all', async () => {
    const rows = await sql<{ relname: string; policy_count: number; client_grants: number }[]>`
      select c.relname,
             (select count(*)::int from pg_policies p
               where p.schemaname = 'public' and p.tablename = c.relname) as policy_count,
             (select count(*)::int from information_schema.role_table_grants g
               where g.table_schema = 'public' and g.table_name = c.relname
                 and g.grantee in ('anon', 'authenticated')) as client_grants
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and exists (select 1 from pg_attribute a
              where a.attrelid = c.oid and a.attname = 'brand_id' and not a.attisdropped)
      order by c.relname`;
    expect(rows.length).toBeGreaterThanOrEqual(11);
    const reachableWithoutPolicy = rows
      .filter((r) => r.client_grants > 0 && r.policy_count === 0)
      .map((r) => r.relname);
    expect(reachableWithoutPolicy, 'brand_id tables reachable by clients with no policy').toEqual(
      [],
    );
    // Deny-all tables are allowed only if they really are deny-all.
    const denyAll = rows.filter((r) => r.policy_count === 0).map((r) => r.relname);
    expect(denyAll, 'tables relying on deny-all must be exactly this list').toEqual([
      'allowed_emails',
    ]);
  });

  it('anon has no privileges on any public table', async () => {
    const rows = await sql<{ table_name: string; privilege_type: string }[]>`
      select table_name, privilege_type from information_schema.role_table_grants
      where grantee = 'anon' and table_schema = 'public'`;
    expect(rows).toEqual([]);
  });

  it('authenticated cannot write any public table directly', async () => {
    const rows = await sql<{ table_name: string; privilege_type: string }[]>`
      select table_name, privilege_type from information_schema.role_table_grants
      where grantee = 'authenticated' and table_schema = 'public'
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')`;
    expect(rows).toEqual([]);
  });

  it('allowed_emails is readable by no client role', async () => {
    const rows = await sql<{ grantee: string }[]>`
      select grantee from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'allowed_emails'
        and grantee in ('anon', 'authenticated')`;
    expect(rows).toEqual([]);
  });

  it('share_links secrets are not readable by any client role', async () => {
    const rows = await sql<{ grantee: string; column_name: string }[]>`
      select grantee, column_name from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'share_links'
        and grantee in ('anon', 'authenticated')
        and column_name in ('token_hash', 'password_hash')`;
    expect(rows).toEqual([]);
  });

  it('the app helper schema is not exposed through the API', async () => {
    // PostgREST reads exposed schemas from its config; the local stack mirrors config.toml.
    // Guard the config file itself so the setting cannot drift back.
    const { readFileSync } = await import('node:fs');
    const toml = readFileSync('supabase/config.toml', 'utf8');
    const line = toml.split(/\r?\n/).find((l) => l.startsWith('schemas = '));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/"app"/);
  });

  it('definer functions the server calls are not executable by client roles', async () => {
    const rows = await sql<{ routine_name: string; grantee: string }[]>`
      select r.routine_name, r.grantee from information_schema.routine_privileges r
      join pg_proc p on p.proname = r.routine_name
      join pg_namespace n on n.oid = p.pronamespace and n.nspname = r.routine_schema
      where r.routine_schema = 'public' and p.prosecdef
        and r.grantee in ('anon', 'authenticated', 'PUBLIC')
        and r.routine_name in ('complete_dispatch', 'fail_dispatch', 'ingest_provider_events')`;
    expect(rows).toEqual([]);
  });

  it('every view in public runs with security_invoker', async () => {
    const rows = await sql<{ relname: string; invoker: boolean }[]>`
      select c.relname,
             coalesce(array_to_string(c.reloptions, ',') like '%security_invoker=true%', false) as invoker
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'v'`;
    expect(rows.filter((r) => !r.invoker)).toEqual([]);
  });
});
