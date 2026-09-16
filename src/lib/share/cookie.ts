import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

/**
 * The unlock cookie for a shared results link. Set only after open_share_link accepted the
 * password; scoped to that link's path; signed so the page can trust the link id inside it
 * without another password round-trip. One hour, then the viewer types the password again.
 *
 * Signed with SHARE_COOKIE_SECRET, a secret used for nothing else.
 */
export const SHARE_COOKIE_TTL_SECONDS = 60 * 60;

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function shareCookieName(token: string): string {
  return `share_${tokenHash(token).slice(0, 16)}`;
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function makeShareCookie(
  secret: string,
  linkId: string,
  token: string,
  nowMs: number,
): { value: string; expiresAt: number } {
  const expiresAt = Math.floor(nowMs / 1000) + SHARE_COOKIE_TTL_SECONDS;
  const payload = `${linkId}.${expiresAt}`;
  return { value: `${payload}.${sign(secret, `${payload}.${tokenHash(token)}`)}`, expiresAt };
}

/** Returns the link id when the cookie is intact, bound to this token, and not expired. */
export function readShareCookie(
  secret: string,
  token: string,
  value: string | undefined,
  nowMs: number,
): string | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [linkId, exp, mac] = parts;
  if (!/^[0-9a-f-]{36}$/.test(linkId) || !/^\d{1,12}$/.test(exp)) return null;
  if (Number(exp) * 1000 <= nowMs) return null;
  const expected = sign(secret, `${linkId}.${exp}.${tokenHash(token)}`);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return linkId;
}

export const SHARE_TOKEN_RE = /^[0-9a-f]{64}$/;
