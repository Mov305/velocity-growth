import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createServer, type Server } from 'node:http';
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
          if (failNext) {
            failNext = false;
            res.writeHead(503, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'unavailable' }));
          }
          const idem = req.headers['idempotency-key'] as string | undefined;
          const recipients = (JSON.parse(body).recipients as Array<{ id: string }>).map(
            (r) => r.id,
          );
          calls.push({ idem: idem ?? null, recipients });
          let batch = idem ? batches.get(idem) : undefined;
          if (!batch) {
            batch = { id: `batch_${Math.random().toString(16).slice(2, 10)}`, recipients };
            if (idem) batches.set(idem, batch);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(
            JSON.stringify({
              batch_id: batch.id,
              accepted: batch.recipients,
              rejected: [],
              status: 'accepted',
            }),
          );
        }
        const m = url.pathname.match(/^\/v1\/messages\/([^/]+)\/events$/);
        if (req.method === 'GET' && m) {
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
    const out = await dispatchSend(kilele as never, sendId!);
    expect(out.kind).toBe('dispatched');
    expect(calls.length - before).toBe(1);
    expect(calls[calls.length - 1].recipients).toHaveLength(row.approved_count);
    const [acc] =
      await sql`select count(*)::int as n from public.send_recipients where send_id = ${sendId!} and status = 'accepted'`;
    expect(acc.n).toBe(row.approved_count);
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
