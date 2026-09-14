import { ok, type Norm } from '../types';

// One local part, one @, a domain with at least one dot, no whitespace anywhere.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An invalid email keeps the contact (they may still have a phone) but is stored as null. */
export function normalizeEmail(raw: string): Norm<string | null> {
  const v = raw.trim().toLowerCase();
  if (v === '') return ok(null);
  if (EMAIL.test(v)) return ok(v);
  return ok(null, 'email_invalid');
}
