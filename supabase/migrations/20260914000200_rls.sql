-- THE ISOLATION GUARANTEE LIVES IN THIS FILE.
--
-- Every table in public: RLS enabled and FORCED, so even the table owner is not exempt.
-- Every tenant table: one select policy comparing brand_id to the caller's memberships.
-- No insert, update or delete policy exists for any client role; writes only happen through
-- security definer functions added in later migrations, each of which re-checks membership.
-- anon is granted nothing at all.
--
-- tests/rls/catalog.test.ts fails if any public table loses forced RLS or any brand_id table
-- loses its policy. tests/rls/isolation.test.ts fails if any policy stops filtering.

-- Helpers ---------------------------------------------------------------------
-- security definer so the memberships lookup is not itself subject to RLS recursion.
create or replace function app.user_brand_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select m.brand_id from public.memberships m where m.user_id = auth.uid()
$$;

create or replace function app.is_owner_of(p_brand_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.brand_id = p_brand_id and m.role = 'owner'
  )
$$;

revoke all on function app.user_brand_ids() from public;
revoke all on function app.is_owner_of(uuid) from public;
grant execute on function app.user_brand_ids() to authenticated;
grant execute on function app.is_owner_of(uuid) to authenticated;

-- Grants ----------------------------------------------------------------------
-- Supabase grants anon and authenticated broad table privileges by default. Take them away.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
-- Future tables created by the postgres role get no client privileges either.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;

grant usage on schema app to authenticated;

grant select on
  public.brands,
  public.memberships,
  public.imports,
  public.import_rejects,
  public.contacts,
  public.campaigns,
  public.engagement_events,
  public.send_log_entries,
  public.sends,
  public.send_recipients,
  public.provider_events
to authenticated;
-- share_links: column-level grant. token_hash and password_hash never leave the server;
-- only the /share route handler (service role) reads them. Clients must name their columns.
grant select (id, brand_id, campaign_id, created_by, created_at, expires_at, revoked_at, failed_attempts, locked_until)
  on public.share_links to authenticated;
-- allowed_emails: deliberately no grant to any client role.

-- Enable and force ------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- Policies --------------------------------------------------------------------
create policy brands_select_member on public.brands
  for select to authenticated
  using (id in (select app.user_brand_ids()));

create policy memberships_select_self on public.memberships
  for select to authenticated
  using (user_id = auth.uid());

-- allowed_emails: RLS on, no policy, no grant. Nothing gets through.

do $$
declare t text;
begin
  for t in
    select unnest(array[
      'imports', 'import_rejects', 'contacts', 'campaigns', 'engagement_events',
      'send_log_entries', 'sends', 'send_recipients', 'provider_events', 'share_links'
    ])
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (brand_id in (select app.user_brand_ids()))',
      t || '_select_own_brand', t
    );
  end loop;
end $$;
