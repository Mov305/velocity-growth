'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

export type ShareState = { error?: string; url?: string };

const Publish = z.object({
  campaignId: z.string().uuid(),
  password: z.string().min(8).max(128),
});

/** Owner publishes a results link. publish_results checks the role in SQL and returns the token once. */
export async function publishResults(_prev: ShareState, formData: FormData): Promise<ShareState> {
  const parsed = Publish.safeParse({
    campaignId: formData.get('campaignId'),
    password: formData.get('password'),
  });
  if (!parsed.success) return { error: 'Choose a password of 8 to 128 characters.' };
  const supabase = await createClient();
  const r = await supabase.rpc('publish_results', {
    p_campaign_id: parsed.data.campaignId,
    p_password: parsed.data.password,
  });
  if (r.error) {
    return {
      error: r.error.message.includes('not permitted')
        ? 'Only an owner can share results.'
        : 'The link could not be created.',
    };
  }
  const h = await headers();
  const origin = h.get('origin') ?? process.env.NEXT_PUBLIC_SITE_URL ?? '';
  revalidatePath(`/campaigns/${parsed.data.campaignId}/send`);
  return { url: `${origin}/share/${r.data}` };
}

export async function revokeShareLink(formData: FormData): Promise<void> {
  const linkId = z.string().uuid().safeParse(formData.get('linkId'));
  const campaignId = z.string().uuid().safeParse(formData.get('campaignId'));
  if (!linkId.success || !campaignId.success) return;
  const supabase = await createClient();
  const r = await supabase.rpc('revoke_share_link', { p_link_id: linkId.data });
  if (r.error) throw new Error(`revoke failed: ${r.error.message}`);
  revalidatePath(`/campaigns/${campaignId.data}/send`);
}
