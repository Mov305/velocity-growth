import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { describe, expect, it } from 'vitest';

/**
 * The one test that talks to the real provider and the hosted project. It approves a Marrakech
 * send, confirms it twice concurrently, then polls, and prints what the provider returned so the
 * README can quote it. Runs only when asked:
 *
 *   LIVE_SEND=1 pnpm exec vitest run --project live
 *
 * It uses the smallest brand on purpose. Every recipient is synthetic seed data.
 */
const live = process.env.LIVE_SEND === '1';

describe.skipIf(!live)('live send against the provider', () => {
  it('approves, confirms twice, polls, and the numbers line up', async () => {
    config({ path: '.env.production', override: true, quiet: true });
    const logins = JSON.parse(process.env.SEED_LOGINS!) as Array<{
      email: string;
      brand: string;
      role: string;
    }>;
    const passwords = JSON.parse(process.env.SEED_PASSWORDS_JSON!) as Record<string, string>;
    const l = logins.find((x) => x.brand === 'MARRAKECH' && x.role === 'owner')!;
    const owner = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const signIn = await owner.auth.signInWithPassword({
      email: l.email,
      password: passwords[l.email],
    });
    if (signIn.error) throw signIn.error;

    const { dispatchSend } = await import('@/lib/send/dispatch');
    const { pollSend } = await import('@/lib/send/poll');

    const campaign = await owner
      .from('campaigns')
      .select('id, external_id')
      .eq('external_id', 'MAR-0003')
      .single();
    const approved = await owner.rpc('approve_send', { p_campaign_id: campaign.data!.id });
    expect(approved.error).toBeNull();
    const sendId = approved.data!;
    const before = await owner
      .from('sends')
      .select('approved_count, idempotency_key')
      .eq('id', sendId)
      .single();
    console.log(
      'approved send',
      sendId,
      'audience',
      before.data!.approved_count,
      'key',
      before.data!.idempotency_key,
    );

    const [a, b] = await Promise.all([
      dispatchSend(owner as never, sendId),
      dispatchSend(owner as never, sendId),
    ]);
    console.log('confirm 1', JSON.stringify(a));
    console.log('confirm 2', JSON.stringify(b));
    expect([a.kind, b.kind].sort()).toEqual(['already', 'dispatched']);

    const after = await owner
      .from('sends')
      .select('status, provider_batch_id, provider_accepted, provider_rejected')
      .eq('id', sendId)
      .single();
    console.log('send row', JSON.stringify(after.data));
    expect(after.data!.status).toBe('dispatched');
    expect(after.data!.provider_accepted).toBe(before.data!.approved_count);

    // The measured provider emits its first delivery events within seconds and more minutes later.
    await new Promise((r) => setTimeout(r, 6000));
    const p1 = await pollSend(sendId);
    console.log('poll 1', JSON.stringify(p1));
    expect(p1.error).toBeUndefined();
    const p2 = await pollSend(sendId);
    console.log('poll 2', JSON.stringify(p2));
    expect(p2.inserted).toBeLessThanOrEqual(p1.received);

    const outcomes = await owner.rpc('send_outcomes', { p_send_id: sendId });
    console.log('outcomes', JSON.stringify(outcomes.data![0]));
    expect(outcomes.data![0].total).toBe(before.data!.approved_count);
  }, 120_000);
});
