import { ok, type Norm } from '../types';

const SCIENTIFIC = /^\d+(\.\d+)?[eE][+-]?\d+$/;
const DIGITS = /^\+?\d{6,15}$/;

/**
 * Phones are stored as the digits given, with an optional leading plus. No E.164 conversion:
 * local numbers without a country code are ambiguous across the six countries in the data,
 * and guessing would be a quietly wrong number.
 *
 * A bad phone never drops the contact, same rule as email: the value becomes null and the
 * contact is flagged so the marketer can see it. The contact stays reachable by email if any.
 */
export function normalizePhone(raw: string): Norm<string | null> {
  const v = raw.trim();
  if (v === '') return ok(null);
  if (SCIENTIFIC.test(v)) return ok(null, 'phone_corrupted');
  const compact = v.replace(/[\s\-().]/g, '');
  if (DIGITS.test(compact)) return ok(compact);
  return ok(null, 'phone_invalid');
}
