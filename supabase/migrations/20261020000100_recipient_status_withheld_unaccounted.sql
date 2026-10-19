-- Two recipient states the send path needs, added in a migration of their own because Postgres
-- refuses to use a new enum value in the transaction that added it.
--
--   withheld     approved, then no longer contactable when the send was handed over; never posted.
--   unaccounted  posted to the provider in a recorded batch, but the provider's answer named it
--                neither accepted nor rejected. It is never re-posted (the batch's idempotency key
--                would return the same batch anyway) and its outcome is unknown until a report
--                arrives for it.
alter type public.recipient_status add value if not exists 'withheld';
alter type public.recipient_status add value if not exists 'unaccounted';
