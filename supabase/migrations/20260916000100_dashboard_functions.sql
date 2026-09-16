-- Dashboard numbers, computed in the database and defined once here. Every function is
-- SECURITY INVOKER: it runs as the caller, so RLS on the underlying tables decides the brand and no
-- function takes a brand id. The definitions below are the ones rendered as footnotes on screen.

-- Contactable: the one definition the send audience and the dashboard both use.
-- A contact is contactable when all of these hold:
--   status = active, consent_marketing = true, deleted_at is null,
--   suppressed_until is null or in the past,
--   an email or a phone exists,
--   no bounce, complaint or unsubscribe in the engagement log,
--   no bounced, complained or unsubscribed outcome from a provider send.
create or replace function public.contact_is_contactable(c public.contacts)
returns boolean
language sql stable security invoker
set search_path = public
as $$
  select c.status = 'active'
     and c.consent_marketing
     and c.deleted_at is null
     and (c.suppressed_until is null or c.suppressed_until < now())
     and (c.email is not null or c.phone is not null)
     and not exists (
       select 1 from public.engagement_events e
       where e.contact_id = c.id and e.event_type in ('bounce', 'complaint', 'unsubscribe')
     )
     and not exists (
       select 1 from public.send_recipients r
       where r.contact_id = c.id and r.status in ('bounced', 'complained', 'unsubscribed')
     )
$$;

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
  with c as (
    select
      count(*) filter (where deleted_at is null)::int as total_customers,
      count(*) filter (where deleted_at is not null)::int as deleted_customers,
      count(*) filter (where public.contact_is_contactable(contacts))::int as contactable
    from public.contacts
  )
  select
    total_customers,
    deleted_customers,
    contactable,
    total_customers - contactable as not_contactable,
    'status active, consent given, not deleted, not suppressed, has an email or phone, and no bounce, complaint or unsubscribe in the event log or from a send' as contactable_definition
  from c
$$;

-- Signups per day for the 30 days ending today (UTC), zero-filled so a quiet day is a zero bar
-- and an empty window is thirty zeros, not a missing chart.
create or replace function public.signups_last_30_days()
returns table (day date, signups integer)
language sql stable security invoker
set search_path = public
as $$
  select d::date as day,
         coalesce((
           select count(*)::int from public.contacts c
           where c.deleted_at is null
             and (c.signup_at at time zone 'UTC')::date = d::date
         ), 0) as signups
  from generate_series((current_date - 29)::timestamp, current_date::timestamp, interval '1 day') as d
  order by d
$$;

-- Per campaign: what the brand reported (totals from its file) next to what the event log
-- observed (distinct contacts per event type). Both shown; neither is silently preferred.
create or replace function public.campaign_performance()
returns table (
  id uuid,
  external_id text,
  name text,
  channel public.channel,
  sent_at timestamptz,
  reported_sent integer,
  reported_delivered integer,
  reported_bounced integer,
  reported_opens integer,
  reported_clicks integer,
  spend numeric,
  observed_contacts integer,
  observed_opened integer,
  observed_clicked integer,
  observed_bounced integer,
  observed_complained integer,
  observed_unsubscribed integer,
  observed_events integer
)
language sql stable security invoker
set search_path = public
as $$
  select
    c.id, c.external_id, c.name, c.channel, c.sent_at,
    c.reported_sent, c.reported_delivered, c.reported_bounced, c.reported_opens, c.reported_clicks,
    c.spend,
    coalesce(o.contacts, 0), coalesce(o.opened, 0), coalesce(o.clicked, 0), coalesce(o.bounced, 0),
    coalesce(o.complained, 0), coalesce(o.unsubscribed, 0), coalesce(o.events, 0)
  from public.campaigns c
  left join lateral (
    select
      count(distinct e.contact_id)::int as contacts,
      count(distinct e.contact_id) filter (where e.event_type = 'open')::int as opened,
      count(distinct e.contact_id) filter (where e.event_type = 'click')::int as clicked,
      count(distinct e.contact_id) filter (where e.event_type = 'bounce')::int as bounced,
      count(distinct e.contact_id) filter (where e.event_type = 'complaint')::int as complained,
      count(distinct e.contact_id) filter (where e.event_type = 'unsubscribe')::int as unsubscribed,
      count(*)::int as events
    from public.engagement_events e
    where e.campaign_id = c.id
  ) o on true
  order by c.sent_at desc nulls last, c.external_id
$$;

revoke all on function public.contact_is_contactable(public.contacts) from public, anon;
revoke all on function public.dashboard_summary() from public, anon;
revoke all on function public.signups_last_30_days() from public, anon;
revoke all on function public.campaign_performance() from public, anon;
grant execute on function public.contact_is_contactable(public.contacts) to authenticated;
grant execute on function public.dashboard_summary() to authenticated;
grant execute on function public.signups_last_30_days() to authenticated;
grant execute on function public.campaign_performance() to authenticated;
