import { fail, ok, type ContactStatus, type Norm } from '../types';

const ALLOWED: ReadonlySet<string> = new Set(['active', 'unsubscribed', 'bounced', 'pending']);
const ALIASES: Record<string, ContactStatus> = { unsubscribe: 'unsubscribed' };

export function normalizeStatus(raw: string): Norm<ContactStatus> {
  const v = raw.trim().toLowerCase();
  if (v === '') return fail('status missing');
  const mapped = ALIASES[v] ?? v;
  if (ALLOWED.has(mapped)) return ok(mapped as ContactStatus);
  return fail(`status unrecognised: ${raw.trim()}`);
}
