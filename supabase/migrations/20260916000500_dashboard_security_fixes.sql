-- Stage 4 security review.
-- 1. contact_is_contactable(row) is not an RPC. Called through PostgREST with a crafted row it
--    answered for a contact the caller cannot see (vacuously true, because the exclusion subqueries
--    saw no rows). Nothing leaked, but a function that can answer wrongly should not be callable.
--    The app never calls it; contactable_contact_ids() serves the send audience.
-- 2. signups_last_30_days ran thirty scans of contacts. One grouped pass joined to the series.

revoke execute on function public.contact_is_contactable(public.contacts) from authenticated;

create or replace function public.signups_last_30_days()
returns table (day date, signups integer)
language sql stable security invoker
set search_path = public
set timezone = 'UTC'
as $$
  with days as (
    select d::date as day
    from generate_series((current_date - 29)::timestamp, current_date::timestamp, interval '1 day') as d
  ),
  counts as (
    select (c.signup_at at time zone 'UTC')::date as day, count(*)::int as signups
    from public.contacts c
    where c.deleted_at is null
      and c.signup_at >= (current_date - 29)::timestamp at time zone 'UTC'
      and c.signup_at < (current_date + 1)::timestamp at time zone 'UTC'
    group by 1
  )
  select days.day, coalesce(counts.signups, 0) as signups
  from days left join counts on counts.day = days.day
  order by days.day
$$;
