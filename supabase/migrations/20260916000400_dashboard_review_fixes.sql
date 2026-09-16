-- Stage 4 review fixes.
-- 1. signups_last_30_days pins the session timezone to UTC so current_date and the UTC-cast
--    signup dates are on the same calendar, whatever the connection's timezone setting.
-- 2. campaign_performance coalesces the reported figures so the function's declared non-null
--    return type is true; a campaign file with an empty figure reports 0 and the UI can still say
--    which figures the brand left blank via the flags column.

create or replace function public.signups_last_30_days()
returns table (day date, signups integer)
language sql stable security invoker
set search_path = public
set timezone = 'UTC'
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
    coalesce(c.reported_sent, 0), coalesce(c.reported_delivered, 0), coalesce(c.reported_bounced, 0),
    coalesce(c.reported_opens, 0), coalesce(c.reported_clicks, 0),
    coalesce(c.spend, 0),
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
