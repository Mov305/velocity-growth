import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rlsEnv, seedLogins, seedPasswords } from './setup';

/**
 * Drives the real dispatch and poll code against a mock provider that behaves like the live one
 * was measured to behave: the idempotency key alone decides the batch, events are duplicated, out
 * of order, paged with a cursor, and one is forged. Also a provider outage and the retry after it.
 */

type Recorded = { idem: string | null; recipients: string[] };
const calls: Recorded[] = [];
let failNext = false;
/** Fail the nth POST from now (1-based) once; simulates a crash between chunks. */
let failAtCall: number | null = null;
/**
 * Answer the next POST in a mix of shapes: the last four recipients are not accepted; one is
 * rejected in a measured shape, two in a shape nobody has seen (no usable id), one not at all.
 */
let oddShapeNext = false;
const CAP = 500;

/**
 * Tests that are not about the run budget get ten minutes, so a slow machine running the full
 * suite does not trip the 25-second pause the budget test covers on its own.
 */
const roomy = () => ({ deadlineMs: Date.now() + 10 * 60_000 });
/** Batch ids whose events endpoint answers 503 once, the way the live one did mid-walk. */
const failEventsFor = new Set<string>();
let server: Server;
let baseUrl = '';
const batches = new Map<string, { id: string; recipients: string[] }>();

function startMock(): Promise<void> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const url = new URL(req.url!, 'http://x');
        if (req.method === 'POST' && url.pathname === '/v1/messages') {
          if (failNext || (failAtCall !== null && --failAtCall === 0)) {
            failNext = false;
            failAtCall = null;
            res.writeHead(503, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'unavailable' }));
          }
          const idem = req.headers['idempotency-key'] as string | undefined;
          const all = JSON.parse(body).recipients as Array<{
            id: string;
            email: string | null;
            phone: string | null;
          }>;
          calls.push({ idem: idem ?? null, recipients: all.map((r) => r.id) });
          let batch = idem ? batches.get(idem) : undefined;
          if (!batch) {
            // The measured cap: 500 accepted, the rest rejected with the measured shape.
            batch = {
              id: `batch_${Math.random().toString(16).slice(2, 10)}`,
              recipients: all.slice(0, CAP).map((r) => r.id),
            };
            if (idem) batches.set(idem, batch);
          }
          if (oddShapeNext) {
            oddShapeNext = false;
            const ids = batch.recipients;
            const tail = ids.slice(-4);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(
              JSON.stringify({
                batch_id: batch.id,
                accepted: ids.slice(0, -4),
                rejected: [
                  { reason: 'invalid_recipient', recipient: { id: tail[0] } },
                  { code: 'E_WEIRD', target: tail[1] },
                  { code: 'E_WEIRD', target: tail[2] },
                ],
                status: 'accepted',
              }),
            );
          }
          const over = all.slice(CAP);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(
            JSON.stringify({
              batch_id: batch.id,
              accepted: batch.recipients,
              accepted_count: batch.recipients.length,
              rejected: over.map((r) => ({ reason: 'recipient_cap_exceeded', recipient: r })),
              rejected_count: over.length,
              status: 'accepted',
            }),
          );
        }
        const m = url.pathname.match(/^\/v1\/messages\/([^/]+)\/events$/);
        if (req.method === 'GET' && m) {
          if (failEventsFor.has(m[1])) {
            failEventsFor.delete(m[1]);
            res.writeHead(503, { 'Content-Type': 'application/json' });
            return res.end(
              JSON.stringify({
                error: 'service_unavailable',
                message: 'reports temporarily unavailable',
                retry_after: 22,
              }),
            );
          }
          const batch = [...batches.values()].find((b) => b.id === m[1]);
          if (!batch) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'not_found' }));
          }
          const [r1, r2] = batch.recipients;
          const since = url.searchParams.get('since');
          const page1 = [
            {
              event_id: 'ev-3',
              type: 'opened',
              recipient_id: r1,
              occurred_at: '2026-09-16T12:01:49Z',
            },
            {
              event_id: 'ev-1',
              type: 'delivered',
              recipient_id: r1,
              occurred_at: '2026-09-16T11:53:38Z',
            },
            {
              event_id: 'ev-1',
              type: 'delivered',
              recipient_id: r1,
              occurred_at: '2026-09-16T11:53:38Z',
            },
            {
              event_id: 'ev-forged',
              type: 'delivered',
              recipient_id: 'CT-06014',
              occurred_at: '2026-09-16T11:54:44Z',
            },
            { garbage: true },
          ];
          const page2 = [
            {
              event_id: 'ev-2',
              type: 'unsubscribed',
              recipient_id: r2,
              occurred_at: '2026-09-16T11:55:00Z',
            },
            {
              event_id: 'ev-4',
              type: 'delivered',
              recipient_id: r2,
              occurred_at: '2026-09-16T11:59:00Z',
            },
            {
              event_id: 'ev-3',
              type: 'opened',
              recipient_id: r1,
              occurred_at: '2026-09-16T12:01:49Z',
            },
          ];
          res.writeHead(200, { 'Content-Type': 'application/json' });
          if (since === 'cur-2')
            return res.end(JSON.stringify({ events: page2, next_cursor: null, has_more: false }));
          return res.end(JSON.stringify({ events: page1, next_cursor: 'cur-2', has_more: true }));
        }
        res.writeHead(404);
        res.end();
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
      resolve();
    });
  });
}

const sql = postgres(rlsEnv.dbUrl, { max: 1 });

async function loginKilele(): Promise<SupabaseClient> {
  const l = seedLogins().find((x) => x.brand === 'KILELE' && x.role === 'owner')!;
  const c = createClient(rlsEnv.url, rlsEnv.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c.auth.signInWithPassword({
    email: l.email,
    password: seedPasswords()[l.email],
  });
  if (error) throw error;
  return c;
}
let owner: SupabaseClient;
let campaignId = '';
const created: string[] = [];

beforeAll(async () => {
  await startMock();
  process.env.PROVIDER_BASE_URL = baseUrl;
  const l = seedLogins().find((x) => x.brand === 'MARRAKECH' && x.role === 'owner')!;
  owner = createClient(rlsEnv.url, rlsEnv.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await owner.auth.signInWithPassword({
    email: l.email,
    password: seedPasswords()[l.email],
  });
  if (error) throw error;
  const { data } = await owner
    .from('campaigns')
    .select('id')
    .eq('external_id', 'MAR-0002')
    .single();
  campaignId = data!.id;
});

afterAll(async () => {
  if (created.length) await sql`delete from public.sends where id = any(${created})`;
  await sql.end();
  server.close();
});

describe('dispatch and poll against a misbehaving provider', () => {
  it('sends the whole frozen audience when it is far larger than one PostgREST page', async () => {
    const { dispatchSend } = await import('@/lib/send/dispatch');
    const l = seedLogins().find((x) => x.brand === 'KILELE' && x.role === 'owner')!;
    const kilele = createClient(rlsEnv.url, rlsEnv.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await kilele.auth.signInWithPassword({
      email: l.email,
      password: seedPasswords()[l.email],
    });
    if (error) throw error;
    const { data: camp } = await kilele
      .from('campaigns')
      .select('id')
      .eq('external_id', 'KIL-0001')
      .single();
    const { data: sendId } = await kilele.rpc('approve_send', { p_campaign_id: camp!.id });
    created.push(sendId!);
    const [row] = await sql`select approved_count from public.sends where id = ${sendId!}`;
    expect(row.approved_count).toBeGreaterThan(1000);
    const before = calls.length;
    const out = await dispatchSend(kilele as never, sendId!, roomy());
    expect(out.kind).toBe('dispatched');
    const expectedBatches = Math.ceil(row.approved_count / CAP);
    expect(calls.length - before).toBe(expectedBatches);
    const mine = calls.slice(before);
    expect(mine.every((c) => c.recipients.length <= CAP)).toBe(true);
    expect(mine.reduce((n, c) => n + c.recipients.length, 0)).toBe(row.approved_count);
    const [send] =
      await sql`select idempotency_key, provider_accepted, provider_rejected from public.sends where id = ${sendId!}`;
    expect(mine[0].idem).toBe(send.idempotency_key);
    expect(mine[1].idem).toBe(`${send.idempotency_key}:1`);
    expect(new Set(mine.map((c) => c.idem)).size).toBe(expectedBatches);
    expect(send.provider_accepted).toBe(row.approved_count);
    expect(send.provider_rejected).toBe(0);
    const [b] =
      await sql`select count(*)::int as n from public.send_batches where send_id = ${sendId!}`;
    expect(b.n).toBe(expectedBatches);
    const [acc] =
      await sql`select count(*)::int as n from public.send_recipients where send_id = ${sendId!} and status = 'accepted'`;
    expect(acc.n).toBe(row.approved_count);
  });

  it('a 503 on one batch ends the run with the rest deferred, and the next run takes those first', async () => {
    const { dispatchSend } = await import('@/lib/send/dispatch');
    const { pollSend } = await import('@/lib/send/poll');
    const l = seedLogins().find((x) => x.brand === 'KILELE' && x.role === 'owner')!;
    const kilele = createClient(rlsEnv.url, rlsEnv.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await kilele.auth.signInWithPassword({
      email: l.email,
      password: seedPasswords()[l.email],
    });
    if (error) throw error;
    const { data: camp } = await kilele
      .from('campaigns')
      .select('id')
      .eq('external_id', 'KIL-0005')
      .single();
    const { data: sendId } = await kilele.rpc('approve_send', { p_campaign_id: camp!.id });
    created.push(sendId!);
    const out = await dispatchSend(kilele as never, sendId!, roomy());
    expect(out.kind).toBe('dispatched');
    const rows = await sql<{ provider_batch_id: string; chunk_index: number }[]>`
      select provider_batch_id, chunk_index from public.send_batches where send_id = ${sendId!} order by chunk_index`;
    expect(rows.length).toBeGreaterThan(3);
    failEventsFor.add(rows[2].provider_batch_id);

    const first = await pollSend(sendId!);
    expect(first.polled).toBe(2);
    expect(first.failed).toBe(1);
    expect(first.deferred).toBe(rows.length - 3);
    expect(first.error).toMatch(/1 of \d+ batches did not answer: batch 3: .*503/);
    const [send1] = await sql<{ last_error: string }[]>`
      select last_error from public.sends where id = ${sendId!}`;
    expect(send1.last_error).toMatch(/^poll: /);

    // A run with no time left walks nothing and defers everything, honestly.
    const none = await pollSend(sendId!, { deadlineMs: Date.now() - 1 });
    expect(none.polled).toBe(0);
    expect(none.deferred).toBe(rows.length);

    const second = await pollSend(sendId!);
    expect(second.error).toBeUndefined();
    expect(second.failed).toBe(0);
    // The two batches walked first time are polled last this time; everything gets walked.
    expect(second.polled).toBe(rows.length);
    const [send2] = await sql<{ last_error: string | null }[]>`
      select last_error from public.sends where id = ${sendId!}`;
    expect(send2.last_error).toBeNull();
    const polled = await sql<{ n: number }[]>`
      select count(*)::int as n from public.send_batches where send_id = ${sendId!} and last_polled_at is not null`;
    expect(polled[0].n).toBe(rows.length);
  });

  it('a crash between chunks resumes from the next chunk and re-sends nothing', async () => {
    const { dispatchSend } = await import('@/lib/send/dispatch');
    const l = seedLogins().find((x) => x.brand === 'KILELE' && x.role === 'owner')!;
    const kilele = createClient(rlsEnv.url, rlsEnv.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await kilele.auth.signInWithPassword({
      email: l.email,
      password: seedPasswords()[l.email],
    });
    if (error) throw error;
    const { data: camp } = await kilele
      .from('campaigns')
      .select('id')
      .eq('external_id', 'KIL-0004')
      .single();
    const { data: sendId } = await kilele.rpc('approve_send', { p_campaign_id: camp!.id });
    created.push(sendId!);
    const [row] = await sql`select approved_count from public.sends where id = ${sendId!}`;
    const expectedBatches = Math.ceil(row.approved_count / CAP);
    expect(expectedBatches).toBeGreaterThan(2);

    failAtCall = 3; // chunks 0 and 1 succeed, chunk 2 hits the outage
    const before = calls.length;
    const first = await dispatchSend(kilele as never, sendId!, roomy());
    expect(first.kind).toBe('failed');
    expect(calls.length - before).toBe(2);
    // The outcome says what already reached the provider, read back from the database.
    if (first.kind !== 'failed') throw new Error('unreachable');
    const [q] = await sql<{ queued: number; withheld: number }[]>`
      select count(*) filter (where status = 'queued')::int as queued,
             count(*) filter (where status = 'withheld')::int as withheld
      from public.send_recipients where send_id = ${sendId!}`;
    expect(first.progress).toEqual({
      recordedBatches: 2,
      totalBatches: expectedBatches,
      handedOver: 2 * CAP,
      remaining: q.queued,
      withheld: q.withheld,
    });
    expect(q.queued).toBe(row.approved_count - 2 * CAP - q.withheld);
    const { describeDispatchProgress } = await import('@/lib/send/describe-error');
    const said = describeDispatchProgress(first.progress);
    expect(said).toContain(`2 of ${expectedBatches} batches (1,000 recipients)`);
    expect(said).not.toMatch(/Nothing was/);
    const [mid] =
      await sql`select status, provider_batch_id from public.sends where id = ${sendId!}`;
    expect(mid.status).toBe('failed');
    expect(mid.provider_batch_id).toBeNull();
    const [recorded] =
      await sql`select count(*)::int as n from public.send_batches where send_id = ${sendId!}`;
    expect(recorded.n).toBe(2);

    const retryFrom = calls.length;
    const second = await dispatchSend(kilele as never, sendId!, roomy());
    expect(second.kind).toBe('dispatched');
    // Only the chunks that were not recorded are posted again, under their own keys.
    expect(calls.length - retryFrom).toBe(expectedBatches - 2);
    const [send] =
      await sql`select status, idempotency_key, provider_accepted from public.sends where id = ${sendId!}`;
    expect(send.status).toBe('dispatched');
    expect(calls[retryFrom].idem).toBe(`${send.idempotency_key}:2`);
    expect(send.provider_accepted).toBe(row.approved_count);
    const [all] =
      await sql`select count(*)::int as n from public.send_batches where send_id = ${sendId!}`;
    expect(all.n).toBe(expectedBatches);
  });

  it('a run out of time pauses after the chunk it started, says how far it got, and the resume finishes', async () => {
    const { dispatchSend } = await import('@/lib/send/dispatch');
    const kilele = await loginKilele();
    const { data: camp } = await kilele
      .from('campaigns')
      .select('id')
      .eq('external_id', 'KIL-0006')
      .single();
    const { data: sendId } = await kilele.rpc('approve_send', { p_campaign_id: camp!.id });
    created.push(sendId!);
    const [row] = await sql`select approved_count from public.sends where id = ${sendId!}`;
    const expectedBatches = Math.ceil(row.approved_count / CAP);
    expect(expectedBatches).toBeGreaterThan(2);

    const before = calls.length;
    const first = await dispatchSend(kilele as never, sendId!, { deadlineMs: Date.now() - 1 });
    expect(first.kind).toBe('paused');
    expect(calls.length - before).toBe(1); // one chunk per run at least, then the budget stops it
    if (first.kind !== 'paused') throw new Error('unreachable');
    expect(first.progress).toMatchObject({
      recordedBatches: 1,
      totalBatches: expectedBatches,
      handedOver: CAP,
    });
    const [mid] =
      await sql`select status, last_error, provider_batch_id from public.sends where id = ${sendId!}`;
    expect(mid.status).toBe('failed');
    expect(mid.last_error).toMatch(/^paused: /);
    expect(mid.provider_batch_id).toBeNull();

    const second = await dispatchSend(kilele as never, sendId!, roomy());
    expect(second.kind).toBe('dispatched');
    expect(calls.length - before).toBe(expectedBatches);
  });

  it('recipients the provider names neither way are unaccounted, and unknown-shape rejections are counted', async () => {
    const { dispatchSend } = await import('@/lib/send/dispatch');
    const { data: camp } = await owner
      .from('campaigns')
      .select('id')
      .eq('external_id', 'MAR-0003')
      .single();
    const { data: sendId } = await owner.rpc('approve_send', { p_campaign_id: camp!.id });
    created.push(sendId!);
    const [row] = await sql`select approved_count from public.sends where id = ${sendId!}`;
    expect(row.approved_count).toBeGreaterThan(4);
    expect(row.approved_count).toBeLessThanOrEqual(CAP);

    oddShapeNext = true;
    const out = await dispatchSend(owner as never, sendId!);
    expect(out.kind).toBe('dispatched');
    if (out.kind !== 'dispatched') throw new Error('unreachable');
    expect(out).toMatchObject({
      accepted: row.approved_count - 4,
      rejected: 1,
      unaccounted: 3,
      unidentifiedRejections: 2,
    });
    const tail = calls[calls.length - 1].recipients.slice(-4);
    const statuses = await sql<{ contact_id: string; status: string }[]>`
      select contact_id, status from public.send_recipients
      where send_id = ${sendId!} and contact_id = any(${tail})`;
    const byId = Object.fromEntries(statuses.map((x) => [x.contact_id, x.status]));
    expect(byId[tail[0]]).toBe('rejected');
    expect([byId[tail[1]], byId[tail[2]], byId[tail[3]]]).toEqual([
      'unaccounted',
      'unaccounted',
      'unaccounted',
    ]);
    const [queued] =
      await sql`select count(*)::int as n from public.send_recipients where send_id = ${sendId!} and status = 'queued'`;
    expect(queued.n).toBe(0);
    const [b] = await sql`
      select submitted_count, accepted_count, rejected_count, unaccounted_count, unidentified_rejections, rejection_reasons
      from public.send_batches where send_id = ${sendId!}`;
    expect(b).toMatchObject({
      submitted_count: row.approved_count,
      accepted_count: row.approved_count - 4,
      rejected_count: 1,
      unaccounted_count: 3,
      unidentified_rejections: 2,
    });
    expect(b.rejection_reasons).toEqual({ invalid_recipient: 1, unrecognised: 2 });
    const outcomes = await owner.rpc('send_outcomes', { p_send_id: sendId! });
    expect(outcomes.data![0]).toMatchObject({
      unaccounted: 3,
      unidentified_rejections: 2,
      total: row.approved_count,
    });

    // A delivery report for an unaccounted recipient is evidence it was sent; it moves forward.
    await sql`select * from public.ingest_provider_events(${sendId!}, ${sql.json([
      { event_id: 'ev-unacc', type: 'delivered', recipient_id: tail[1] },
    ])})`;
    const [moved] =
      await sql`select status from public.send_recipients where send_id = ${sendId!} and contact_id = ${tail[1]}`;
    expect(moved.status).toBe('delivered');
  });

  it('recipients who became uncontactable after approval are withheld at hand-over, never posted, and still counted', async () => {
    const { dispatchSend } = await import('@/lib/send/dispatch');
    const { data: camp } = await owner
      .from('campaigns')
      .select('id')
      .eq('external_id', 'MAR-0004')
      .single();
    const { data: sendId } = await owner.rpc('approve_send', { p_campaign_id: camp!.id });
    created.push(sendId!);
    const [row] = await sql`select approved_count from public.sends where id = ${sendId!}`;
    expect(row.approved_count).toBeGreaterThan(3);
    const picked = (
      await sql<{ contact_id: string }[]>`
        select contact_id from public.send_recipients where send_id = ${sendId!}
        order by contact_id limit 3`
    ).map((r) => r.contact_id);
    const original = await sql<
      { id: string; status: string; deleted_at: Date | null; consent_marketing: boolean }[]
    >`select id, status, deleted_at, consent_marketing from public.contacts where id = any(${picked})`;
    try {
      // Between approval and confirm: one unsubscribes, one is deleted, one withdraws consent.
      await sql`update public.contacts set status = 'unsubscribed' where id = ${picked[0]}`;
      await sql`update public.contacts set deleted_at = now() where id = ${picked[1]}`;
      await sql`update public.contacts set consent_marketing = false where id = ${picked[2]}`;

      const before = calls.length;
      const out = await dispatchSend(owner as never, sendId!);
      expect(out.kind).toBe('dispatched');
      if (out.kind !== 'dispatched') throw new Error('unreachable');
      expect(out.withheld).toBe(3);
      const posted = calls.slice(before).flatMap((c) => c.recipients);
      expect(posted).toHaveLength(row.approved_count - 3);
      for (const id of picked) expect(posted).not.toContain(id);

      const rows = await sql<{ contact_id: string; status: string; withheld_reason: string }[]>`
        select contact_id, status, withheld_reason from public.send_recipients
        where send_id = ${sendId!} and contact_id = any(${picked})`;
      const byId = Object.fromEntries(rows.map((x) => [x.contact_id, x]));
      expect(byId[picked[0]]).toMatchObject({
        status: 'withheld',
        withheld_reason: 'unsubscribed, bounced or complained',
      });
      expect(byId[picked[1]]).toMatchObject({ status: 'withheld', withheld_reason: 'deleted' });
      expect(byId[picked[2]]).toMatchObject({
        status: 'withheld',
        withheld_reason: 'consent withdrawn',
      });

      const [send] =
        await sql`select approved_count, provider_accepted from public.sends where id = ${sendId!}`;
      expect(send.approved_count).toBe(row.approved_count); // frozen
      expect(send.provider_accepted).toBe(row.approved_count - 3);
      const outcomes = await owner.rpc('send_outcomes', { p_send_id: sendId! });
      const o = outcomes.data![0];
      expect(o.withheld).toBe(3);
      expect(o.total).toBe(row.approved_count);
      expect(o.withheld_reasons).toEqual({
        'unsubscribed, bounced or complained': 1,
        deleted: 1,
        'consent withdrawn': 1,
      });
      // A late event for a withheld recipient moves nothing: it was never posted.
      await sql`select * from public.ingest_provider_events(${sendId!}, ${sql.json([
        { event_id: 'ev-withheld', type: 'delivered', recipient_id: picked[2] },
      ])})`;
      const [still] =
        await sql`select status from public.send_recipients where send_id = ${sendId!} and contact_id = ${picked[2]}`;
      expect(still.status).toBe('withheld');
    } finally {
      for (const c of original) {
        await sql`update public.contacts set status = ${c.status}, deleted_at = ${c.deleted_at},
          consent_marketing = ${c.consent_marketing} where id = ${c.id}`;
      }
    }
  });

  it('two concurrent confirms make exactly one provider call, with the stored idempotency key', async () => {
    const { dispatchSend } = await import('@/lib/send/dispatch');
    const { data: sendId } = await owner.rpc('approve_send', { p_campaign_id: campaignId });
    created.push(sendId!);
    const before = calls.length;
    const [a, b] = await Promise.all([
      dispatchSend(owner as never, sendId!),
      dispatchSend(owner as never, sendId!),
    ]);
    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(['already', 'dispatched']);
    expect(calls.length - before).toBe(1);
    const [row] =
      await sql`select status, provider_batch_id, idempotency_key, approved_count, provider_accepted from public.sends where id = ${sendId!}`;
    expect(row.status).toBe('dispatched');
    expect(row.approved_count).toBeLessThanOrEqual(CAP);
    expect(calls[calls.length - 1].idem).toBe(row.idempotency_key);
    expect(calls[calls.length - 1].recipients).toHaveLength(row.approved_count);
    expect(row.provider_accepted).toBe(row.approved_count);
    const [acc] =
      await sql`select count(*)::int as n from public.send_recipients where send_id = ${sendId!} and status = 'accepted'`;
    expect(acc.n).toBe(row.approved_count);
  });

  it('a provider outage leaves the send failed with nothing sent; the retry reuses the same key', async () => {
    const { dispatchSend } = await import('@/lib/send/dispatch');
    const { data: sendId } = await owner.rpc('approve_send', { p_campaign_id: campaignId });
    created.push(sendId!);
    failNext = true;
    const first = await dispatchSend(owner as never, sendId!);
    expect(first.kind).toBe('failed');
    const [row1] =
      await sql`select status, provider_batch_id, last_error from public.sends where id = ${sendId!}`;
    expect(row1.status).toBe('failed');
    expect(row1.provider_batch_id).toBeNull();
    expect(row1.last_error).toMatch(/503/);
    if (first.kind !== 'failed') throw new Error('unreachable');
    expect(first.progress).toMatchObject({ recordedBatches: 0, handedOver: 0 });
    const before = calls.length;
    const second = await dispatchSend(owner as never, sendId!);
    expect(second.kind).toBe('dispatched');
    const [row2] =
      await sql`select status, idempotency_key from public.sends where id = ${sendId!}`;
    expect(row2.status).toBe('dispatched');
    expect(calls[before].idem).toBe(row2.idempotency_key);
  });

  it('polling stores each event once across pages, ignores the forged and malformed ones, and moves statuses forward only', async () => {
    const { dispatchSend } = await import('@/lib/send/dispatch');
    const { pollSend } = await import('@/lib/send/poll');
    const { data: sendId } = await owner.rpc('approve_send', { p_campaign_id: campaignId });
    created.push(sendId!);
    await dispatchSend(owner as never, sendId!);
    const first = await pollSend(sendId!);
    expect(first.error).toBeUndefined();
    expect(first.pages).toBe(2);
    expect(first).toMatchObject({
      received: 7,
      malformed: 1,
      inserted: 5,
      duplicates: 2,
      unknownRecipients: 1,
    });
    const again = await pollSend(sendId!);
    expect(again).toMatchObject({ inserted: 0, duplicates: 7 });
    const [batch] = await sql`select provider_batch_id from public.sends where id = ${sendId!}`;
    const b = [...batches.values()].find((x) => x.id === batch.provider_batch_id)!;
    const statuses = await sql<{ contact_id: string; status: string }[]>`
      select contact_id, status from public.send_recipients where send_id = ${sendId!} and contact_id in (${b.recipients[0]}, ${b.recipients[1]})`;
    const byId = Object.fromEntries(statuses.map((s) => [s.contact_id, s.status]));
    expect(byId[b.recipients[0]]).toBe('opened');
    expect(byId[b.recipients[1]]).toBe('unsubscribed');
    const outcomes = await owner.rpc('send_outcomes', { p_send_id: sendId! });
    expect(outcomes.data![0]).toMatchObject({ opened: 1, unsubscribed: 1, events: 5 });
  });
});

describe('review fixes, 2026-10-20 (second round)', () => {
  it('a replayed batch moves a withheld recipient it names rejected to rejected; one it does not name stays withheld', async () => {
    const { data: camp } = await owner
      .from('campaigns')
      .select('id')
      .eq('external_id', 'MAR-0006')
      .single();
    const { data: sendId } = await owner.rpc('approve_send', { p_campaign_id: camp!.id });
    created.push(sendId!);
    const members = (
      await sql<{ contact_id: string }[]>`
        select contact_id from public.send_recipients where send_id = ${sendId!} order by contact_id`
    ).map((r) => r.contact_id);
    expect(members.length).toBeGreaterThan(4);
    const [r0, r1, r2, r3] = members;
    // A crashed run posted the chunk; this run withheld r0, r1 and r2 before re-posting it.
    await sql`update public.sends set status = 'dispatching', dispatch_started_at = now() where id = ${sendId!}`;
    await sql`update public.send_recipients set status = 'withheld', withheld_reason = 'consent withdrawn'
      where send_id = ${sendId!} and contact_id = any(${[r0, r1, r2]}::uuid[])`;
    // The key replays the original batch: it names r0 accepted and r1 rejected, and names neither
    // r2 (withheld) nor r3 (queued).
    const accepted = members.filter((id) => ![r1, r2, r3].includes(id));
    const [rec] = await sql<
      { accepted: number; rejected: number; unaccounted: number; submitted: number }[]
    >`select * from public.record_send_batch(${sendId!}, 0, 'replay-key', 'batch_replay',
        ${members}::uuid[], ${accepted}::uuid[], ${[r1]}::uuid[], '{}'::jsonb, 0)`;
    expect(rec).toEqual({
      accepted: members.length - 3,
      rejected: 1,
      unaccounted: 1,
      submitted: members.length - 1,
    });
    const rows = await sql<
      { contact_id: string; status: string; withheld_reason: string | null }[]
    >`
      select contact_id, status::text as status, withheld_reason from public.send_recipients
      where send_id = ${sendId!} and contact_id = any(${[r0, r1, r2, r3]}::uuid[])`;
    const byId = Object.fromEntries(rows.map((x) => [x.contact_id, x]));
    expect(byId[r0]).toMatchObject({ status: 'accepted', withheld_reason: null });
    expect(byId[r1]).toMatchObject({ status: 'rejected', withheld_reason: null });
    expect(byId[r2]).toMatchObject({ status: 'withheld', withheld_reason: 'consent withdrawn' });
    expect(byId[r3]).toMatchObject({ status: 'unaccounted', withheld_reason: null });
    await sql`update public.sends set status = 'failed', last_error = 'test' where id = ${sendId!}`;
  });

  it('a send whose every recipient was withheld fails with nothing posted, and approving again freezes a new audience', async () => {
    const { dispatchSend } = await import('@/lib/send/dispatch');
    const { data: camp } = await owner
      .from('campaigns')
      .select('id')
      .eq('external_id', 'MAR-0005')
      .single();
    const { data: first } = await owner.rpc('approve_send', { p_campaign_id: camp!.id });
    created.push(first!);
    // Recipients are marked withheld directly so no contact row changes under other test files.
    await sql`update public.send_recipients set status = 'withheld', withheld_reason = 'deleted'
      where send_id = ${first!}`;
    const [{ n: needed }] = await sql<{ n: number }[]>`
      select public.send_batches_needed(${first!}, ${CAP}) as n`;
    expect(needed).toBe(0);
    const before = calls.length;
    const out = await dispatchSend(owner as never, first!);
    expect(calls.length).toBe(before);
    expect(out.kind).toBe('failed');
    if (out.kind !== 'failed') throw new Error('unreachable');
    expect(out.error).toMatch(/every approved recipient became uncontactable/);
    expect(out.progress).toMatchObject({ recordedBatches: 0, totalBatches: 0, remaining: 0 });

    const { data: second, error } = await owner.rpc('approve_send', { p_campaign_id: camp!.id });
    expect(error).toBeNull();
    created.push(second!);
    expect(second).not.toBe(first);
    const [s2] = await sql<{ status: string; approved_count: number }[]>`
      select status::text as status, approved_count from public.sends where id = ${second!}`;
    expect(s2.status).toBe('approved');
    expect(s2.approved_count).toBeGreaterThan(0);
    // The new send is in flight, so approving again returns it rather than a third audience.
    const { data: third } = await owner.rpc('approve_send', { p_campaign_id: camp!.id });
    expect(third).toBe(second);
    const [s1] = await sql<{ status: string }[]>`
      select status::text as status from public.sends where id = ${first!}`;
    expect(s1.status).toBe('failed');
  });

  it('the backfill moves queued recipients of old dispatched sends to unaccounted, batch by batch, once', async () => {
    const migration = readFileSync(
      'supabase/migrations/20261020000300_send_review_fixes_2.sql',
      'utf8',
    );
    const backfill = migration.slice(
      migration.indexOf('-- 1 ----'),
      migration.indexOf('-- 2 ----'),
    );
    expect(backfill).toMatch(/^-- 1 -+\r?\ndo \$\$/);
    const l = seedLogins().find((x) => x.brand === 'KAROO' && x.role === 'owner')!;
    const [u] = await sql<{ id: string }[]>`
      select id from auth.users where lower(email) = lower(${l.email})`;
    const [c] = await sql<{ id: string; brand_id: string }[]>`
      select c.id, c.brand_id from public.campaigns c join public.brands b on b.id = c.brand_id
      where b.code = 'KAROO' and c.external_id = 'KAR-0010'`;

    // An old send of 1,001 cut into chunks 0, 1, 2, every chunk recorded; and an older one of
    // 600 from before batching, one batch for everybody. The old record_send_batch left the
    // recipients the provider did not name queued.
    const oldSend = async (size: number, chunks: number, queuedAt: number[]) => {
      const key = `backfill-${Math.random().toString(16).slice(2)}`;
      const [s] = await sql<{ id: string }[]>`
        insert into public.sends (brand_id, campaign_id, status, audience_definition, approved_count,
                                  approved_by, idempotency_key, dispatched_at, provider_batch_id)
        values (${c.brand_id}, ${c.id}, 'dispatched', 'backfill-test', ${size}, ${u.id}, ${key},
                now(), ${`${key}-b0`})
        returning id`;
      created.push(s.id);
      await sql`
        insert into public.send_recipients (send_id, contact_id, brand_id, status)
        select ${s.id}, x.id, ${c.brand_id},
               (case when x.pos = any(${queuedAt}::int[]) then 'queued' else 'accepted' end)::public.recipient_status
        from (select id, (row_number() over (order by id))::int - 1 as pos
              from public.contacts where brand_id = ${c.brand_id} order by id limit ${size}) x`;
      for (let i = 0; i < chunks; i++) {
        const lo = i * CAP;
        const hi = chunks === 1 ? size : Math.min(size, lo + CAP);
        const acc = hi - lo - queuedAt.filter((p) => p >= lo && p < hi).length;
        await sql`
          insert into public.send_batches (send_id, brand_id, chunk_index, idempotency_key,
            provider_batch_id, accepted_count, rejected_count, submitted_count)
          values (${s.id}, ${c.brand_id}, ${i}, ${i === 0 ? key : `${key}:${i}`}, ${`${key}-b${i}`},
                  ${acc}, 0, ${acc})`;
      }
      return s.id;
    };
    const chunked = await oldSend(1001, 3, [0, 1, 499, 500, 1000]);
    const single = await oldSend(600, 1, [0, 550, 599]);

    const state = async (id: string) => ({
      batches: [
        ...(await sql`
          select chunk_index, accepted_count, unaccounted_count, submitted_count
          from public.send_batches where send_id = ${id} order by chunk_index`),
      ],
      statuses: [
        ...(await sql`
          select status::text as status, count(*)::int as n from public.send_recipients
          where send_id = ${id} group by 1 order by 1`),
      ],
    });
    await sql.unsafe(backfill);
    const a = await state(chunked);
    const b = await state(single);
    expect(a.batches).toEqual([
      { chunk_index: 0, accepted_count: 497, unaccounted_count: 3, submitted_count: 500 },
      { chunk_index: 1, accepted_count: 499, unaccounted_count: 1, submitted_count: 500 },
      { chunk_index: 2, accepted_count: 0, unaccounted_count: 1, submitted_count: 1 },
    ]);
    expect(a.statuses).toEqual([
      { status: 'accepted', n: 996 },
      { status: 'unaccounted', n: 5 },
    ]);
    expect(b.batches).toEqual([
      { chunk_index: 0, accepted_count: 597, unaccounted_count: 3, submitted_count: 600 },
    ]);
    // Running it again changes nothing.
    await sql.unsafe(backfill);
    expect(await state(chunked)).toEqual(a);
    expect(await state(single)).toEqual(b);
  });
});
