-- Security review of stage 5: approve_send and begin_dispatch answered "not found" for an id that
-- does not exist and "only an owner" for an id that belongs to another brand, which lets a caller
-- learn whether a foreign id exists. Both cases now raise the same 42501 with the same text.

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
  if v_brand is null or not app.is_owner_of(v_brand) then
    raise exception 'not permitted: only an owner of the campaign''s brand can approve a send'
      using errcode = '42501';
  end if;

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

create or replace function public.begin_dispatch(p_send_id uuid)
returns setof public.sends
language plpgsql security definer
set search_path = public
as $$
declare
  v_brand uuid;
begin
  select brand_id into v_brand from public.sends where id = p_send_id;
  if v_brand is null or not app.is_owner_of(v_brand) then
    raise exception 'not permitted: only an owner of the send''s brand can dispatch it'
      using errcode = '42501';
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
