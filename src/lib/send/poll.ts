import 'server-only';

import type { Json } from '@/lib/supabase/database.types';
import { createAdminClient } from '@/lib/supabase/admin';
import { ProviderError, fetchEvents } from '@/lib/provider/client';

export type PollResult = {
  sendId: string;
  /** Batches the send has. */
  batches: number;
  /** Batches fully walked in this run. */
  polled: number;
  /** Batches left untouched because the time budget ran out; the next run takes them first. */
  deferred: number;
  /** Batches that answered with an error this run; they stay least-recently-polled. */
  failed: number;
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
 * Pulls what the provider has for the batches of one send and hands it to
 * ingest_provider_events, which deduplicates on event id and applies status transitions
 * monotonically. Because `since` is ignored by the provider (measured), every walk of a batch
 * starts from its beginning and follows the cursor while has_more; the database makes that
 * idempotent.
 *
 * Measured on 2026-09-16 with a 72-batch send: the events endpoint answers 503
 * "reports temporarily unavailable" with a retry_after partway through a long walk. So batches
 * are taken least-recently-polled first, an error on one batch is recorded and the walk moves on,
 * a 503 that asks for a pause ends the run, and a time budget ends the run before the caller's
 * own limit does. Every run makes progress; nothing depends on one run finishing everything.
 */
export async function pollSend(
  sendId: string,
  opts: { deadlineMs?: number } = {},
): Promise<PollResult> {
  // Service role: the scheduler has no user. The send id fixes the brand; nothing is filtered
  // by anything a caller supplies.
  const admin = createAdminClient();
  const send = await admin.from('sends').select('id, status').eq('id', sendId).single();
  if (send.error) throw new Error(`send lookup failed: ${send.error.message}`);
  if (send.data.status !== 'dispatched') {
    throw new Error(`send ${sendId} is ${send.data.status}; nothing to poll`);
  }
  const batches = await admin
    .from('send_batches')
    .select('id, provider_batch_id, chunk_index, last_polled_at', { count: 'exact' })
    .eq('send_id', sendId)
    .order('last_polled_at', { ascending: true, nullsFirst: true })
    .order('chunk_index', { ascending: true })
    .range(0, 999);
  if (batches.error) throw new Error(`batches lookup failed: ${batches.error.message}`);
  if ((batches.count ?? 0) > batches.data.length) {
    throw new Error(
      `send ${sendId} has ${batches.count} batches but only ${batches.data.length} can be polled in one run`,
    );
  }
  if (batches.data.length === 0) throw new Error(`send ${sendId} has no recorded batch`);

  const result: PollResult = {
    sendId,
    batches: batches.data.length,
    polled: 0,
    deferred: 0,
    failed: 0,
    pages: 0,
    received: 0,
    inserted: 0,
    duplicates: 0,
    unknownRecipients: 0,
    malformed: 0,
  };
  const problems: string[] = [];
  const deadline = opts.deadlineMs ?? Number.POSITIVE_INFINITY;
  let pausedBy: string | null = null;

  for (let b = 0; b < batches.data.length; b++) {
    const batch = batches.data[b];
    if (pausedBy || Date.now() >= deadline) {
      result.deferred = batches.data.length - b;
      break;
    }
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await fetchEvents(batch.provider_batch_id, cursor);
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
      const mark = await admin
        .from('send_batches')
        .update({ poll_cursor: cursor, last_polled_at: new Date().toISOString() })
        .eq('id', batch.id);
      if (mark.error) throw new Error(`batch poll could not be recorded: ${mark.error.message}`);
      result.polled++;
    } catch (e) {
      result.failed++;
      const message = e instanceof Error ? e.message : String(e);
      if (problems.length < 3) problems.push(`batch ${batch.chunk_index + 1}: ${message}`);
      // The provider asked for a pause: stop this run, the scheduler is back in a minute.
      if (e instanceof ProviderError && e.status === 503) pausedBy = message;
    }
  }

  if (result.failed > 0) {
    result.error = `${result.failed} of ${result.batches} batches did not answer: ${problems.join('; ')}`;
  }
  const done = await admin
    .from('sends')
    .update({
      last_error: result.error ? `poll: ${result.error.slice(0, 480)}` : null,
      last_polled_at: new Date().toISOString(),
    })
    .eq('id', sendId);
  if (done.error) {
    result.error = `${result.error ? `${result.error}; ` : ''}poll could not be recorded: ${done.error.message}`;
  }
  return result;
}

/** How long after dispatch the scheduler keeps asking the provider for feedback. */
export const POLL_WINDOW_DAYS = 7;

/** What one scheduled run may spend, under the route's 60-second limit and pg_net's timeout. */
export const POLL_RUN_BUDGET_MS = 50_000;

/**
 * Every send dispatched within the window, least recently polled first, no cap: a send that is
 * never polled is a silent hole. The measured provider emitted new events minutes after dispatch;
 * a week covers late opens generously. Older sends stay readable and can still be polled by hand
 * from their page. One time budget covers the whole run; what does not fit goes first next time.
 */
export async function pollAllDispatched(opts: { budgetMs?: number } = {}): Promise<PollResult[]> {
  const admin = createAdminClient();
  const deadlineMs = Date.now() + (opts.budgetMs ?? POLL_RUN_BUDGET_MS);
  const since = new Date(Date.now() - POLL_WINDOW_DAYS * 86_400_000).toISOString();
  const sends = await admin
    .from('sends')
    .select('id', { count: 'exact' })
    .eq('status', 'dispatched')
    .gte('dispatched_at', since)
    .order('last_polled_at', { ascending: true, nullsFirst: true })
    .range(0, 999);
  if (sends.error) throw new Error(`sends lookup failed: ${sends.error.message}`);
  if ((sends.count ?? 0) > sends.data.length) {
    throw new Error(
      `${sends.count} sends need polling but only ${sends.data.length} fit in one run`,
    );
  }
  const out: PollResult[] = [];
  for (const s of sends.data) {
    if (Date.now() >= deadlineMs) break;
    out.push(await pollSend(s.id, { deadlineMs }));
  }
  return out;
}
