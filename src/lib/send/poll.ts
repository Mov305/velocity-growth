import 'server-only';

import type { Json } from '@/lib/supabase/database.types';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchEvents } from '@/lib/provider/client';

export type PollResult = {
  sendId: string;
  batchId: string;
  pages: number;
  received: number;
  inserted: number;
  duplicates: number;
  unknownRecipients: number;
  malformed: number;
  error?: string;
};

const MAX_PAGES = 20;

/**
 * Pulls everything the provider has for one batch and hands it to ingest_provider_events, which
 * deduplicates on event id and applies status transitions monotonically. Because `since` is
 * ignored by the provider (measured), every poll starts from the beginning and follows the cursor
 * while has_more; the database makes that idempotent.
 */
export async function pollSend(sendId: string): Promise<PollResult> {
  // Service role: the scheduler has no user. The send id fixes the brand; nothing is filtered
  // by anything a caller supplies.
  const admin = createAdminClient();
  const send = await admin
    .from('sends')
    .select('id, provider_batch_id, status')
    .eq('id', sendId)
    .single();
  if (send.error) throw new Error(`send lookup failed: ${send.error.message}`);
  if (!send.data.provider_batch_id || send.data.status !== 'dispatched') {
    throw new Error(`send ${sendId} is ${send.data.status} with no batch; nothing to poll`);
  }
  const batchId = send.data.provider_batch_id;
  const result: PollResult = {
    sendId,
    batchId,
    pages: 0,
    received: 0,
    inserted: 0,
    duplicates: 0,
    unknownRecipients: 0,
    malformed: 0,
  };

  let cursor: string | null = null;
  const seenCursors = new Set<string>();
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await fetchEvents(batchId, cursor);
      result.pages++;
      result.received += res.events.length;
      result.malformed += res.malformed;
      if (res.events.length > 0) {
        const ingested = await admin.rpc('ingest_provider_events', {
          p_send_id: sendId,
          p_events: res.events as unknown as Json,
        });
        if (ingested.error) throw new Error(`ingest failed: ${ingested.error.message}`);
        const row = ingested.data?.[0];
        result.inserted += row?.inserted ?? 0;
        result.duplicates += row?.duplicates ?? 0;
        result.unknownRecipients += row?.unknown_recipients ?? 0;
      }
      if (!res.hasMore || !res.nextCursor || seenCursors.has(res.nextCursor)) break;
      seenCursors.add(res.nextCursor);
      cursor = res.nextCursor;
    }
    const done = await admin
      .from('sends')
      .update({ poll_cursor: cursor, last_error: null })
      .eq('id', sendId);
    if (done.error) result.error = `poll succeeded but could not record it: ${done.error.message}`;
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    await admin
      .from('sends')
      .update({ last_error: `poll: ${result.error.slice(0, 480)}` })
      .eq('id', sendId);
  }
  return result;
}

/** How long after dispatch the scheduler keeps asking the provider for feedback. */
export const POLL_WINDOW_DAYS = 7;

/**
 * Every send dispatched within the window, newest first, no cap: a send that is never polled is a
 * silent hole. The measured provider emitted new events minutes after dispatch; a week covers late
 * opens generously. Older sends stay readable and can still be polled by hand from their page.
 */
export async function pollAllDispatched(): Promise<PollResult[]> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - POLL_WINDOW_DAYS * 86_400_000).toISOString();
  const sends = await admin
    .from('sends')
    .select('id', { count: 'exact' })
    .eq('status', 'dispatched')
    .gte('dispatched_at', since)
    .order('dispatched_at', { ascending: false })
    .range(0, 999);
  if (sends.error) throw new Error(`sends lookup failed: ${sends.error.message}`);
  if ((sends.count ?? 0) > sends.data.length) {
    throw new Error(
      `${sends.count} sends need polling but only ${sends.data.length} fit in one run`,
    );
  }
  const out: PollResult[] = [];
  for (const s of sends.data) out.push(await pollSend(s.id));
  return out;
}
