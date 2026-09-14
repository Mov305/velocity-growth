import { fail, ok, type Norm } from '../types';

const WHOLE = /^\d+$/;

/** Non-negative whole numbers only. Reported counts and recipient counts cannot be fractional. */
export function normalizeInteger(raw: string): Norm<number | null> {
  const v = raw.trim();
  if (v === '') return ok(null);
  if (!WHOLE.test(v)) return fail(`not a whole number: ${v}`);
  return ok(Number(v));
}

/** Decimal with the separator the file uses. Marrakech writes 221,09; the others write 221.09. */
export function normalizeDecimal(raw: string, separator: '.' | ','): Norm<number | null> {
  const v = raw.trim();
  if (v === '') return ok(null);
  const pattern = separator === ',' ? /^\d+(,\d+)?$/ : /^\d+(\.\d+)?$/;
  if (!pattern.test(v)) return fail(`not a number: ${v}`);
  return ok(Number(v.replace(',', '.')));
}
