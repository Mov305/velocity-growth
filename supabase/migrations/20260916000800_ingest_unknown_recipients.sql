-- Review of stage 5 tests: a forged event carrying a well-formed uuid that is not one of the send's
-- recipients violated the foreign key on provider_events.recipient_id and aborted the whole page.
-- Unknown recipients are now stored with a null link and counted, never rejected as a batch.

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

    -- A recipient we did not send to (forged, or a well-formed uuid that is not ours) is kept in
    -- the raw event with a null recipient link, so it can never violate the foreign key and abort
    -- the page, and never moves any status.
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
        or array_position(array['queued','accepted','delivered','opened','clicked']::public.recipient_status[], v_new)
         > array_position(array['queued','accepted','delivered','opened','clicked']::public.recipient_status[], r.status)
      );
  end loop;

  update public.sends set last_polled_at = now() where id = p_send_id;
  return query select v_inserted, v_dups, v_unknown;
end $$;

revoke all on function public.ingest_provider_events(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_provider_events(uuid, jsonb) to service_role;
