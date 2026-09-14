import { fail, ok, type Norm } from '../types';

const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?Z$/;
const BARE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SLASH = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/;

/** True when the components form a real calendar instant. Date.UTC silently rolls 31/02 into March. */
function valid(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): Date | null {
  const date = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
  const same =
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d &&
    date.getUTCHours() === hh &&
    date.getUTCMinutes() === mm &&
    date.getUTCSeconds() === ss;
  return same ? date : null;
}

/**
 * Three formats were observed: ISO instants, bare dates, and DD/MM/YYYY HH:MM.
 *
 * ISO instants are validated by component and returned exactly as given. Postgres parses them with
 * full microsecond precision; routing them through Date would truncate to milliseconds and could
 * reorder events that arrived within the same millisecond.
 *
 * The slash form is read day-first because every file comes from an East or Southern African
 * export. The caller prefixes the reason with the field name.
 */
export function normalizeDate(raw: string): Norm<string | null> {
  const v = raw.trim();
  if (v === '') return ok(null);

  const iso = ISO.exec(v);
  if (iso) {
    return valid(+iso[1], +iso[2], +iso[3], +iso[4], +iso[5], +iso[6])
      ? ok(v)
      : fail(`unparseable: ${v}`);
  }
  const bare = BARE.exec(v);
  if (bare) {
    const d = valid(+bare[1], +bare[2], +bare[3]);
    return d ? ok(d.toISOString()) : fail(`unparseable: ${v}`);
  }
  const slash = SLASH.exec(v);
  if (slash) {
    const d = valid(+slash[3], +slash[2], +slash[1], +slash[4], +slash[5]);
    return d ? ok(d.toISOString()) : fail(`unparseable: ${v}`);
  }
  return fail(`unparseable: ${v}`);
}
