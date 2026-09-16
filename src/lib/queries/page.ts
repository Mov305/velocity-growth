import type { PostgrestError, PostgrestSingleResponse } from '@supabase/supabase-js';
import { PAGE_SIZE } from '@/lib/params';

export type Page<T> = { rows: T[]; total: number; page: number; pageSize: number };

/** `%` and `_` are ILIKE wildcards; a user typing them means the literal character. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** PostgREST answers 416 with this code when the requested range starts past the last row. */
const RANGE_NOT_SATISFIABLE = 'PGRST103';

/**
 * Turns a ranged, counted PostgREST response into a Page. A range past the end is a legitimate
 * empty page with the real total, not an error; every other error is thrown so it can never
 * render as zero rows.
 */
export async function toPage<T>(
  what: string,
  page: number,
  result: PostgrestSingleResponse<T[]>,
  countAgain: () => PromiseLike<{ count: number | null; error: PostgrestError | null }>,
): Promise<Page<T>> {
  const { data, error, count } = result;
  if (error && error.code === RANGE_NOT_SATISFIABLE) {
    const again = await countAgain();
    if (again.error) throw new Error(`${what} count failed: ${again.error.message}`);
    if (again.count === null) throw new Error(`${what} count returned nothing`);
    return { rows: [], total: again.count, page, pageSize: PAGE_SIZE };
  }
  if (error) throw new Error(`${what} query failed: ${error.message}`);
  if (count === null) throw new Error(`${what} query returned no count`);
  return { rows: data, total: count, page, pageSize: PAGE_SIZE };
}
