-- Stage 2 review fixes.
--
-- 1. rows_already_present: on a re-import, events that already exist are neither upserted nor
--    rejected nor in-file duplicates. Without this column the imports row could not account for
--    every row read. Invariant: rows_read = rows_upserted + rows_rejected + rows_skipped_duplicate
--    + rows_already_present.
-- 2. Allow-list check constraints so the database refuses what the importer refuses, even if a
--    future code path bypasses the importer.

alter table public.imports
  add column rows_already_present integer not null default 0;

alter table public.send_log_entries
  add constraint send_log_entries_status_check
  check (status in ('sent', 'queued', 'failed', 'cancelled', 'partial'));

alter table public.campaigns
  add constraint campaigns_external_id_check
  check (external_id ~ '^[A-Z]{2,5}-[0-9]{3,6}$');

alter table public.engagement_events
  add constraint engagement_events_event_id_check
  check (event_id <> '');
