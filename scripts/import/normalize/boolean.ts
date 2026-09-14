import { fail, ok, type Norm } from '../types';

const TRUE = new Set(['true', '1', 'yes', 'y', 't']);
const FALSE = new Set(['false', '0', 'no', 'n', 'f']);

/** Eleven spellings were observed in the seed. Anything outside the two allow-lists is a rejection. */
export function normalizeBoolean(raw: string): Norm<boolean> {
  const v = raw.trim().toLowerCase();
  if (v === '') return ok(false, 'consent_missing');
  if (TRUE.has(v)) return ok(true);
  if (FALSE.has(v)) return ok(false);
  return fail(`consent unrecognised: ${raw.trim()}`);
}
