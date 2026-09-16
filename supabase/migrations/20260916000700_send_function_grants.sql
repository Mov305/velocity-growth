-- Postgres grants EXECUTE on a new function to PUBLIC by default. The three functions the
-- application's server side calls with the service role were created without a revoke, so any
-- signed-in user could have called complete_dispatch, fail_dispatch or ingest_provider_events for
-- any send id. tests/rls/sends.test.ts "is not callable by a signed-in user" caught it.
-- Only service_role may execute them; the catalog test now asserts this for every definer function.

revoke all on function public.complete_dispatch(uuid, text, uuid[], uuid[]) from public, anon, authenticated;
revoke all on function public.fail_dispatch(uuid, text) from public, anon, authenticated;
revoke all on function public.ingest_provider_events(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.complete_dispatch(uuid, text, uuid[], uuid[]) to service_role;
grant execute on function public.fail_dispatch(uuid, text) to service_role;
grant execute on function public.ingest_provider_events(uuid, jsonb) to service_role;
