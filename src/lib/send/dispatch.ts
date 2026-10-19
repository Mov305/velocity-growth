import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/supabase/database.types';
import { createAdminClient } from '@/lib/supabase/admin';
import { PROVIDER_BATCH_CAP, dispatchBatch, rejectedEntries } from '@/lib/provider/client';

/**
 * How long one confirm may keep starting new chunks. The page that runs the action has
 * maxDuration = 60 and one provider call may take up to its 30-second timeout, so no chunk is
 * started after 25 seconds; the rest is left for the next confirm, which resumes.
 */
export const DISPATCH_RUN_BUDGET_MS = 25_000;

/**
 * What is recorded for a send after a run stopped: how many of its batches reached the provider
 * and how many recipients are still waiting. Read back from the database, never assumed.
 */
export type DispatchProgress = {
  /** batches recorded in send_batches: handed to the provider and answered */
  recordedBatches: number;
  /**
   * batches the send needs: chunks of the frozen audience holding at least one recipient who is
   * not withheld. A chunk whose members were all withheld is never posted and is not counted.
   */
  totalBatches: number;
  /** recipients in recorded batches */
  handedOver: number;
  /** recipients still queued: not handed over yet */
  remaining: number;
  /** recipients withheld because they became uncontactable after approval */
  withheld: number;
};

export type DispatchOutcome =
  | {
      kind: 'dispatched';
      sendId: string;
      batchId: string;
      batches: number;
      accepted: number;
      rejected: number;
      unaccounted: number;
      unidentifiedRejections: number;
      withheld: number;
    }
  | { kind: 'already'; sendId: string; status: string; batchId: string | null }
  /** progress is null when it could not be read back; the caller must not guess */
  | { kind: 'failed'; sendId: string; error: string; progress: DispatchProgress | null }
  | { kind: 'paused'; sendId: string; progress: DispatchProgress | null };

/** Idempotency key for one chunk of a send: the send's own key for the first, key:n after. */
export function chunkKey(sendKey: string, chunkIndex: number): string {
  return chunkIndex === 0 ? sendKey : `${sendKey}:${chunkIndex}`;
}

/**
 * Confirms a send. The caller's own client runs begin_dispatch, so the owner check and the
 * one-winner transition happen in SQL under the caller's identity. Only after winning that row is
 * the service role used, and only to record what the provider said.
 *
 * Recipients who stopped being contactable after approval are withheld first, in SQL, by the one
 * definition of contactable. The frozen audience (withheld included) is then cut into chunks of
 * PROVIDER_BATCH_CAP in a fixed order, so chunk n holds the same recipients on every run and its
 * idempotency key always means the same batch. Only the chunk's queued recipients are posted; a
 * chunk with none left is not posted. Each answer is recorded in send_batches at once, and every
 * posted recipient ends accepted, rejected or unaccounted (named in neither list).
 *
 * A thrown error between chunks marks the send `failed` with the recorded chunks in place; the
 * time budget does the same with a `paused:` error; a process death leaves it `dispatching` until
 * the five-minute takeover in begin_dispatch. In every case the retry skips recorded chunks and
 * posts the rest under the same keys, so nothing recorded is sent twice.
 */
export async function dispatchSend(
  userClient: SupabaseClient<Database>,
  sendId: string,
  opts: { deadlineMs?: number } = {},
): Promise<DispatchOutcome> {
  const deadlineMs = opts.deadlineMs ?? Date.now() + DISPATCH_RUN_BUDGET_MS;
  const begun = await userClient.rpc('begin_dispatch', { p_send_id: sendId });
  if (begun.error) throw new Error(`begin_dispatch failed: ${begun.error.message}`);
  const send = begun.data?.[0];
  if (!send) {
    // Someone else won the transition, or the send is already past it. Report what it is now.
    const current = await userClient
      .from('sends')
      .select('status, provider_batch_id')
      .eq('id', sendId)
      .single();
    if (current.error) throw new Error(`send lookup failed: ${current.error.message}`);
    return {
      kind: 'already',
      sendId,
      status: current.data.status,
      batchId: current.data.provider_batch_id,
    };
  }

  // Service role from here: the audience was frozen by approve_send and the brand is the send's.
  const admin = createAdminClient();
  const stop = async (
    error: string,
    kind: 'failed' | 'paused' = 'failed',
  ): Promise<DispatchOutcome> => {
    const r = await admin.rpc('fail_dispatch', { p_send_id: sendId, p_error: error });
    const progress = await readProgress(admin, sendId);
    if (r.error) {
      // The stop could not be recorded; say so rather than pretend the row is consistent.
      console.error(`fail_dispatch could not record for send ${sendId}: ${r.error.message}`);
      return {
        kind: 'failed',
        sendId,
        error: `${error} (and the failure could not be recorded)`,
        progress,
      };
    }
    return kind === 'paused'
      ? { kind: 'paused', sendId, progress }
      : { kind: 'failed', sendId, error, progress };
  };

  const withheld = await admin.rpc('withhold_uncontactable', { p_send_id: sendId });
  if (withheld.error) return stop(`withhold_uncontactable failed: ${withheld.error.message}`);

  // PostgREST returns at most 1,000 rows per request; the frozen audience is read in pages until
  // it is complete, and the count must match what was approved or nothing is sent.
  const recipients = await readAudience(admin, sendId, send.brand_id, send.approved_count);
  if ('error' in recipients) return stop(recipients.error);
  if (recipients.rows.length !== send.approved_count) {
    return stop(
      `audience size ${recipients.rows.length} differs from approved ${send.approved_count}`,
    );
  }

  const [brand, campaign, recorded] = await Promise.all([
    admin.from('brands').select('code').eq('id', send.brand_id).single(),
    admin.from('campaigns').select('external_id').eq('id', send.campaign_id).single(),
    admin
      .from('send_batches')
      .select('chunk_index', { count: 'exact' })
      .eq('send_id', sendId)
      .range(0, 999),
  ]);
  if (recorded.error) return stop(`recorded batches read failed: ${recorded.error.message}`);
  if ((recorded.count ?? 0) > recorded.data.length) {
    return stop(`${recorded.count} batches recorded but only ${recorded.data.length} readable`);
  }
  const already = new Set(recorded.data.map((b) => b.chunk_index));

  const chunks: AudienceRow[][] = [];
  for (let i = 0; i < recipients.rows.length; i += PROVIDER_BATCH_CAP) {
    chunks.push(recipients.rows.slice(i, i + PROVIDER_BATCH_CAP));
  }
  // Chunks that exist as batches once this run is done: recorded ones plus those posted now.
  let expected = already.size;
  // Chunks this send needs at all: recorded, or holding someone still queued.
  const needed = chunks.filter(
    (c, i) => already.has(i) || c.some((r) => r.status === 'queued'),
  ).length;
  let postedThisRun = 0;

  try {
    for (let i = 0; i < chunks.length; i++) {
      if (already.has(i)) continue;
      const members = chunks[i];
      const posted = members.filter((r) => r.status === 'queued');
      if (posted.length === 0) continue; // every member withheld: nothing to hand over
      // At least one chunk per run, so every confirm makes progress.
      if (postedThisRun > 0 && Date.now() > deadlineMs) {
        return stop(`paused: time budget reached after ${expected} of ${needed} batches`, 'paused');
      }
      const key = chunkKey(send.idempotency_key, i);
      const result = await dispatchBatch({
        idempotencyKey: key,
        campaign: campaign.data?.external_id ?? send.campaign_id,
        brand: brand.data?.code ?? send.brand_id,
        recipients: posted.map(({ id, email, phone }) => ({ id, email, phone })),
      });
      // Attribution is to this chunk's members only. A rejection without an id of this chunk (an
      // unknown shape, or an id that is not ours) is counted, never dropped; members the answer
      // names neither way become 'unaccounted' in record_send_batch.
      const ours = new Set(members.map((r) => r.id));
      const accepted = result.accepted.filter((id) => ours.has(id));
      const reasons: Record<string, number> = {};
      const rejected: string[] = [];
      let unidentified = 0;
      for (const r of rejectedEntries(result)) {
        reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
        if (r.id && ours.has(r.id)) rejected.push(r.id);
        else unidentified++;
      }
      const rec = await admin.rpc('record_send_batch', {
        p_send_id: sendId,
        p_chunk_index: i,
        p_idempotency_key: key,
        p_batch_id: result.batch_id,
        p_members: members.map((r) => r.id),
        p_accepted: accepted,
        p_rejected: rejected,
        p_reasons: reasons as Json,
        p_unidentified_rejections: unidentified,
      });
      if (rec.error) throw new Error(`record_send_batch failed: ${rec.error.message}`);
      expected++;
      postedThisRun++;
    }

    if (expected === 0) {
      return stop('every approved recipient became uncontactable before hand-over');
    }
    const done = await admin.rpc('complete_dispatch', {
      p_send_id: sendId,
      p_expected_batches: expected,
    });
    if (done.error) throw new Error(`complete_dispatch failed: ${done.error.message}`);
    const [totals, outcomes] = await Promise.all([
      admin
        .from('sends')
        .select('provider_batch_id, provider_accepted, provider_rejected')
        .eq('id', sendId)
        .single(),
      admin.rpc('send_outcomes', { p_send_id: sendId }),
    ]);
    if (totals.error) throw new Error(`send lookup failed: ${totals.error.message}`);
    if (outcomes.error) throw new Error(`send outcomes failed: ${outcomes.error.message}`);
    const o = outcomes.data?.[0];
    if (!o) throw new Error('send outcomes returned no row');
    return {
      kind: 'dispatched',
      sendId,
      batchId: totals.data.provider_batch_id ?? '',
      batches: expected,
      accepted: totals.data.provider_accepted ?? 0,
      rejected: totals.data.provider_rejected ?? 0,
      unaccounted: o.unaccounted,
      unidentifiedRejections: o.unidentified_rejections,
      withheld: o.withheld,
    };
  } catch (e) {
    return stop(e instanceof Error ? e.message : String(e));
  }
}

type AudienceRow = {
  id: string;
  email: string | null;
  phone: string | null;
  status: Database['public']['Enums']['recipient_status'];
};

async function readAudience(
  admin: ReturnType<typeof createAdminClient>,
  sendId: string,
  brandId: string,
  expected: number,
): Promise<{ rows: AudienceRow[] } | { error: string }> {
  const PAGE = 1000;
  const rows: AudienceRow[] = [];
  for (let from = 0; from < expected + PAGE; from += PAGE) {
    const page = await admin
      .from('send_recipients')
      .select('contact_id, status, contacts ( email, phone )')
      .eq('send_id', sendId)
      .eq('brand_id', brandId)
      .order('contact_id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (page.error) return { error: `audience read failed: ${page.error.message}` };
    for (const r of page.data) {
      const c = Array.isArray(r.contacts) ? r.contacts[0] : r.contacts;
      rows.push({
        id: r.contact_id,
        email: c?.email ?? null,
        phone: c?.phone ?? null,
        status: r.status,
      });
    }
    if (page.data.length < PAGE) break;
  }
  return { rows };
}

/** Reads back what is recorded for a send. Null when it cannot be read: never a made-up zero. */
export async function readProgress(
  admin: ReturnType<typeof createAdminClient>,
  sendId: string,
): Promise<DispatchProgress | null> {
  const [batches, outcomes, needed] = await Promise.all([
    admin.from('send_batches').select('submitted_count', { count: 'exact' }).eq('send_id', sendId),
    admin.rpc('send_outcomes', { p_send_id: sendId }),
    admin.rpc('send_batches_needed', { p_send_id: sendId, p_cap: PROVIDER_BATCH_CAP }),
  ]);
  if (batches.error || outcomes.error || needed.error || !outcomes.data?.[0]) {
    console.error(
      `dispatch progress unreadable for send ${sendId}: ${batches.error?.message ?? outcomes.error?.message ?? needed.error?.message ?? 'no outcomes row'}`,
    );
    return null;
  }
  if ((batches.count ?? 0) > batches.data.length) return null;
  const o = outcomes.data[0];
  return {
    recordedBatches: batches.data.length,
    totalBatches: needed.data,
    handedOver: batches.data.reduce((n, b) => n + b.submitted_count, 0),
    remaining: o.queued,
    withheld: o.withheld,
  };
}
