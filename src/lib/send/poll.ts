import 'server-only';

import type { Json } from '@/lib/supabase/database.types';
import { createAdminClient } from '@/lib/supabase/admin';
import { ProviderError, fetchEvents } from '@/lib/provider/client';

export type PollResult = {
  sendId: string;
  /** Batches the send has. */
  batches: number;
  /** Batches walked to the end of their event stream in this run. */
  polled: number;
  /**
   * Batches whose walk stopped at MAX_PAGES with the provider still reporting has_more. They are
   * not caught up: send_batches.poll_incomplete is true and the next poll resumes from the stored
   * cursor. Not counted in `polled`.
   */
  truncated: number;
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
  /**
   * Set when the provider answered 503 or 429: the run stopped and nothing else should call the
   * provider in it. Seconds the provider asked to wait, or null when it did not say.
   */
  pausedFor?: number | null;
  error?: string;
};

/** Event pages read per batch per run. Past this the batch is recorded as incomplete and resumed. */
export const MAX_PAGES = 20;

/** Statuses on which the provider is asking us to stop calling for a while. */
const PAUSE_STATUSES = new Set([429, 503]);

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
 * a 503 or 429 that asks for a pause ends the run, and a time budget ends the run before the
 * caller's own limit does. Every run makes progress; nothing depends on one run finishing
 * everything.
 *
 * A batch whose stream is longer than MAX_PAGES pages is not reported as walked: its next unread
 * cursor is stored with poll_incomplete = true and the next poll resumes there (README section 3:
 * `since=<next_cursor>` returns the next subset). Once a resumed walk reaches the end the flag
 * clears and the following poll starts from the beginning again, which picks up late events.
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
    .select('id, provider_batch_id, chunk_index, last_polled_at, poll_cursor, poll_incomplete', {
      count: 'exact',
    })
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
    truncated: 0,
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
  let paused = false;

  for (let b = 0; b < batches.data.length; b++) {
    const batch = batches.data[b];
    if (paused || Date.now() >= deadline) {
      result.deferred = batches.data.length - b;
      break;
    }
    // Resume an incomplete walk from where the last one stopped; otherwise start at the beginning.
    const resumeFrom = batch.poll_incomplete ? batch.poll_cursor : null;
    let cursor: string | null = resumeFrom;
    let truncated = false;
    const seenCursors = new Set<string>(cursor ? [cursor] : []);
    try {
      for (let page = 0; ; page++) {
        if (page === MAX_PAGES) {
          // has_more was true and `cursor` is the next unread page: not caught up.
          truncated = true;
          break;
        }
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
        // A repeated cursor means the provider is looping: treat the stream as ended.
        if (!res.hasMore || !res.nextCursor || seenCursors.has(res.nextCursor)) break;
        seenCursors.add(res.nextCursor);
        cursor = res.nextCursor;
      }
      const mark = await admin
        .from('send_batches')
        .update({
          poll_cursor: truncated ? cursor : null,
          poll_incomplete: truncated,
          last_polled_at: new Date().toISOString(),
        })
        .eq('id', batch.id);
      if (mark.error) throw new Error(`batch poll could not be recorded: ${mark.error.message}`);
      if (truncated) result.truncated++;
      else result.polled++;
    } catch (e) {
      result.failed++;
      const message = e instanceof Error ? e.message : String(e);
      if (problems.length < 3) problems.push(`batch ${batch.chunk_index + 1}: ${message}`);
      if (e instanceof ProviderError && e.status !== undefined && PAUSE_STATUSES.has(e.status)) {
        // The provider asked for a pause (503 measured, 429 documented): stop this run and every
        // other send's walk in it. The scheduler is back in a minute.
        paused = true;
        result.pausedFor = e.retryAfterSeconds ?? null;
      } else if (
        resumeFrom &&
        e instanceof ProviderError &&
        e.status !== undefined &&
        e.status >= 400 &&
        e.status < 500
      ) {
        // The stored cursor was refused (expired or unknown). Keep the batch marked incomplete but
        // forget the cursor, so the next poll walks it from the beginning instead of failing forever.
        const reset = await admin
          .from('send_batches')
          .update({ poll_cursor: null })
          .eq('id', batch.id);
        if (reset.error && problems.length < 3) {
          problems.push(
            `batch ${batch.chunk_index + 1}: cursor reset failed: ${reset.error.message}`,
          );
        }
      }
    }
  }

  if (result.failed > 0) {
    result.error = `${result.failed} of ${result.batches} batches did not answer: ${problems.join('; ')}`;
    if (paused) {
      result.error += `; provider asked to pause${result.pausedFor ? ` for ${result.pausedFor}s` : ''}, run stopped`;
    }
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

/**
 * How long after dispatch the scheduler keeps asking the provider for feedback. This constant is
 * the only definition of the feedback window; the scheduler, the idle check and the send page's
 * wording all follow it.
 */
export const POLL_WINDOW_DAYS = 7;

function pollWindowStart(): string {
  return new Date(Date.now() - POLL_WINDOW_DAYS * 86_400_000).toISOString();
}

/**
 * How many sends the scheduler would poll right now: dispatched within the window. The poll route
 * calls this first so a minute with nothing to do costs one indexed count and no provider call.
 * An error throws; it is never read as "nothing to do".
 */
export async function countPollableSends(): Promise<number> {
  const admin = createAdminClient();
  const res = await admin
    .from('sends')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'dispatched')
    .gte('dispatched_at', pollWindowStart());
  if (res.error) throw new Error(`sends count failed: ${res.error.message}`);
  if (res.count === null) throw new Error('sends count failed: no count returned');
  return res.count;
}

/** What one scheduled run may spend, under the route's 60-second limit and pg_net's timeout. */
export const POLL_RUN_BUDGET_MS = 50_000;

/**
 * Every send dispatched within the window, least recently polled first, no cap: a send that is
 * never polled is a silent hole. The measured provider emitted new events minutes after dispatch;
 * a week covers late opens generously. Older sends stay readable and can still be polled by hand
 * from their page. One time budget covers the whole run; what does not fit goes first next time.
 * A 503 or 429 from the provider ends the whole run, not just one send's walk. A retry_after
 * longer than the scheduler's one-minute interval is not carried between runs (inferred safe: the
 * measured value was 22 s).
 */
export type PollRun = {
  results: PollResult[];
  /** sends inside the feedback window when the run started */
  pollable: number;
  /** pollable sends this run did not reach: they go first next run, being least recently polled */
  skipped: number;
  /** why the run stopped before reaching every pollable send; null when it reached them all */
  stoppedBy: 'budget' | 'provider_pause' | null;
};

export async function pollAllDispatched(opts: { budgetMs?: number } = {}): Promise<PollRun> {
  const admin = createAdminClient();
  const deadlineMs = Date.now() + (opts.budgetMs ?? POLL_RUN_BUDGET_MS);
  const since = pollWindowStart();
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
  const results: PollResult[] = [];
  let stoppedBy: PollRun['stoppedBy'] = null;
  for (const s of sends.data) {
    if (Date.now() >= deadlineMs) {
      stoppedBy = 'budget';
      break;
    }
    const r = await pollSend(s.id, { deadlineMs });
    results.push(r);
    // The provider asked for a pause on this send's walk; it applies to every send.
    if (r.pausedFor !== undefined) {
      stoppedBy = 'provider_pause';
      break;
    }
  }
  const pollable = sends.data.length;
  const skipped = pollable - results.length;
  return { results, pollable, skipped, stoppedBy: skipped > 0 ? stoppedBy : null };
}
