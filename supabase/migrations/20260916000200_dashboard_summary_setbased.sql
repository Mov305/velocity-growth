-- dashboard_summary called contact_is_contactable() once per contact: 82,000 calls, each with two
-- correlated subqueries under RLS, and PostgREST's 8 s statement timeout cancelled it for Kilele.
-- Same definition, computed as sets: the excluded contacts (bounce, complaint, unsubscribe in the
-- event log or from a send) are collected once, then every count is one pass over contacts.
-- contact_is_contactable(row) stays for single-row checks; it is never called in a loop again.

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
  c as (
    select
      count(*) filter (where ct.deleted_at is null)::int as total_customers,
      count(*) filter (where ct.deleted_at is not null)::int as deleted_customers,
      count(*) filter (
        where ct.deleted_at is null
          and ct.status = 'active'
          and ct.consent_marketing
          and (ct.suppressed_until is null or ct.suppressed_until < now())
          and (ct.email is not null or ct.phone is not null)
          and not exists (select 1 from excluded x where x.contact_id = ct.id)
      )::int as contactable
    from public.contacts ct
  )
  select
    total_customers,
    deleted_customers,
    contactable,
    total_customers - contactable as not_contactable,
    'status active, consent given, not deleted, not suppressed, has an email or phone, and no bounce, complaint or unsubscribe in the event log or from a send' as contactable_definition
  from c
$$;

-- The same set, as ids, for the send audience in stage 5. One definition, two shapes.
create or replace function public.contactable_contact_ids()
returns setof uuid
language sql stable security invoker
set search_path = public
as $$
  with excluded as (
    select e.contact_id from public.engagement_events e
    where e.event_type in ('bounce', 'complaint', 'unsubscribe')
    union
    select r.contact_id from public.send_recipients r
    where r.status in ('bounced', 'complained', 'unsubscribed')
  )
  select ct.id from public.contacts ct
  where ct.deleted_at is null
    and ct.status = 'active'
    and ct.consent_marketing
    and (ct.suppressed_until is null or ct.suppressed_until < now())
    and (ct.email is not null or ct.phone is not null)
    and not exists (select 1 from excluded x where x.contact_id = ct.id)
$$;

revoke all on function public.contactable_contact_ids() from public, anon;
grant execute on function public.contactable_contact_ids() to authenticated;
