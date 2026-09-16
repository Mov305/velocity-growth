import { describe, expect, it } from 'vitest';
import {
  SHARE_COOKIE_TTL_SECONDS,
  makeShareCookie,
  readShareCookie,
  shareCookieName,
} from '@/lib/share/cookie';

const secret = 'service-role-key-for-tests';
const token = 'a'.repeat(64);
const linkId = '11111111-2222-4333-8444-555555555555';
const now = 1_800_000_000_000;

describe('share cookie', () => {
  it('round-trips within its hour', () => {
    const c = makeShareCookie(secret, linkId, token, now);
    expect(c.expiresAt).toBe(Math.floor(now / 1000) + SHARE_COOKIE_TTL_SECONDS);
    expect(readShareCookie(secret, token, c.value, now + 1000)).toBe(linkId);
  });
  it('is dead after the hour', () => {
    const c = makeShareCookie(secret, linkId, token, now);
    expect(readShareCookie(secret, token, c.value, now + SHARE_COOKIE_TTL_SECONDS * 1000)).toBe(
      null,
    );
  });
  it('is bound to its token', () => {
    const c = makeShareCookie(secret, linkId, token, now);
    expect(readShareCookie(secret, 'b'.repeat(64), c.value, now)).toBeNull();
  });
  it('rejects a tampered link id or signature', () => {
    const c = makeShareCookie(secret, linkId, token, now);
    const other = c.value.replace(linkId, '11111111-2222-4333-8444-555555555556');
    expect(readShareCookie(secret, token, other, now)).toBeNull();
    expect(readShareCookie(secret, token, c.value.slice(0, -2) + 'zz', now)).toBeNull();
    expect(readShareCookie('other-secret', token, c.value, now)).toBeNull();
    expect(readShareCookie(secret, token, undefined, now)).toBeNull();
    expect(readShareCookie(secret, token, 'garbage', now)).toBeNull();
  });
  it('names the cookie by a prefix of the token hash, not the token', () => {
    const name = shareCookieName(token);
    expect(name).toMatch(/^share_[0-9a-f]{16}$/);
    expect(name).not.toContain(token.slice(0, 16));
  });
});
