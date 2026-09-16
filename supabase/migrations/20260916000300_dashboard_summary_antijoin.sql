-- Measured on the Kilele data (82k contacts, 303k events) as the authenticated role:
--   previous version (not exists inside count(*) filter): 44 s. Postgres evaluates a NOT EXISTS
--   inside a FILTER clause as a correlated subplan per row; it cannot become an anti-join there.
--   this version (not exists in a WHERE clause of its own subquery): 139 ms, Hash Right Anti Join.
-- Same definition, same numbers (82,114 / 395 / 35,502 on that data).

create or replace function public.dashboard_summary()
returns table (
  total_customers integer,
  deleted_customers integer,
  contactable integer,
  not_contactable integer,
  contactable_definition text
)
language sql stable security invoker
set search_path = public
as $$
  with excluded as (
    select e.contact_id from public.engagement_events e
    where e.event_type in ('bounce', 'complaint', 'unsubscribe')
    union
    select r.contact_id from public.send_recipients r
    where r.status in ('bounced', 'complained', 'unsubscribed')
  ),
  totals as (
    select
      count(*) filter (where deleted_at is null)::int as total_customers,
      count(*) filter (where deleted_at is not null)::int as deleted_customers
    from public.contacts
  ),
  reachable as (
    select count(*)::int as contactable
    from public.contacts ct
    where ct.deleted_at is null
      and ct.status = 'active'
      and ct.consent_marketing
      and (ct.suppressed_until is null or ct.suppressed_until < now())
      and (ct.email is not null or ct.phone is not null)
      and not exists (select 1 from excluded x where x.contact_id = ct.id)
  )
  select
    t.total_customers,
    t.deleted_customers,
    r.contactable,
    t.total_customers - r.contactable as not_contactable,
    'status active, consent given, not deleted, not suppressed, has an email or phone, and no bounce, complaint or unsubscribe in the event log or from a send' as contactable_definition
  from totals t, reachable r
$$;
