-- 1. Opt-outs are sticky across imports. A re-uploaded older export used to move unsubscribed or
--    bounced contacts back to active, raise consent, clear deleted_at or clear a suppression. The
--    import now keeps the stored opt-out and counts how many rows it kept, so the marketer sees that the file disagreed with what is
--    stored. Not part of the "every row read is accounted for" sum: those rows are also upserted
--    (their other fields still update).
alter table public.imports
  add column rows_opt_out_kept integer not null default 0
  check (rows_opt_out_kept >= 0);

-- 2. Polling truncation is recorded, not hidden. One run walks at most a fixed number of event
--    pages per batch. When it stops with has_more still true, the batch is not caught up: the
--    cursor to resume from is kept in poll_cursor and poll_incomplete is true until a walk reaches
--    the end of the stream. The send page reads this under RLS (send_batches already has its
--    select grant and brand policy).
alter table public.send_batches
  add column poll_incomplete boolean not null default false;

comment on column public.send_batches.poll_incomplete is
  'true while the last poll of this batch stopped at the page cap with has_more still true; poll_cursor holds where the next poll resumes';
comment on column public.imports.rows_opt_out_kept is
  'existing contacts where this file tried to undo a stored opt-out and the import kept the stored value: unsubscribed/bounced status, consent false (an import never raises consent), deleted_at, or a suppression still in force (an import never shortens or clears suppressed_until)';
