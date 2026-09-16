/**
 * Live verification of the messaging provider against its documentation. Sends one tiny batch of
 * synthetic recipients twice with the same Idempotency-Key, then reads the event stream, and
 * prints exactly what came back so the README can record measured behaviour, not the docs' claims.
 *
 * Run: pnpm exec tsx scripts/verify-provider.ts     (reads PROVIDER_* from .env.local)
 */
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';

config({ path: process.env.ENV_FILE ?? '.env.local', quiet: true });
const base = process.env.PROVIDER_BASE_URL!;
const key = process.env.PROVIDER_API_KEY!;
if (!base || !key) throw new Error('PROVIDER_BASE_URL / PROVIDER_API_KEY missing');

const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

async function post(idem: string, body: unknown) {
  const t = Date.now();
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: { ...headers, 'Idempotency-Key': idem },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    ms: Date.now() - t,
    body: text.slice(0, 1500),
    hdr: Object.fromEntries(res.headers),
  };
}

async function events(batchId: string, since?: string) {
  const url = new URL(`${base}/v1/messages/${batchId}/events`);
  if (since) url.searchParams.set('since', since);
  const res = await fetch(url, { headers });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 4000) };
}

async function main() {
  const idem = randomUUID();
  const recipients = [
    { id: randomUUID(), email: 'verify-a@vg-eval.test' },
    { id: randomUUID(), email: 'verify-b@vg-eval.test' },
    { id: randomUUID(), email: 'verify-c@vg-eval.test' },
  ];
  const body = { campaign: 'provider-verification', brand: 'VERIFY', recipients };

  console.log('=== POST /v1/messages (first)');
  const first = await post(idem, body);
  console.log(first.status, first.ms + 'ms', first.body);
  console.log('=== POST /v1/messages (same Idempotency-Key, same body)');
  const second = await post(idem, body);
  console.log(second.status, second.ms + 'ms', second.body);
  console.log('=== POST /v1/messages (same key, DIFFERENT body)');
  const third = await post(idem, { ...body, recipients: recipients.slice(0, 1) });
  console.log(third.status, third.ms + 'ms', third.body);

  const batchId = JSON.parse(first.body).batch_id as string;
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    console.log(`=== GET events (attempt ${i + 1}, no since)`);
    const e = await events(batchId);
    console.log(e.status, e.body);
  }
  console.log('=== GET events with bogus since');
  console.log(JSON.stringify(await events(batchId, 'not-a-real-event-id')));
  console.log('=== GET events for unknown batch');
  console.log(JSON.stringify(await events('does-not-exist')));
  console.log('=== POST without Idempotency-Key, twice (does the provider dedupe by body?)');
  const a = await post('', body);
  const b = await post('', body);
  console.log(a.status, a.body.slice(0, 200));
  console.log(b.status, b.body.slice(0, 200));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
