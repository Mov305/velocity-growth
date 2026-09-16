import 'server-only';

import { z } from 'zod';
import { serverEnv } from '@/lib/env';

/**
 * The VG messaging provider, as measured on 2026-09-16, not as documented.
 *
 *   POST /v1/messages with Idempotency-Key: the key alone decides. Same key returns the same
 *   batch even with a different body; no key means a new batch every time. So the key is always
 *   the send's stored idempotency_key and the body is always the frozen audience.
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

const DispatchResponse = z.object({
  batch_id: z.string().min(1),
  accepted: z.array(z.string()).default([]),
  rejected: z.array(z.union([z.string(), z.object({ id: z.string() }).passthrough()])).default([]),
  status: z.string().optional(),
});
export type DispatchResponse = z.infer<typeof DispatchResponse>;

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
