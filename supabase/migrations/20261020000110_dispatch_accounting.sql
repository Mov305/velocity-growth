-- Review fixes to the send path, 2026-10-20.
--
-- 1. Every recipient of a recorded batch ends in a named state. The provider's answer is checked
--    against the chunk that was posted: recipients it named neither accepted nor rejected become
--    'unaccounted' instead of staying 'queued' for ever, and each batch stores how many there were.
--    Rejections the provider gave without an id of this chunk (an unknown shape, or an id that is
--    not ours) are counted per batch as unidentified_rejections. The database enforces
--    accepted + rejected + unaccounted = submitted on every batch row.
-- 2. The audience frozen at approval is re-checked at hand-over. withhold_uncontactable marks every
--    still-queued recipient who is no longer in contactable_contact_ids() as 'withheld', with a
--    reason label. approved_count does not change; send_outcomes and share_results carry the
--    withheld count so the rows still add up to it.
-- 3. complete_dispatch refuses to mark a send dispatched while any recipient is still 'queued'.

alter table public.send_recipients add column withheld_reason text;
alter table public.send_recipients
  add constraint send_recipients_withheld_reason_chk
  check ((status = 'withheld') = (withheld_reason is not null));

alter table public.send_batches
  add column submitted_count integer,
  add column unaccounted_count integer not null default 0 check (unaccounted_count >= 0),
  add column unidentified_rejections integer not null default 0 check (unidentified_rejections >= 0);
-- Batches recorded before this migration stored only accepted and rejected; that is all that is
-- known about them, so submitted is their sum.
update public.send_batches set submitted_count = accepted_count + rejected_count;
alter table public.send_batches alter column submitted_count set not null;
alter table public.send_batches
  add constraint send_batches_accounted_chk
  check (accepted_count + rejected_count + unaccounted_count = submitted_count);

-- record_send_batch --------------------------------------------------------------------------
drop function if exists public.record_send_batch(uuid, integer, text, text, uuid[], uuid[], jsonb);
create function public.record_send_batch(
  p_send_id uuid, p_chunk_index integer, p_idempotency_key text, p_batch_id text,
  p_members uuid[], p_accepted uuid[], p_rejected uuid[], p_reasons jsonb,
  p_unidentified_rejections integer
)
returns table (accepted integer, rejected integer, unaccounted integer, submitted integer)
language plpgsql security definer
set search_path = public
as $$
declare
  v_brand uuid;
  v_members integer;
  v_known integer;
  v_acc integer;
  v_rej integer;
  v_una integer;
begin
  select brand_id into v_brand from public.sends where id = p_send_id and status = 'dispatching';
  if v_brand is null then
    raise exception 'send is not dispatching' using errcode = 'P0002';
  end if;
  if p_unidentified_rejections is null or p_unidentified_rejections < 0 then
    raise exception 'unidentified rejections must be a non-negative count' using errcode = '22023';
  end if;

  -- Already recorded (a takeover raced the original run): report what was stored, change nothing.
  if exists (select 1 from public.send_batches b where b.send_id = p_send_id and b.chunk_index = p_chunk_index) then
    return query
      select b.accepted_count, b.rejected_count, b.unaccounted_count, b.submitted_count
      from public.send_batches b where b.send_id = p_send_id and b.chunk_index = p_chunk_index;
    return;
  end if;

  -- The chunk must be recipients of this send, every one of them.
  select count(distinct m) into v_members from unnest(p_members) m;
  select count(*) into v_known from public.send_recipients r
  where r.send_id = p_send_id and r.contact_id = any(p_members);
  if v_members = 0 or v_known <> v_members then
    raise exception 'chunk % names % recipients, % of them in this send', p_chunk_index, v_members, v_known
      using errcode = '22023';
  end if;

  -- Accepted wins over rejected if the provider names someone in both. A recipient withheld at
  -- this hand-over whom the provider still reports accepted (the idempotency key replayed a batch
  -- an earlier run posted) did reach the provider, so the provider's answer is what is stored.
  update public.send_recipients r set status = 'accepted', withheld_reason = null
  where r.send_id = p_send_id and r.contact_id = any(p_members) and r.contact_id = any(p_accepted)
    and r.status in ('queued', 'withheld');
  update public.send_recipients r set status = 'rejected'
  where r.send_id = p_send_id and r.contact_id = any(p_members) and r.contact_id = any(p_rejected)
    and r.status = 'queued';
  -- Posted, and named in neither list: never left queued, never re-posted.
  update public.send_recipients r set status = 'unaccounted'
  where r.send_id = p_send_id and r.contact_id = any(p_members) and r.status = 'queued';

  select count(*) filter (where r.status = 'accepted')::int,
         count(*) filter (where r.status = 'rejected')::int,
         count(*) filter (where r.status = 'unaccounted')::int
  into v_acc, v_rej, v_una
  from public.send_recipients r where r.send_id = p_send_id and r.contact_id = any(p_members);

  insert into public.send_batches (
    send_id, brand_id, chunk_index, idempotency_key, provider_batch_id,
    accepted_count, rejected_count, unaccounted_count, submitted_count,
    unidentified_rejections, rejection_reasons
  )
  values (
    p_send_id, v_brand, p_chunk_index, p_idempotency_key, p_batch_id,
    v_acc, v_rej, v_una, v_acc + v_rej + v_una,
    p_unidentified_rejections, coalesce(p_reasons, '{}'::jsonb)
  );
  return query select v_acc, v_rej, v_una, v_acc + v_rej + v_una;
end $$;
revoke all on function public.record_send_batch(uuid, integer, text, text, uuid[], uuid[], uuid[], jsonb, integer) from public, anon, authenticated;
grant execute on function public.record_send_batch(uuid, integer, text, text, uuid[], uuid[], uuid[], jsonb, integer) to service_role;

-- withhold_uncontactable ---------------------------------------------------------------------
-- Whether a recipient is withheld is decided by contactable_contact_ids(), the one definition of
-- contactable. The reason is a label for the marketer only, picked from the contact row; it does
-- not decide anything, and 'no longer contactable' covers any case the labels do not name.
create function public.withhold_uncontactable(p_send_id uuid)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_brand uuid;
  v_count integer;
begin
  select brand_id into v_brand from public.sends where id = p_send_id and status = 'dispatching';
  if v_brand is null then
    raise exception 'send is not dispatching' using errcode = 'P0002';
  end if;

  update public.send_recipients r
  set status = 'withheld',
      withheld_reason = coalesce((
        select case
          when ct.deleted_at is not null then 'deleted'
          when ct.status in ('unsubscribed', 'bounced')
            or exists (select 1 from public.engagement_events e
                       where e.contact_id = ct.id and e.event_type in ('bounce', 'complaint', 'unsubscribe'))
            or exists (select 1 from public.send_recipients x
                       where x.contact_id = ct.id and x.status in ('bounced', 'complained', 'unsubscribed'))
            then 'unsubscribed, bounced or complained'
          when not ct.consent_marketing then 'consent withdrawn'
          when ct.suppressed_until is not null and ct.suppressed_until >= now() then 'suppressed'
          when ct.status <> 'active' then 'status no longer active'
          when ct.email is null and ct.phone is null then 'no email or phone'
          else 'no longer contactable'
        end
        from public.contacts ct where ct.id = r.contact_id
      ), 'no longer contactable')
  where r.send_id = p_send_id
    and r.status = 'queued'
    and not exists (select 1 from public.contactable_contact_ids() c where c = r.contact_id);
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.withhold_uncontactable(uuid) from public, anon, authenticated;
grant execute on function public.withhold_uncontactable(uuid) to service_role;

-- complete_dispatch --------------------------------------------------------------------------
create or replace function public.complete_dispatch(p_send_id uuid, p_expected_batches integer)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_first text;
  v_accepted integer;
  v_rejected integer;
  v_batches integer;
  v_queued integer;
begin
  select count(*)::int, coalesce(sum(accepted_count), 0)::int, coalesce(sum(rejected_count), 0)::int
  into v_batches, v_accepted, v_rejected
  from public.send_batches where send_id = p_send_id;
  if v_batches = 0 or v_batches <> p_expected_batches then
    raise exception 'expected % batches recorded for send, found %', p_expected_batches, v_batches
      using errcode = 'P0002';
  end if;
  select count(*)::int into v_queued from public.send_recipients
  where send_id = p_send_id and status = 'queued';
  if v_queued > 0 then
    raise exception '% recipients still queued after every batch was recorded', v_queued
      using errcode = 'P0002';
  end if;
  select provider_batch_id into v_first from public.send_batches
  where send_id = p_send_id order by chunk_index limit 1;
  update public.sends
  set status = 'dispatched', dispatched_at = now(), provider_batch_id = v_first,
      provider_accepted = v_accepted, provider_rejected = v_rejected, last_error = null
  where id = p_send_id and status = 'dispatching';
end $$;
revoke all on function public.complete_dispatch(uuid, integer) from public, anon, authenticated;
grant execute on function public.complete_dispatch(uuid, integer) to service_role;

-- send_outcomes ------------------------------------------------------------------------------
drop function if exists public.send_outcomes(uuid);
create function public.send_outcomes(p_send_id uuid)
returns table (
  queued integer, withheld integer, accepted integer, rejected integer, unaccounted integer,
  delivered integer, opened integer, clicked integer, bounced integer, complained integer,
  unsubscribed integer, total integer, events integer, batches integer,
  unidentified_rejections integer, withheld_reasons jsonb
)
language sql stable security invoker
set search_path = public
as $$
  select
    count(*) filter (where status = 'queued')::int,
    count(*) filter (where status = 'withheld')::int,
    count(*) filter (where status = 'accepted')::int,
    count(*) filter (where status = 'rejected')::int,
    count(*) filter (where status = 'unaccounted')::int,
    count(*) filter (where status = 'delivered')::int,
    count(*) filter (where status = 'opened')::int,
    count(*) filter (where status = 'clicked')::int,
    count(*) filter (where status = 'bounced')::int,
    count(*) filter (where status = 'complained')::int,
    count(*) filter (where status = 'unsubscribed')::int,
    count(*)::int,
    (select count(*)::int from public.provider_events e where e.send_id = p_send_id),
    (select count(*)::int from public.send_batches b where b.send_id = p_send_id),
    (select coalesce(sum(b.unidentified_rejections), 0)::int from public.send_batches b where b.send_id = p_send_id),
    (select coalesce(jsonb_object_agg(w.withheld_reason, w.n), '{}'::jsonb) from (
       select x.withheld_reason, count(*)::int as n from public.send_recipients x
       where x.send_id = p_send_id and x.status = 'withheld' group by 1) w)
  from public.send_recipients r where r.send_id = p_send_id
$$;
revoke all on function public.send_outcomes(uuid) from public, anon;
grant execute on function public.send_outcomes(uuid) to authenticated;

-- share_results: withheld and unaccounted are rows of their own, so the rows still add up to the
-- frozen approved count.
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
  unaccounted integer,
  withheld integer,
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
    (select count(*)::int from r where status = 'unaccounted'),
    (select count(*)::int from r where status = 'withheld'),
    (select max(dispatched_at) from s),
    (select coalesce(jsonb_object_agg(t, n), '{}'::jsonb) from (
       select event_type::text as t, count(*)::int as n from public.engagement_events
       where brand_id = l.brand_id and campaign_id = l.campaign_id group by 1) x)
  from public.campaigns c join public.brands b on b.id = c.brand_id
  where c.id = l.campaign_id;
end $$;
revoke all on function public.share_results(uuid) from public, anon, authenticated;
grant execute on function public.share_results(uuid) to service_role;

-- ingest_provider_events: an unaccounted recipient moves forward on the first report for it (a
-- delivery report is evidence it was sent); a withheld recipient was never posted and no event
-- moves it. Otherwise unchanged from 20260916000900.
create or replace function public.ingest_provider_events(p_send_id uuid, p_events jsonb)
returns table (inserted integer, duplicates integer, unknown_recipients integer)
language plpgsql security definer
set search_path = public
as $$
declare
  v_brand uuid;
  v_inserted integer := 0;
  v_dups integer := 0;
  v_unknown integer := 0;
  ev jsonb;
  v_event_id text;
  v_type text;
  v_recipient uuid;
  v_occurred timestamptz;
  v_new public.recipient_status;
  forward constant public.recipient_status[] := array['queued','rejected','unaccounted','accepted','delivered','opened','clicked']::public.recipient_status[];
begin
  select brand_id into v_brand from public.sends where id = p_send_id;
  if v_brand is null then
    raise exception 'send not found' using errcode = 'P0002';
  end if;

  for ev in select * from jsonb_array_elements(p_events) loop
    v_event_id := coalesce(ev->>'event_id', ev->>'id');
    v_type := lower(coalesce(ev->>'type', ev->>'event_type', ev->>'event', ''));
    begin
      v_occurred := nullif(coalesce(ev->>'occurred_at', ev->>'timestamp', ev->>'at', ev->>'created_at'), '')::timestamptz;
    exception when others then
      v_occurred := null;
    end;
    begin
      v_recipient := nullif(coalesce(ev->>'recipient_id', ev->>'recipient', ev->>'contact_id', ev->'recipient'->>'id'), '')::uuid;
    exception when others then
      v_recipient := null;
    end;
    if v_event_id is null then
      continue;
    end if;

    if v_recipient is not null and not exists (
      select 1 from public.send_recipients r where r.send_id = p_send_id and r.contact_id = v_recipient
    ) then
      v_recipient := null;
    end if;

    insert into public.provider_events (brand_id, send_id, provider_event_id, event_type, recipient_id, occurred_at, raw)
    values (v_brand, p_send_id, v_event_id, v_type, v_recipient, v_occurred, ev)
    on conflict (send_id, provider_event_id) do nothing;
    if not found then
      v_dups := v_dups + 1;
      continue;
    end if;
    v_inserted := v_inserted + 1;

    if v_recipient is null then
      v_unknown := v_unknown + 1;
      continue;
    end if;

    v_new := case v_type
      when 'delivered' then 'delivered'::public.recipient_status
      when 'opened' then 'opened'
      when 'open' then 'opened'
      when 'clicked' then 'clicked'
      when 'click' then 'clicked'
      when 'bounced' then 'bounced'
      when 'bounce' then 'bounced'
      when 'complained' then 'complained'
      when 'complaint' then 'complained'
      when 'unsubscribed' then 'unsubscribed'
      when 'unsubscribe' then 'unsubscribed'
      else null end;
    if v_new is null then
      continue;
    end if;

    update public.send_recipients r
    set status = v_new, last_event_at = greatest(coalesce(r.last_event_at, v_occurred), v_occurred)
    where r.send_id = p_send_id and r.contact_id = v_recipient
      and r.status not in ('bounced', 'complained', 'unsubscribed', 'withheld')
      and (
        v_new in ('bounced', 'complained', 'unsubscribed')
        or array_position(forward, v_new) > array_position(forward, r.status)
      );
  end loop;

  update public.sends set last_polled_at = now() where id = p_send_id;
  return query select v_inserted, v_dups, v_unknown;
end $$;
revoke all on function public.ingest_provider_events(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_provider_events(uuid, jsonb) to service_role;
