-- Stage 5 review fixes.
-- 1. approve_send is idempotent while a send for the campaign is in flight (approved, dispatching,
--    or failed with no batch): it returns that send instead of creating a twin. Two tabs pressing
--    Approve then Confirm reach the same send and the same single provider call. A campaign that
--    has been dispatched may be approved again later; that is a new, deliberate wave.
-- 2. ingest_provider_events: 'rejected' had no position in the forward ordering, so a recipient
--    the provider refused at hand-over could never be advanced by a later delivery report.
--    rejected now sits between queued and accepted; terminal outcomes are unchanged.

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
  if not app.is_owner_of(v_brand) then
    raise exception 'only an owner of this brand can approve a send' using errcode = '42501';
  end if;

  -- Serialise approvals per campaign so two concurrent approves cannot both miss the other.
  perform pg_advisory_xact_lock(hashtext('approve_send'), hashtext(p_campaign_id::text));

  select id into v_send from public.sends
  where campaign_id = p_campaign_id and brand_id = v_brand
    and provider_batch_id is null
    and status in ('approved', 'dispatching', 'failed')
  order by approved_at desc limit 1;
  if v_send is not null then
    return v_send;
  end if;

  insert into public.sends (brand_id, campaign_id, status, audience_definition, approved_count, approved_by, idempotency_key)
  values (
    v_brand, p_campaign_id, 'approved',
    'status active, consent given, not deleted, not suppressed, has an email or phone, and no bounce, complaint or unsubscribe in the event log or from a send',
    0, auth.uid(), gen_random_uuid()::text
  )
  returning id into v_send;

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
  forward constant public.recipient_status[] := array['queued','rejected','accepted','delivered','opened','clicked']::public.recipient_status[];
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
      and r.status not in ('bounced', 'complained', 'unsubscribed')
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
