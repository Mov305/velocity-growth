-- Measured on 2026-09-16 with a 35,502-recipient Kilele send: the provider accepts at most 500
-- recipients per batch and answers the rest with {reason: 'recipient_cap_exceeded',
-- recipient: {id, email, phone}}. One send is therefore many provider batches. Each batch has its
-- own idempotency key (the send's key, then key:1, key:2, ...) and is recorded here the moment the
-- provider answers, so a process that dies between batches resumes from the next one and never
-- re-sends a recorded one. The send's provider_batch_id keeps the first batch for display.

create table public.send_batches (
  id uuid primary key default gen_random_uuid(),
  send_id uuid not null references public.sends(id) on delete cascade,
  brand_id uuid not null references public.brands(id),
  chunk_index integer not null check (chunk_index >= 0),
  idempotency_key text not null,
  provider_batch_id text not null,
  accepted_count integer not null default 0,
  rejected_count integer not null default 0,
  rejection_reasons jsonb not null default '{}'::jsonb,
  poll_cursor text,
  last_polled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (send_id, chunk_index),
  unique (send_id, provider_batch_id)
);
create index send_batches_send_idx on public.send_batches (send_id, chunk_index);
alter table public.send_batches enable row level security;
alter table public.send_batches force row level security;
revoke all on public.send_batches from public, anon, authenticated;
grant select on public.send_batches to authenticated;
create policy send_batches_select_own_brand on public.send_batches
  for select to authenticated using (brand_id in (select app.user_brand_ids()));

-- Existing sends: one batch each.
insert into public.send_batches (send_id, brand_id, chunk_index, idempotency_key, provider_batch_id, accepted_count, rejected_count, poll_cursor, last_polled_at)
select id, brand_id, 0, idempotency_key, provider_batch_id, coalesce(provider_accepted, 0), coalesce(provider_rejected, 0), poll_cursor, last_polled_at
from public.sends where provider_batch_id is not null
on conflict do nothing;

create or replace function public.record_send_batch(
  p_send_id uuid, p_chunk_index integer, p_idempotency_key text, p_batch_id text,
  p_accepted uuid[], p_rejected uuid[], p_reasons jsonb
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_brand uuid;
begin
  select brand_id into v_brand from public.sends where id = p_send_id and status = 'dispatching';
  if v_brand is null then
    raise exception 'send is not dispatching' using errcode = 'P0002';
  end if;
  insert into public.send_batches (send_id, brand_id, chunk_index, idempotency_key, provider_batch_id, accepted_count, rejected_count, rejection_reasons)
  values (p_send_id, v_brand, p_chunk_index, p_idempotency_key, p_batch_id,
          coalesce(array_length(p_accepted, 1), 0), coalesce(array_length(p_rejected, 1), 0), coalesce(p_reasons, '{}'::jsonb))
  on conflict (send_id, chunk_index) do nothing;
  update public.send_recipients set status = 'accepted'
  where send_id = p_send_id and contact_id = any(p_accepted) and status = 'queued';
  update public.send_recipients set status = 'rejected'
  where send_id = p_send_id and contact_id = any(p_rejected) and status = 'queued';
end $$;
revoke all on function public.record_send_batch(uuid, integer, text, text, uuid[], uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.record_send_batch(uuid, integer, text, text, uuid[], uuid[], jsonb) to service_role;

drop function if exists public.complete_dispatch(uuid, text, uuid[], uuid[]);
create function public.complete_dispatch(p_send_id uuid)
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
  if v_batches = 0 then
    raise exception 'no batch recorded for send' using errcode = 'P0002';
  end if;
  select provider_batch_id into v_first from public.send_batches
  where send_id = p_send_id order by chunk_index limit 1;
  update public.sends
  set status = 'dispatched', dispatched_at = now(), provider_batch_id = v_first,
      provider_accepted = v_accepted, provider_rejected = v_rejected, last_error = null
  where id = p_send_id and status = 'dispatching';
end $$;
revoke all on function public.complete_dispatch(uuid) from public, anon, authenticated;
grant execute on function public.complete_dispatch(uuid) to service_role;

-- send_outcomes: the batch count travels with the outcomes so the page can say "across N batches".
drop function if exists public.send_outcomes(uuid);
create function public.send_outcomes(p_send_id uuid)
returns table (
  queued integer, accepted integer, rejected integer, delivered integer, opened integer,
  clicked integer, bounced integer, complained integer, unsubscribed integer, total integer,
  events integer, batches integer
)
language sql stable security invoker
set search_path = public
as $$
  select
    count(*) filter (where status = 'queued')::int,
    count(*) filter (where status = 'accepted')::int,
    count(*) filter (where status = 'rejected')::int,
    count(*) filter (where status = 'delivered')::int,
    count(*) filter (where status = 'opened')::int,
    count(*) filter (where status = 'clicked')::int,
    count(*) filter (where status = 'bounced')::int,
    count(*) filter (where status = 'complained')::int,
    count(*) filter (where status = 'unsubscribed')::int,
    count(*)::int,
    (select count(*)::int from public.provider_events e where e.send_id = p_send_id),
    (select count(*)::int from public.send_batches b where b.send_id = p_send_id)
  from public.send_recipients r where r.send_id = p_send_id
$$;
revoke all on function public.send_outcomes(uuid) from public, anon;
grant execute on function public.send_outcomes(uuid) to authenticated;
