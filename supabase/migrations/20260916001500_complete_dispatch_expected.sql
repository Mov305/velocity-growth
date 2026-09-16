-- Review fix: complete_dispatch names how many batches it expects and refuses a partial set, so
-- a manual call or a future code path cannot mark a send dispatched with some chunks missing.
drop function if exists public.complete_dispatch(uuid);
create function public.complete_dispatch(p_send_id uuid, p_expected_batches integer)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_first text;
  v_accepted integer;
  v_rejected integer;
  v_batches integer;
begin
  select count(*)::int, coalesce(sum(accepted_count), 0)::int, coalesce(sum(rejected_count), 0)::int
  into v_batches, v_accepted, v_rejected
  from public.send_batches where send_id = p_send_id;
  if v_batches = 0 or v_batches <> p_expected_batches then
    raise exception 'expected % batches recorded for send, found %', p_expected_batches, v_batches
      using errcode = 'P0002';
  end if;
  select provider_batch_id into v_first from public.send_batches
  where send_id = p_send_id order by chunk_index limit 1;
  update public.sends
  set status = 'dispatched', dispatched_at = now(), provider_batch_id = v_first,
      provider_accepted = v_accepted, provider_rejected = v_rejected, last_error = null
  where id = p_send_id and status = 'dispatching';
end $$;
revoke all on function public.complete_dispatch(uuid, integer) from public, anon, authenticated;
grant execute on function public.complete_dispatch(uuid, integer) to service_role;
