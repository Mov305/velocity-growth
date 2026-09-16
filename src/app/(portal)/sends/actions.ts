'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getMembership } from '@/lib/auth/membership';
import { createClient } from '@/lib/supabase/server';
import { dispatchSend } from '@/lib/send/dispatch';
import { pollSend } from '@/lib/send/poll';
import { describeSendError } from '@/lib/send/describe-error';

const Id = z.string().uuid();

export type ActionState = { error?: string; notice?: string };

/** Owner freezes the audience for a campaign. The role check is in approve_send, in SQL. */
export async function approveSend(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = Id.safeParse(formData.get('campaignId'));
  if (!parsed.success) return { error: 'That campaign id is not valid.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('approve_send', { p_campaign_id: parsed.data });
  if (error) {
    return {
      error: error.message.includes('not permitted')
        ? 'Only an owner can approve a send.'
        : 'The audience could not be approved. Nothing was sent.',
    };
  }
  redirect(`/sends/${data}`);
}

/** Owner confirms. begin_dispatch in SQL decides who calls the provider; the rest records. */
export async function confirmSend(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = Id.safeParse(formData.get('sendId'));
  if (!parsed.success) return { error: 'That send id is not valid.' };
  const supabase = await createClient();
  let outcome;
  try {
    outcome = await dispatchSend(supabase, parsed.data);
  } catch (e) {
    return {
      error:
        e instanceof Error && /not permitted/.test(e.message)
          ? 'Only an owner can send.'
          : 'The send could not be started. Nothing was sent.',
    };
  }
  if (outcome.kind === 'failed')
    return {
      error: `${describeSendError(outcome.error)} Nothing was recorded as sent; you can retry.`,
    };
  if (outcome.kind === 'already')
    return {
      notice: `This send is already ${outcome.status}${outcome.batchId ? ` (provider batch ${outcome.batchId})` : ''}. It was not sent again.`,
    };
  return {
    notice: `Sent in ${outcome.batches.toLocaleString('en-GB')} provider ${outcome.batches === 1 ? 'batch' : 'batches'}. The provider accepted ${outcome.accepted.toLocaleString('en-GB')} and rejected ${outcome.rejected.toLocaleString('en-GB')}; first batch ${outcome.batchId}.`,
  };
}

/** Owner or analyst may pull feedback on demand; the scheduler does the same once a minute. */
export async function pollNow(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = Id.safeParse(formData.get('sendId'));
  if (!parsed.success) return { error: 'That send id is not valid.' };
  const m = await getMembership();
  if (!m) return { error: 'No access.' };
  // The send must be visible to this caller under RLS before the service role touches it.
  const supabase = await createClient();
  const visible = await supabase.from('sends').select('id').eq('id', parsed.data).maybeSingle();
  if (visible.error || !visible.data) return { error: 'That send is not in your brand.' };
  const r = await pollSend(parsed.data);
  if (r.error) return { error: describeSendError(`poll: ${r.error}`) ?? 'Polling failed.' };
  return {
    notice: `Polled ${r.pages} page${r.pages === 1 ? '' : 's'}: ${r.received} events received, ${r.inserted} new, ${r.duplicates} already stored, ${r.unknownRecipients} for recipients not in this send, ${r.malformed} malformed.`,
  };
}
