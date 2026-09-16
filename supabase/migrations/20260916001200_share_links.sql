-- Stage 6: password-protected shared results link.
--
-- publish_results   owner only, under the caller's identity: makes a share_links row with
--                   sha256(token) and bcrypt(password) and returns the plain token once.
-- revoke_share_link owner only: ends a link.
-- open_share_link   service_role only: the /share route hands over the token and the typed
--                   password; failures count, ten in a row lock the link for fifteen minutes.
-- share_results     service_role only: aggregates for one verified link. Nothing in it is a
--                   contact row; the page cannot ask for anything else.
--
-- Unknown, expired, revoked links and wrong passwords all come back as 'unavailable'; a locked
-- link says 'locked' because the viewer needs to know to wait. The lock is checked before the
-- password so a wrong password on a locked link stays locked.

create or replace function public.publish_results(p_campaign_id uuid, p_password text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_brand uuid;
  v_token text;
begin
  select brand_id into v_brand from public.campaigns where id = p_campaign_id;
  if v_brand is null or not app.is_owner_of(v_brand) then
    raise exception 'not permitted: only an owner of the campaign''s brand can share its results'
      using errcode = '42501';
  end if;
  if p_password is null or length(p_password) < 8 or length(p_password) > 128 then
    raise exception 'password must be 8 to 128 characters' using errcode = '22023';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.share_links (brand_id, campaign_id, token_hash, password_hash, created_by, expires_at)
  values (
    v_brand, p_campaign_id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
    auth.uid(),
    now() + interval '30 days'
  );
  return v_token;
end $$;
revoke all on function public.publish_results(uuid, text) from public, anon;
grant execute on function public.publish_results(uuid, text) to authenticated;

create or replace function public.revoke_share_link(p_link_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_brand uuid;
begin
  select brand_id into v_brand from public.share_links where id = p_link_id;
  if v_brand is null or not app.is_owner_of(v_brand) then
    raise exception 'not permitted: only an owner of the link''s brand can revoke it'
      using errcode = '42501';
  end if;
  update public.share_links set revoked_at = coalesce(revoked_at, now()) where id = p_link_id;
end $$;
revoke all on function public.revoke_share_link(uuid) from public, anon;
grant execute on function public.revoke_share_link(uuid) to authenticated;

create or replace function public.open_share_link(p_token text, p_password text)
returns table (outcome text, link_id uuid, campaign_id uuid, brand_id uuid, expires_at timestamptz)
language plpgsql security definer
set search_path = public
as $$
declare
  l public.share_links%rowtype;
begin
  -- Outcomes are returned, not raised: a raise would roll back the attempt count with it.
  -- FOR UPDATE: parallel wrong passwords queue on the row, so the tenth really is the tenth.
  select * into l from public.share_links
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
  for update;
  if l.id is null or l.revoked_at is not null or l.expires_at <= now() then
    return query select 'unavailable'::text, null::uuid, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;
  if l.locked_until is not null and l.locked_until > now() then
    return query select 'locked'::text, null::uuid, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;

  if l.password_hash <> extensions.crypt(coalesce(p_password, ''), l.password_hash) then
    update public.share_links
    set failed_attempts = share_links.failed_attempts + 1,
        locked_until = case when share_links.failed_attempts + 1 >= 10
                            then now() + interval '15 minutes' else null end
    where id = l.id;
    return query select 'unavailable'::text, null::uuid, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;

  update public.share_links set failed_attempts = 0, locked_until = null where id = l.id;
  return query select 'ok'::text, l.id, l.campaign_id, l.brand_id, l.expires_at;
end $$;
revoke all on function public.open_share_link(text, text) from public, anon, authenticated;
grant execute on function public.open_share_link(text, text) to service_role;

drop function if exists public.share_results(uuid);
create function public.share_results(p_link_id uuid)
returns table (
  brand_name text,
  campaign_external_id text,
  campaign_name text,
  channel text,
  expires_at timestamptz,
  sends integer,
  approved integer,
  delivered integer,
  opened integer,
  clicked integer,
  bounced integer,
  complained integer,
  unsubscribed integer,
  rejected integer,
  pending integer,
  last_dispatched_at timestamptz,
  log_events jsonb
)
language plpgsql security definer
set search_path = public
as $$
declare
  l public.share_links%rowtype;
begin
  select * into l from public.share_links where id = p_link_id;
  if l.id is null or l.revoked_at is not null or l.expires_at <= now() then
    raise exception 'unavailable' using errcode = 'P0002';
  end if;
  return query
  with s as (
    select id, approved_count, dispatched_at from public.sends
    where campaign_id = l.campaign_id and brand_id = l.brand_id and status = 'dispatched'
  ), r as (
    select r.status from public.send_recipients r join s on s.id = r.send_id
  )
  select
    b.name, c.external_id, c.name, c.channel::text, l.expires_at,
    (select count(*)::int from s),
    (select coalesce(sum(approved_count), 0)::int from s),
    (select count(*)::int from r where status = 'delivered'),
    (select count(*)::int from r where status = 'opened'),
    (select count(*)::int from r where status = 'clicked'),
    (select count(*)::int from r where status = 'bounced'),
    (select count(*)::int from r where status = 'complained'),
    (select count(*)::int from r where status = 'unsubscribed'),
    (select count(*)::int from r where status = 'rejected'),
    (select count(*)::int from r where status in ('queued', 'accepted')),
    (select max(dispatched_at) from s),
    (select coalesce(jsonb_object_agg(t, n), '{}'::jsonb) from (
       select event_type::text as t, count(*)::int as n from public.engagement_events
       where brand_id = l.brand_id and campaign_id = l.campaign_id group by 1) x)
  from public.campaigns c join public.brands b on b.id = c.brand_id
  where c.id = l.campaign_id;
end $$;
revoke all on function public.share_results(uuid) from public, anon, authenticated;
grant execute on function public.share_results(uuid) to service_role;
