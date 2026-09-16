'use server';

import { cookies } from 'next/headers';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { serverEnv } from '@/lib/env';
import { SHARE_TOKEN_RE, makeShareCookie, shareCookieName } from '@/lib/share/cookie';

export type UnlockState = { error?: string; ok?: boolean };

const Input = z.object({
  token: z.string().regex(SHARE_TOKEN_RE),
  password: z.string().min(1).max(128),
});

/**
 * The viewer has no login. The token from the path and the typed password go to
 * open_share_link under the service role; that function is the only place the hashes are
 * compared and the only place attempts are counted. On success a signed cookie scoped to this
 * link's path lets the page render without asking again for an hour.
 */
export async function unlockShare(_prev: UnlockState, formData: FormData): Promise<UnlockState> {
  const parsed = Input.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
  });
  if (!parsed.success) return { error: 'Enter the password for this link.' };
  const { token, password } = parsed.data;

  // Service role: the viewer is anonymous; the token is verified by hash inside the function.
  const admin = createAdminClient();
  const r = await admin.rpc('open_share_link', { p_token: token, p_password: password });
  if (r.error) {
    console.error('open_share_link failed', r.error.code, r.error.message);
    throw new Error('share link check failed');
  }
  const link = r.data?.[0];
  if (link?.outcome === 'locked')
    return { error: 'Too many wrong passwords. This link is locked for fifteen minutes.' };
  if (link?.outcome !== 'ok' || !link.link_id)
    return { error: 'That password is not right, or this link is no longer available.' };

  const env = serverEnv();
  const c = makeShareCookie(env.SUPABASE_SERVICE_ROLE_KEY, link.link_id, token, Date.now());
  const store = await cookies();
  store.set(shareCookieName(token), c.value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: `/share/${token}`,
    expires: new Date(c.expiresAt * 1000),
  });
  return { ok: true };
}
