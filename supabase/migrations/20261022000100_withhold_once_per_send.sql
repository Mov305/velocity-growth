-- withhold_uncontactable timed out on the hosted project for a 32,827-recipient Kilele send.
-- The anti-join against contactable_contact_ids() could be planned as one evaluation of the
-- set-returning function per recipient. Now the brand's contactable ids are computed once into a
-- materialized CTE and the queued recipients are anti-joined against it in one pass. The
-- definition of contactable is still only the one in contactable_contact_ids().

-- Terminal outcomes from earlier sends are looked up by contact in contactable_contact_ids();
-- without this index that branch scans every send_recipients row.
create index if not exists send_recipients_terminal_contact_idx
  on public.send_recipients (contact_id)
  where status in ('bounced', 'complained', 'unsubscribed');

create or replace function public.withhold_uncontactable(p_send_id uuid)
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

  with ok as materialized (
    select c.id
    from public.contactable_contact_ids() as c(id)
    join public.contacts k on k.id = c.id and k.brand_id = v_brand
  ),
  gone as materialized (
    select r.contact_id
    from public.send_recipients r
    left join ok on ok.id = r.contact_id
    where r.send_id = p_send_id and r.status = 'queued' and ok.id is null
  )
  update public.send_recipients r
  set status = 'withheld',
      withheld_reason = coalesce((
        select case
          when ct.deleted_at is not null then 'deleted'
          when ct.status in ('unsubscribed', 'bounced')
            or exists (select 1 from public.engagement_events e
                       where e.brand_id = ct.brand_id and e.contact_id = ct.id
                         and e.event_type in ('bounce', 'complaint', 'unsubscribe'))
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
  from gone g
  where r.send_id = p_send_id
    and r.status = 'queued'
    and r.contact_id = g.contact_id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
alter function public.withhold_uncontactable(uuid) set enable_nestloop = off;
revoke all on function public.withhold_uncontactable(uuid) from public, anon, authenticated;
grant execute on function public.withhold_uncontactable(uuid) to service_role;
