import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/supabase/database.types';
import { createAdminClient } from '@/lib/supabase/admin';
import { PROVIDER_BATCH_CAP, dispatchBatch, rejectedEntries } from '@/lib/provider/client';

export type DispatchOutcome =
  | {
      kind: 'dispatched';
      sendId: string;
      batchId: string;
      batches: number;
      accepted: number;
      rejected: number;
    }
  | { kind: 'already'; sendId: string; status: string; batchId: string | null }
  | { kind: 'failed'; sendId: string; error: string };

/** Idempotency key for one chunk of a send: the send's own key for the first, key:n after. */
export function chunkKey(sendKey: string, chunkIndex: number): string {
  return chunkIndex === 0 ? sendKey : `${sendKey}:${chunkIndex}`;
}

/**
 * Confirms a send. The caller's own client runs begin_dispatch, so the owner check and the
 * one-winner transition happen in SQL under the caller's identity. Only after winning that row is
 * the service role used, and only to record what the provider said.
 *
 * The provider takes at most PROVIDER_BATCH_CAP recipients per batch (measured, README section
 * 3), so the frozen audience goes in chunks, each under its own idempotency key and each recorded
 * in send_batches the moment the provider answers. A thrown error between chunks marks the send
 * `failed` with the recorded chunks in place; a process death leaves it `dispatching` until the
 * five-minute takeover in begin_dispatch. Either way the retry skips recorded chunks and re-posts
 * the rest under the same keys, so the provider returns the same batches and nothing is sent twice.
 */
export async function dispatchSend(
  userClient: SupabaseClient<Database>,
  sendId: string,
): Promise<DispatchOutcome> {
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
  const fail = async (error: string): Promise<DispatchOutcome> => {
    const r = await admin.rpc('fail_dispatch', { p_send_id: sendId, p_error: error });
    if (r.error) {
      // The failure could not be recorded; say so rather than pretend the row is consistent.
      console.error(`fail_dispatch could not record for send ${sendId}: ${r.error.message}`);
      return {
        kind: 'failed',
        sendId,
        error: `${error} (and the failure could not be recorded)`,
      };
    }
    return { kind: 'failed', sendId, error };
  };

  // PostgREST returns at most 1,000 rows per request; the frozen audience is read in pages until
  // it is complete, and the count must match what was approved or nothing is sent.
  const recipients = await readAudience(admin, sendId, send.brand_id, send.approved_count);
  if ('error' in recipients) return fail(recipients.error);
  if (recipients.rows.length !== send.approved_count) {
    return fail(
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
  if (recorded.error) return fail(`recorded batches read failed: ${recorded.error.message}`);
  if ((recorded.count ?? 0) > recorded.data.length) {
    return fail(`${recorded.count} batches recorded but only ${recorded.data.length} readable`);
  }
  const already = new Set(recorded.data.map((b) => b.chunk_index));

  const chunks: AudienceRow[][] = [];
  for (let i = 0; i < recipients.rows.length; i += PROVIDER_BATCH_CAP) {
    chunks.push(recipients.rows.slice(i, i + PROVIDER_BATCH_CAP));
  }

  try {
    for (let i = 0; i < chunks.length; i++) {
      if (already.has(i)) continue;
      const chunk = chunks[i];
      const key = chunkKey(send.idempotency_key, i);
      const result = await dispatchBatch({
        idempotencyKey: key,
        campaign: campaign.data?.external_id ?? send.campaign_id,
        brand: brand.data?.code ?? send.brand_id,
        recipients: chunk,
      });
      // Only this chunk's recipients count; anything else in the answer is the provider's noise.
      const ours = new Set(chunk.map((r) => r.id));
      const accepted = result.accepted.filter((id) => ours.has(id));
      const reasons: Record<string, number> = {};
      const rejected: string[] = [];
      for (const r of rejectedEntries(result)) {
        if (!r.id || !ours.has(r.id)) continue;
        rejected.push(r.id);
        reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
      }
      const rec = await admin.rpc('record_send_batch', {
        p_send_id: sendId,
        p_chunk_index: i,
        p_idempotency_key: key,
        p_batch_id: result.batch_id,
        p_accepted: accepted,
        p_rejected: rejected,
        p_reasons: reasons as Json,
      });
      if (rec.error) throw new Error(`record_send_batch failed: ${rec.error.message}`);
    }

    const done = await admin.rpc('complete_dispatch', {
      p_send_id: sendId,
      p_expected_batches: chunks.length,
    });
    if (done.error) throw new Error(`complete_dispatch failed: ${done.error.message}`);
    const totals = await admin
      .from('sends')
      .select('provider_batch_id, provider_accepted, provider_rejected')
      .eq('id', sendId)
      .single();
    if (totals.error) throw new Error(`send lookup failed: ${totals.error.message}`);
    return {
      kind: 'dispatched',
      sendId,
      batchId: totals.data.provider_batch_id ?? '',
      batches: chunks.length,
      accepted: totals.data.provider_accepted ?? 0,
      rejected: totals.data.provider_rejected ?? 0,
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

type AudienceRow = { id: string; email: string | null; phone: string | null };

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
      .select('contact_id, contacts ( email, phone )')
      .eq('send_id', sendId)
      .eq('brand_id', brandId)
      .order('contact_id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (page.error) return { error: `audience read failed: ${page.error.message}` };
    for (const r of page.data) {
      const c = Array.isArray(r.contacts) ? r.contacts[0] : r.contacts;
      rows.push({ id: r.contact_id, email: c?.email ?? null, phone: c?.phone ?? null });
    }
    if (page.data.length < PAGE) break;
  }
  return { rows };
}
