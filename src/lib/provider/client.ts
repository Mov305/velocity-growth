import 'server-only';

import { z } from 'zod';
import { serverEnv } from '@/lib/env';

/**
 * The VG messaging provider, as measured on 2026-09-16, not as documented.
 *
 *   POST /v1/messages with Idempotency-Key: the key alone decides. Same key returns the same
 *   batch even with a different body; no key means a new batch every time. So the key is always
 *   derived from the send's stored idempotency_key and the body is always the frozen audience.
 *   A batch takes at most 500 recipients; the rest come back rejected with reason
 *   recipient_cap_exceeded as {reason, recipient: {id, email, phone}} (measured with 35,502).
 *   GET /v1/messages/{batch}/events: `since` is ignored whatever its value, `next_cursor` returns
 *   a different subset, events are duplicated, out of time order, appear minutes after dispatch,
 *   and one forged event names a recipient that is not ours. Nothing here is trusted: every
 *   response is parsed against an allow-list schema, and deduplication happens in the database.
 */

const Recipient = z.object({
  id: z.string().uuid(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
});

/** The most recipients one provider batch takes before it starts rejecting (measured). */
export const PROVIDER_BATCH_CAP = 500;

const DispatchResponse = z.object({
  batch_id: z.string().min(1),
  accepted: z.array(z.string()).default([]),
  // Three shapes seen or documented: "id", {id}, {reason, recipient: {id}}. Anything else is
  // kept as unknown and counted as a rejection with no id, never a crash.
  rejected: z.array(z.unknown()).default([]),
  status: z.string().optional(),
});
export type DispatchResponse = z.infer<typeof DispatchResponse>;

const RejectedString = z.string();
const RejectedWithId = z.object({ id: z.string(), reason: z.string().optional() });
const RejectedWithRecipient = z.object({
  reason: z.string().optional(),
  recipient: z.object({ id: z.string() }),
});

/** Rejected entries as {id, reason}; id is null when the provider gave no usable id. */
export function rejectedEntries(r: DispatchResponse): Array<{ id: string | null; reason: string }> {
  return r.rejected.map((item) => {
    const s = RejectedString.safeParse(item);
    if (s.success) return { id: s.data, reason: 'unspecified' };
    const w = RejectedWithRecipient.safeParse(item);
    if (w.success) return { id: w.data.recipient.id, reason: w.data.reason ?? 'unspecified' };
    const i = RejectedWithId.safeParse(item);
    if (i.success) return { id: i.data.id, reason: i.data.reason ?? 'unspecified' };
    return { id: null, reason: 'unrecognised' };
  });
}

const ProviderEvent = z
  .object({
    event_id: z.string().min(1),
    type: z.string().min(1),
    recipient_id: z.string().optional().nullable(),
    occurred_at: z.string().optional().nullable(),
  })
  .passthrough();
export type ProviderEvent = z.infer<typeof ProviderEvent>;

const EventsResponse = z.object({
  events: z.array(z.unknown()).default([]),
  next_cursor: z.string().nullable().optional(),
  has_more: z.boolean().optional(),
});

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

function headers(extra: Record<string, string> = {}) {
  const env = serverEnv();
  return {
    Authorization: `Bearer ${env.PROVIDER_API_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export async function dispatchBatch(input: {
  idempotencyKey: string;
  campaign: string;
  brand: string;
  recipients: Array<z.infer<typeof Recipient>>;
}): Promise<DispatchResponse> {
  const env = serverEnv();
  const res = await fetch(`${env.PROVIDER_BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: headers({ 'Idempotency-Key': input.idempotencyKey }),
    body: JSON.stringify({
      campaign: input.campaign,
      brand: input.brand,
      recipients: input.recipients.map((r) => Recipient.parse(r)),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok)
    throw new ProviderError(
      `provider dispatch failed: HTTP ${res.status} ${text.slice(0, 200)}`,
      res.status,
    );
  const parsed = DispatchResponse.safeParse(JSON.parse(text));
  if (!parsed.success)
    throw new ProviderError(`provider dispatch response not understood: ${parsed.error.message}`);
  return parsed.data;
}

/**
 * One page of events. `since` is passed through for the day the provider honours it; the caller
 * never relies on it and the database ignores what it has already stored.
 */
export async function fetchEvents(
  batchId: string,
  since?: string | null,
): Promise<{
  events: ProviderEvent[];
  malformed: number;
  nextCursor: string | null;
  hasMore: boolean;
}> {
  const env = serverEnv();
  const url = new URL(`${env.PROVIDER_BASE_URL}/v1/messages/${encodeURIComponent(batchId)}/events`);
  if (since) url.searchParams.set('since', since);
  const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  if (!res.ok)
    throw new ProviderError(
      `provider events failed: HTTP ${res.status} ${text.slice(0, 200)}`,
      res.status,
    );
  const parsed = EventsResponse.safeParse(JSON.parse(text));
  if (!parsed.success)
    throw new ProviderError(`provider events response not understood: ${parsed.error.message}`);
  const events: ProviderEvent[] = [];
  let malformed = 0;
  for (const raw of parsed.data.events) {
    const e = ProviderEvent.safeParse(raw);
    if (e.success) events.push(e.data);
    else malformed++;
  }
  return {
    events,
    malformed,
    nextCursor: parsed.data.next_cursor ?? null,
    hasMore: parsed.data.has_more ?? false,
  };
}
