-- Reject reasons grouped per import, computed in the database rather than fetched and grouped in
-- the app. PostgREST caps a response at 1,000 rows, so an app-side group-by over rejects would have
-- silently summarised only the first 1,000 of a large import.
--
-- security_invoker: the view runs as the caller, so the RLS policy on import_rejects applies and a
-- user only ever sees reasons for their own brand's imports. tests/rls/catalog.test.ts fails if any
-- view in public is created without this.

create view public.import_reject_summary
with (security_invoker = true)
as
select
  r.import_id,
  r.brand_id,
  -- "unknown campaign MAR-0011" and "MAR-0012" are one reason to a marketer.
  regexp_replace(r.reason, '^(unknown campaign|unknown contact) .+$', '\1 …') as reason,
  count(*)::integer as rows
from public.import_rejects r
group by r.import_id, r.brand_id, 3;

grant select on public.import_reject_summary to authenticated;
