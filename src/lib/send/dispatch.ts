import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { createAdminClient } from '@/lib/supabase/admin';
import { dispatchBatch } from '@/lib/provider/client';

export type DispatchOutcome =
  | { kind: 'dispatched'; sendId: string; batchId: string; accepted: number; rejected: number }
  | { kind: 'already'; sendId: string; status: string; batchId: string | null }
  | { kind: 'failed'; sendId: string; error: string };

/**
 * Confirms a send. The caller's own client runs begin_dispatch, so the owner check and the
 * one-winner transition happen in SQL under the caller's identity. Only after winning that row is
 * the service role used, and only to record what the provider said.
 *
 * Retry safety: the Idempotency-Key is the send's stored key, so a second call after a crash gets
 * the same batch from the provider instead of a second send (measured, README section 3).
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

  const [brand, campaign] = await Promise.all([
    admin.from('brands').select('code').eq('id', send.brand_id).single(),
    admin.from('campaigns').select('external_id').eq('id', send.campaign_id).single(),
  ]);

  try {
    const result = await dispatchBatch({
      idempotencyKey: send.idempotency_key,
      campaign: campaign.data?.external_id ?? send.campaign_id,
      brand: brand.data?.code ?? send.brand_id,
      recipients: recipients.rows,
    });
    const ours = new Set(recipients.rows.map((r) => r.id));
    const accepted = result.accepted.filter((id) => ours.has(id));
    const rejected = result.rejected
      .map((r) => (typeof r === 'string' ? r : r.id))
      .filter((id) => ours.has(id));
    const done = await admin.rpc('complete_dispatch', {
      p_send_id: sendId,
      p_batch_id: result.batch_id,
      p_accepted: accepted,
      p_rejected: rejected,
    });
    if (done.error) throw new Error(`complete_dispatch failed: ${done.error.message}`);
    return {
      kind: 'dispatched',
      sendId,
      batchId: result.batch_id,
      accepted: accepted.length,
      rejected: rejected.length,
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
