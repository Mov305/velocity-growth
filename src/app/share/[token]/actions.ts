'use server';

import { cookies, headers } from 'next/headers';
import { createHash } from 'node:crypto';
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

  // The caller's address, hashed, keys a per-connection throttle inside open_share_link.
  // Vercel sets x-vercel-forwarded-for and x-real-ip itself; a client cannot forge them. The
  // last entry of x-forwarded-for is the one appended by the nearest proxy, never the first,
  // which is whatever the client typed.
  const h = await headers();
  const forwarded = h
    .get('x-forwarded-for')
    ?.split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const ip =
    h.get('x-vercel-forwarded-for')?.split(',')[0].trim() ||
    h.get('x-real-ip')?.trim() ||
    forwarded?.at(-1) ||
    'unknown';
  const clientKey = createHash('sha256').update(ip).digest('hex');

  // Service role: the viewer is anonymous; the token is verified by hash inside the function.
  const admin = createAdminClient();
  const r = await admin.rpc('open_share_link', {
    p_token: token,
    p_password: password,
    p_client_key: clientKey,
  });
  if (r.error) {
    console.error('open_share_link failed', r.error.code, r.error.message);
    throw new Error('share link check failed');
  }
  const link = r.data?.[0];
  if (link?.outcome === 'locked')
    return { error: 'Too many wrong passwords. This link is locked for fifteen minutes.' };
  if (link?.outcome === 'throttled')
    return { error: 'Too many attempts from your connection. Try again in fifteen minutes.' };
  if (link?.outcome !== 'ok' || !link.link_id)
    return { error: 'That password is not right, or this link is no longer available.' };

  const env = serverEnv();
  const c = makeShareCookie(env.SHARE_COOKIE_SECRET, link.link_id, token, Date.now());
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
