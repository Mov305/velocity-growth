-- Second round of send-path review fixes, 2026-10-20.
--
-- 1. Backfill: sends dispatched before 20261020000110 may still have recipients in 'queued'. The
--    old record_send_batch moved only the recipients the provider named and left the rest queued,
--    so a dispatched send could show recipients as "not yet handed over" for ever. Every one of
--    them was posted: the old dispatch posted every member of every chunk, and a send only became
--    dispatched once every chunk was recorded. They become 'unaccounted' (posted, named neither
--    way), and the batch that posted them counts them, keeping
--    accepted + rejected + unaccounted = submitted on every row.
--
--    Which batch posted a recipient is derivable: the old code cut the audience ordered by
--    contact_id into chunks of 500, chunk n being send_batches.chunk_index n. Sends dispatched
--    before batching existed have one batch (chunk 0) that took the whole audience; for those
--    the recipient belongs to the highest recorded chunk at or below its computed chunk, which is
--    chunk 0. If any queued recipient of a dispatched send still cannot be attributed to a batch,
--    the migration stops with an error rather than guess. Re-running it changes nothing.
--
-- 2. record_send_batch: a recipient withheld at this hand-over whom the provider's answer names
--    rejected (an idempotency-key replay of a batch an earlier, crashed run posted) did reach the
--    provider, so it becomes 'rejected', as it already became 'accepted' when named accepted. A
--    withheld recipient the answer does not name stays withheld: it cannot be told apart from one
--    withheld before any run posted its chunk, and calling it unaccounted would claim it was sent.
--
-- 3. approve_send: a failed send with no recorded batch and no queued recipient (every approved
--    recipient was withheld at hand-over, or the audience was empty) has nothing left to hand
--    over. approve_send no longer returns it; it freezes a new audience under a new send. The old
--    send stays failed with its reason, as the record of what happened.
--
-- 4. send_batches_needed: how many provider batches a send needs, counting only chunks that hold
--    at least one recipient who is not withheld. A chunk whose members were all withheld is never
--    posted and is not counted in "X of N batches".
--
-- 5. withhold_uncontactable no longer depends on fresh planner statistics (see section 5).

-- 1 -------------------------------------------------------------------------------------------
do $$
declare
  v_left integer;
begin
  with ranked as (
    select r.send_id, r.contact_id, r.status,
           ((row_number() over (partition by r.send_id order by r.contact_id)) - 1) / 500 as chunk
    from public.send_recipients r
    join public.sends s on s.id = r.send_id
    where s.status = 'dispatched'
      and exists (select 1 from public.send_recipients q
                  where q.send_id = s.id and q.status = 'queued')
  ), target as (
    select k.send_id, k.contact_id,
           (select max(b.chunk_index) from public.send_batches b
            where b.send_id = k.send_id and b.chunk_index <= k.chunk) as batch_chunk
    from ranked k
    where k.status = 'queued'
  ), moved as (
    update public.send_recipients r set status = 'unaccounted'
    from target t
    where t.batch_chunk is not null
      and r.send_id = t.send_id and r.contact_id = t.contact_id and r.status = 'queued'
    returning t.send_id, t.batch_chunk
  )
  update public.send_batches b
  set unaccounted_count = b.unaccounted_count + m.n,
      submitted_count = b.submitted_count + m.n
  from (select send_id, batch_chunk, count(*)::int as n from moved group by 1, 2) m
  where b.send_id = m.send_id and b.chunk_index = m.batch_chunk;

  select count(*)::int into v_left
  from public.send_recipients r join public.sends s on s.id = r.send_id
  where s.status = 'dispatched' and r.status = 'queued';
  if v_left > 0 then
    raise exception '% queued recipients of dispatched sends could not be attributed to a batch', v_left;
  end if;
end $$;

-- 2 -------------------------------------------------------------------------------------------
create or replace function public.record_send_batch(
  p_send_id uuid, p_chunk_index integer, p_idempotency_key text, p_batch_id text,
  p_members uuid[], p_accepted uuid[], p_rejected uuid[], p_reasons jsonb,
  p_unidentified_rejections integer
)
returns table (accepted integer, rejected integer, unaccounted integer, submitted integer)
language plpgsql security definer
set search_path = public
as $$
declare
  v_brand uuid;
  v_members integer;
  v_known integer;
  v_acc integer;
  v_rej integer;
  v_una integer;
begin
  select brand_id into v_brand from public.sends where id = p_send_id and status = 'dispatching';
  if v_brand is null then
    raise exception 'send is not dispatching' using errcode = 'P0002';
  end if;
  if p_unidentified_rejections is null or p_unidentified_rejections < 0 then
    raise exception 'unidentified rejections must be a non-negative count' using errcode = '22023';
  end if;

  -- Already recorded (a takeover raced the original run): report what was stored, change nothing.
  if exists (select 1 from public.send_batches b where b.send_id = p_send_id and b.chunk_index = p_chunk_index) then
    return query
      select b.accepted_count, b.rejected_count, b.unaccounted_count, b.submitted_count
      from public.send_batches b where b.send_id = p_send_id and b.chunk_index = p_chunk_index;
    return;
  end if;

  -- The chunk must be recipients of this send, every one of them.
  select count(distinct m) into v_members from unnest(p_members) m;
  select count(*) into v_known from public.send_recipients r
  where r.send_id = p_send_id and r.contact_id = any(p_members);
  if v_members = 0 or v_known <> v_members then
    raise exception 'chunk % names % recipients, % of them in this send', p_chunk_index, v_members, v_known
      using errcode = '22023';
  end if;

  -- Accepted wins over rejected if the provider names someone in both. A recipient withheld at
  -- this hand-over whom the provider still names, either way, did reach the provider (the
  -- idempotency key replayed a batch an earlier run posted), so the provider's answer is stored.
  update public.send_recipients r set status = 'accepted', withheld_reason = null
  where r.send_id = p_send_id and r.contact_id = any(p_members) and r.contact_id = any(p_accepted)
    and r.status in ('queued', 'withheld');
  update public.send_recipients r set status = 'rejected', withheld_reason = null
  where r.send_id = p_send_id and r.contact_id = any(p_members) and r.contact_id = any(p_rejected)
    and r.status in ('queued', 'withheld');
  -- Posted, and named in neither list: never left queued, never re-posted. A withheld member the
  -- answer does not name stays withheld (see the header of 20261020000300).
  update public.send_recipients r set status = 'unaccounted'
  where r.send_id = p_send_id and r.contact_id = any(p_members) and r.status = 'queued';

  select count(*) filter (where r.status = 'accepted')::int,
         count(*) filter (where r.status = 'rejected')::int,
         count(*) filter (where r.status = 'unaccounted')::int
  into v_acc, v_rej, v_una
  from public.send_recipients r where r.send_id = p_send_id and r.contact_id = any(p_members);

  insert into public.send_batches (
    send_id, brand_id, chunk_index, idempotency_key, provider_batch_id,
    accepted_count, rejected_count, unaccounted_count, submitted_count,
    unidentified_rejections, rejection_reasons
  )
  values (
    p_send_id, v_brand, p_chunk_index, p_idempotency_key, p_batch_id,
    v_acc, v_rej, v_una, v_acc + v_rej + v_una,
    p_unidentified_rejections, coalesce(p_reasons, '{}'::jsonb)
  );
  return query select v_acc, v_rej, v_una, v_acc + v_rej + v_una;
end $$;
revoke all on function public.record_send_batch(uuid, integer, text, text, uuid[], uuid[], uuid[], jsonb, integer) from public, anon, authenticated;
grant execute on function public.record_send_batch(uuid, integer, text, text, uuid[], uuid[], uuid[], jsonb, integer) to service_role;

-- 3 -------------------------------------------------------------------------------------------
create or replace function public.approve_send(p_campaign_id uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_brand uuid;
  v_send uuid;
  v_status public.send_status;
  v_count integer;
begin
  select brand_id into v_brand from public.campaigns where id = p_campaign_id;
  if v_brand is null or not app.is_owner_of(v_brand) then
    raise exception 'not permitted: only an owner of the campaign''s brand can approve a send'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('approve_send'), hashtext(p_campaign_id::text));

  select id, status into v_send, v_status from public.sends
  where campaign_id = p_campaign_id and brand_id = v_brand
    and provider_batch_id is null
    and status in ('approved', 'dispatching', 'failed')
  order by approved_at desc limit 1;
  -- A send in flight is returned, so approving twice never freezes two audiences. The exception
  -- is a failed send with nothing left to hand over: no batch recorded and nobody queued.
  if v_send is not null and not (
    v_status = 'failed'
    and not exists (select 1 from public.send_batches b where b.send_id = v_send)
    and not exists (select 1 from public.send_recipients r where r.send_id = v_send and r.status = 'queued')
  ) then
    return v_send;
  end if;

  insert into public.sends (brand_id, campaign_id, status, audience_definition, approved_count, approved_by, idempotency_key)
  values (
    v_brand, p_campaign_id, 'approved',
    'status active, consent given, not deleted, not suppressed, has an email or phone, and no bounce, complaint or unsubscribe in the event log or from a send',
    0, auth.uid(), gen_random_uuid()::text
  )
  returning id into v_send;

  insert into public.send_recipients (send_id, contact_id, brand_id, status)
  select v_send, ct.id, v_brand, 'queued'
  from public.contacts ct
  where ct.brand_id = v_brand
    and ct.deleted_at is null
    and ct.status = 'active'
    and ct.consent_marketing
    and (ct.suppressed_until is null or ct.suppressed_until < now())
    and (ct.email is not null or ct.phone is not null)
    and not exists (
      select 1 from public.engagement_events e
      where e.brand_id = v_brand and e.contact_id = ct.id
        and e.event_type in ('bounce', 'complaint', 'unsubscribe'))
    and not exists (
      select 1 from public.send_recipients r
      where r.brand_id = v_brand and r.contact_id = ct.id
        and r.status in ('bounced', 'complained', 'unsubscribed'));

  get diagnostics v_count = row_count;
  update public.sends set approved_count = v_count where id = v_send;
  return v_send;
end $$;
revoke all on function public.approve_send(uuid) from public, anon;
grant execute on function public.approve_send(uuid) to authenticated;

-- 4 -------------------------------------------------------------------------------------------
-- Security invoker: a marketer sees the count for sends of their own brand only (RLS on
-- send_recipients). p_cap is the provider's batch cap, passed by the caller that owns it.
create function public.send_batches_needed(p_send_id uuid, p_cap integer)
returns integer
language sql stable security invoker
set search_path = public
as $$
  select count(distinct x.chunk)::int
  from (
    select ((row_number() over (order by r.contact_id)) - 1) / p_cap as chunk, r.status
    from public.send_recipients r
    where r.send_id = p_send_id
  ) x
  where x.status <> 'withheld'
$$;
revoke all on function public.send_batches_needed(uuid, integer) from public, anon;
grant execute on function public.send_batches_needed(uuid, integer) to authenticated, service_role;

-- 5 -------------------------------------------------------------------------------------------
-- withhold_uncontactable runs right after approve_send inserted the whole audience, before
-- autovacuum has analyzed send_recipients. Measured locally on 2026-10-20 with a 35,176-recipient
-- Kilele send next to an earlier dispatched one of the same size, statistics stale: the planner
-- chose nested loops against contactable_contact_ids() and the call ran 59.7 s (PostgREST cancels
-- at 8 s, so the hand-over failed). With nested loops off for this function only it ran 94 ms on
-- the same data. The setting applies to this function's execution and nothing else.
alter function public.withhold_uncontactable(uuid) set enable_nestloop = off;
