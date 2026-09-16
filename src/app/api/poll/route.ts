import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { serverEnv } from '@/lib/env';
import { pollAllDispatched } from '@/lib/send/poll';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function secretMatches(given: string | null, expected: string): boolean {
  if (!given || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/**
 * Called by pg_cron on the Supabase project once a minute with the shared secret, so provider
 * feedback keeps arriving while nobody has the app open. Also callable by an owner from the send
 * page through the server action, which does not use this route.
 */
export async function POST(request: NextRequest) {
  const env = serverEnv();
  if (!env.POLL_SECRET) {
    return NextResponse.json({ error: 'polling is not configured' }, { status: 503 });
  }
  if (!secretMatches(request.headers.get('x-poll-secret'), env.POLL_SECRET)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const results = await pollAllDispatched();
  return NextResponse.json({
    polled: results.length,
    inserted: results.reduce((n, r) => n + r.inserted, 0),
    errors: results.filter((r) => r.error).map((r) => ({ sendId: r.sendId, error: r.error })),
  });
}
