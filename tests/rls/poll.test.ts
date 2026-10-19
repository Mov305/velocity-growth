import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rlsEnv, seedLogins } from './setup';

/**
 * Drives pollSend against a mock events endpoint for two shapes the live provider can produce
 * but dispatch.test.ts does not cover: a stream longer than the per-run page cap, and a 429. The
 * sends and batches are inserted directly (status dispatched) so this file does not depend on
 * the dispatch path; everything it creates is deleted by send id.
 */

const LONG_PAGES = 25;
/** GET requests per batch id, so a test can prove a batch was never called. */
const hits = new Map<string, number>();
const longBatch = `pt-long-${randomUUID().slice(0, 8)}`;
const limited = `pt-429-${randomUUID().slice(0, 8)}`;
const quietA = `pt-quiet-a-${randomUUID().slice(0, 8)}`;
const quietB = `pt-quiet-b-${randomUUID().slice(0, 8)}`;
let server: Server;

function startMock(): Promise<string> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      const url = new URL(req.url!, 'http://x');
      const m = url.pathname.match(/^\/v1\/messages\/([^/]+)\/events$/);
      if (req.method !== 'GET' || !m) {
        res.writeHead(404);
        return res.end();
      }
      const id = m[1];
      hits.set(id, (hits.get(id) ?? 0) + 1);
      res.setHeader('Content-Type', 'application/json');
      if (id === limited) {
        res.writeHead(429);
        return res.end(JSON.stringify({ error: 'rate_limited', retry_after: 30 }));
      }
      if (id === longBatch) {
        // Page n (0-based) carries event n; the cursor for page n is `c<n>`. `since` carries the
        // cursor, as measured on the live API.
        const since = url.searchParams.get('since');
        const n = since ? Number(since.slice(1)) : 0;
        const more = n < LONG_PAGES - 1;
        res.writeHead(200);
        return res.end(
          JSON.stringify({
            events: [
              {
                event_id: `${longBatch}-ev-${n}`,
                type: 'delivered',
                recipient_id: randomUUID(),
                occurred_at: '2026-10-20T00:00:00Z',
              },
            ],
            next_cursor: more ? `c${n + 1}` : null,
            has_more: more,
          }),
        );
      }
      res.writeHead(200);
      return res.end(JSON.stringify({ events: [], next_cursor: null, has_more: false }));
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`);
    });
  });
}

const sql = postgres(rlsEnv.dbUrl, { max: 1 });
const created: string[] = [];
let brandId = '';
let campaignId = '';
let ownerId = '';

async function dispatchedSend(batchIds: string[]): Promise<string> {
  const key = `poll-test-${randomUUID()}`;
  const [send] = await sql<{ id: string }[]>`
    insert into public.sends (brand_id, campaign_id, status, audience_definition, approved_count,
                              approved_by, idempotency_key, dispatched_at)
    values (${brandId}, ${campaignId}, 'dispatched', 'poll-test', 0, ${ownerId}, ${key}, now())
    returning id`;
  created.push(send.id);
  for (const [i, b] of batchIds.entries()) {
    await sql`
      insert into public.send_batches (send_id, brand_id, chunk_index, idempotency_key, provider_batch_id, submitted_count)
      values (${send.id}, ${brandId}, ${i}, ${i === 0 ? key : `${key}:${i}`}, ${b}, 0)`;
  }
  return send.id;
}

beforeAll(async () => {
  process.env.PROVIDER_BASE_URL = await startMock();
  const l = seedLogins().find((x) => x.brand === 'MARRAKECH' && x.role === 'owner')!;
  const [u] = await sql<{ id: string }[]>`
    select id from auth.users where lower(email) = lower(${l.email})`;
  ownerId = u.id;
  const [c] = await sql<{ id: string; brand_id: string }[]>`
    select c.id, c.brand_id from public.campaigns c join public.brands b on b.id = c.brand_id
    where b.code = 'MARRAKECH' order by c.external_id limit 1`;
  campaignId = c.id;
  brandId = c.brand_id;
});

afterAll(async () => {
  if (created.length) await sql`delete from public.sends where id = any(${created})`;
  await sql.end();
  server.close();
});

describe('pollSend: page cap and rate limit', () => {
  it('a stream longer than the page cap is recorded as incomplete and the next poll resumes it', async () => {
    const { pollSend, MAX_PAGES } = await import('@/lib/send/poll');
    expect(LONG_PAGES).toBeGreaterThan(MAX_PAGES);
    const sendId = await dispatchedSend([longBatch]);

    const first = await pollSend(sendId);
    expect(first).toMatchObject({
      batches: 1,
      polled: 0,
      truncated: 1,
      failed: 0,
      pages: MAX_PAGES,
    });
    expect(first.error).toBeUndefined();
    const [b1] = await sql<{ poll_incomplete: boolean; poll_cursor: string | null }[]>`
      select poll_incomplete, poll_cursor from public.send_batches where send_id = ${sendId}`;
    expect(b1).toEqual({ poll_incomplete: true, poll_cursor: `c${MAX_PAGES}` });

    const second = await pollSend(sendId);
    expect(second).toMatchObject({ polled: 1, truncated: 0, pages: LONG_PAGES - MAX_PAGES });
    const [b2] = await sql<{ poll_incomplete: boolean; poll_cursor: string | null }[]>`
      select poll_incomplete, poll_cursor from public.send_batches where send_id = ${sendId}`;
    expect(b2).toEqual({ poll_incomplete: false, poll_cursor: null });

    // Every page's event is stored: nothing past the cap was silently lost.
    const [ev] = await sql<{ n: number }[]>`
      select count(distinct provider_event_id)::int as n from public.provider_events where send_id = ${sendId}`;
    expect(ev.n).toBe(LONG_PAGES);
  });

  it('a 429 stops the run like a 503: no further batch is called and retry_after is reported', async () => {
    const { pollSend } = await import('@/lib/send/poll');
    const sendId = await dispatchedSend([limited, quietA, quietB]);

    const r = await pollSend(sendId);
    expect(r).toMatchObject({ batches: 3, polled: 0, failed: 1, deferred: 2, pausedFor: 30 });
    expect(r.error).toMatch(/batch 1: .*HTTP 429.*provider asked to pause for 30s, run stopped/);
    expect(hits.get(limited)).toBe(1);
    expect(hits.get(quietA)).toBeUndefined();
    expect(hits.get(quietB)).toBeUndefined();
    const [send] = await sql<{ last_error: string }[]>`
      select last_error from public.sends where id = ${sendId}`;
    expect(send.last_error).toMatch(/^poll: .*429/);
  });
});

describe('pollAllDispatched: what a run does not reach is reported', () => {
  it('a run out of budget reports every pollable send it skipped, none silently left out', async () => {
    const { pollAllDispatched } = await import('@/lib/send/poll');
    await dispatchedSend([quietA]);
    const run = await pollAllDispatched({ budgetMs: 0 });
    expect(run.pollable).toBeGreaterThanOrEqual(1);
    expect(run.results).toHaveLength(0);
    expect(run.skipped).toBe(run.pollable);
    expect(run.stoppedBy).toBe('budget');
  });
});
