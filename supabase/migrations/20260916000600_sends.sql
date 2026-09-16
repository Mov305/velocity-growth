-- Sending: the parts that must be true even if the application is wrong.
--
-- approve_send      owner only (checked in SQL), freezes the audience and the count, stores the
--                   idempotency key before any provider call can happen.
-- begin_dispatch    the one transition that decides who calls the provider. Two sessions pressing
--                   confirm at once: one UPDATE wins the row, the other gets nothing back.
-- complete_dispatch / fail_dispatch / ingest_provider_events
--                   service-role only; the application's server side writes results and feedback.
-- Recipient status is monotonic: a terminal outcome (bounced, complained, unsubscribed) never
-- reverts because a late 'delivered' or 'opened' arrives out of order.

create or replace function public.preview_send_audience(p_campaign_id uuid)
returns table (audience_count integer, audience_definition text)
language sql stable security invoker
set search_path = public
as $$
  select
    (select count(*)::int from public.contactable_contact_ids()) as audience_count,
    'status active, consent given, not deleted, not suppressed, has an email or phone, and no bounce, complaint or unsubscribe in the event log or from a send' as audience_definition
  from public.campaigns c where c.id = p_campaign_id
$$;
revoke all on function public.preview_send_audience(uuid) from public, anon;
grant execute on function public.preview_send_audience(uuid) to authenticated;

create or replace function public.approve_send(p_campaign_id uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_brand uuid;
  v_send uuid;
  v_count integer;
begin
  select brand_id into v_brand from public.campaigns where id = p_campaign_id;
  if v_brand is null then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;
  -- Role and membership are checked here, in SQL, not in the UI.
  if not app.is_owner_of(v_brand) then
    raise exception 'only an owner of this brand can approve a send' using errcode = '42501';
  end if;

  insert into public.sends (brand_id, campaign_id, status, audience_definition, approved_count, approved_by, idempotency_key)
  values (
    v_brand, p_campaign_id, 'approved',
    'status active, consent given, not deleted, not suppressed, has an email or phone, and no bounce, complaint or unsubscribe in the event log or from a send',
    0, auth.uid(), gen_random_uuid()::text
  )
  returning id into v_send;

  -- The frozen audience. Same definition as contactable_contact_ids(), written out here because
  -- this function runs as its owner and must scope the brand explicitly.
  insert into public.send_recipients (send_id, contact_id, brand_id, status)
  select v_send, ct.id, v_brand, 'queued'
  from public.contacts ct
  where ct.brand_id = v_brand
    and ct.deleted_at is null
    and ct.status = 'active'
    and ct.consent_marketing
    and (ct.suppressed_until is null or ct.suppressed_until < now())
    and (ct.email is not null or ct.phone is not null)
    and not exists (
      select 1 from public.engagement_events e
      where e.brand_id = v_brand and e.contact_id = ct.id
        and e.event_type in ('bounce', 'complaint', 'unsubscribe'))
    and not exists (
      select 1 from public.send_recipients r
      where r.brand_id = v_brand and r.contact_id = ct.id
        and r.status in ('bounced', 'complained', 'unsubscribed'));

  get diagnostics v_count = row_count;
  update public.sends set approved_count = v_count where id = v_send;
  return v_send;
end $$;
revoke all on function public.approve_send(uuid) from public, anon;
grant execute on function public.approve_send(uuid) to authenticated;

-- Returns the send row if this caller now owns the dispatch, or no row if it was already taken.
-- 'failed' with no batch id may be retried; 'dispatching' with no batch id for more than five
-- minutes is a dead process and may be taken over. A send with a batch id is never dispatched again.
create or replace function public.begin_dispatch(p_send_id uuid)
returns setof public.sends
language plpgsql security definer
set search_path = public
as $$
declare
  v_brand uuid;
begin
  select brand_id into v_brand from public.sends where id = p_send_id;
  if v_brand is null then
    raise exception 'send not found' using errcode = 'P0002';
  end if;
  if not app.is_owner_of(v_brand) then
    raise exception 'only an owner of this brand can dispatch a send' using errcode = '42501';
  end if;
  return query
    update public.sends s
    set status = 'dispatching', dispatch_started_at = now(), last_error = null
    where s.id = p_send_id
      and s.provider_batch_id is null
      and (
        s.status = 'approved'
        or s.status = 'failed'
        or (s.status = 'dispatching' and s.dispatch_started_at < now() - interval '5 minutes')
      )
    returning s.*;
end $$;
revoke all on function public.begin_dispatch(uuid) from public, anon;
grant execute on function public.begin_dispatch(uuid) to authenticated;

create or replace function public.complete_dispatch(
  p_send_id uuid, p_batch_id text, p_accepted uuid[], p_rejected uuid[]
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  update public.send_recipients set status = 'accepted'
  where send_id = p_send_id and contact_id = any(p_accepted) and status = 'queued';
  update public.send_recipients set status = 'rejected'
  where send_id = p_send_id and contact_id = any(p_rejected) and status = 'queued';
  update public.sends
  set status = 'dispatched', dispatched_at = now(), provider_batch_id = p_batch_id,
      provider_accepted = coalesce(array_length(p_accepted, 1), 0),
      provider_rejected = coalesce(array_length(p_rejected, 1), 0)
  where id = p_send_id and status = 'dispatching';
end $$;

create or replace function public.fail_dispatch(p_send_id uuid, p_error text)
returns void
language sql security definer
set search_path = public
as $$
  update public.sends set status = 'failed', last_error = left(p_error, 500)
  where id = p_send_id and status = 'dispatching' and provider_batch_id is null
$$;

-- Events arrive messy: duplicated, out of order, sometimes for recipients we do not know.
-- Every event is stored once (unique on send_id + provider_event_id). Recipient status moves only
-- forward in this order: queued < accepted < delivered < opened < clicked, and any of
-- bounced, complained, unsubscribed is terminal.
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
begin
  select brand_id into v_brand from public.sends where id = p_send_id;
  if v_brand is null then
    raise exception 'send not found' using errcode = 'P0002';
  end if;

  for ev in select * from jsonb_array_elements(p_events) loop
    v_event_id := coalesce(ev->>'event_id', ev->>'id');
    v_type := lower(coalesce(ev->>'type', ev->>'event_type', ev->>'event', ''));
    v_occurred := nullif(coalesce(ev->>'occurred_at', ev->>'timestamp', ev->>'at', ev->>'created_at'), '')::timestamptz;
    begin
      v_recipient := nullif(coalesce(ev->>'recipient_id', ev->>'recipient', ev->>'id_ref', ev->>'contact_id', ev->'recipient'->>'id'), '')::uuid;
    exception when others then
      v_recipient := null;
    end;
    if v_event_id is null then
      continue;
    end if;

    insert into public.provider_events (brand_id, send_id, provider_event_id, event_type, recipient_id, occurred_at, raw)
    values (v_brand, p_send_id, v_event_id, v_type, v_recipient, v_occurred, ev)
    on conflict (send_id, provider_event_id) do nothing;
    if not found then
      v_dups := v_dups + 1;
      continue;
    end if;
    v_inserted := v_inserted + 1;

    if v_recipient is null or not exists (
      select 1 from public.send_recipients r where r.send_id = p_send_id and r.contact_id = v_recipient
    ) then
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
      and r.status not in ('bounced', 'complained', 'unsubscribed')
      and (
        v_new in ('bounced', 'complained', 'unsubscribed')
        or array_position(array['queued','accepted','delivered','opened','clicked']::public.recipient_status[], v_new)
         > array_position(array['queued','accepted','delivered','opened','clicked']::public.recipient_status[], r.status)
      );
  end loop;

  update public.sends set last_polled_at = now() where id = p_send_id;
  return query select v_inserted, v_dups, v_unknown;
end $$;

-- Per-send outcome counts for the screens, computed once here.
create or replace function public.send_outcomes(p_send_id uuid)
returns table (
  queued integer, accepted integer, rejected integer, delivered integer, opened integer,
  clicked integer, bounced integer, complained integer, unsubscribed integer, total integer,
  events integer
)
language sql stable security invoker
set search_path = public
as $$
  select
    count(*) filter (where status = 'queued')::int,
    count(*) filter (where status = 'accepted')::int,
    count(*) filter (where status = 'rejected')::int,
    count(*) filter (where status = 'delivered')::int,
    count(*) filter (where status = 'opened')::int,
    count(*) filter (where status = 'clicked')::int,
    count(*) filter (where status = 'bounced')::int,
    count(*) filter (where status = 'complained')::int,
    count(*) filter (where status = 'unsubscribed')::int,
    count(*)::int,
    (select count(*)::int from public.provider_events e where e.send_id = p_send_id)
  from public.send_recipients r where r.send_id = p_send_id
$$;
revoke all on function public.send_outcomes(uuid) from public, anon;
grant execute on function public.send_outcomes(uuid) to authenticated;

-- The recipient status is the send's mirror; the contact's own status follows terminal outcomes
-- so the next audience excludes them (contactable_contact_ids already reads send_recipients).
