import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { rangeFor } from '@/lib/params';
import { toPage, type Page } from './page';

export type ImportRow = Database['public']['Tables']['imports']['Row'];
export type RejectRow = Pick<
  Database['public']['Tables']['import_rejects']['Row'],
  'id' | 'row_number' | 'reason' | 'raw'
>;

export const IMPORTS_SHOWN = 500;

/**
 * The newest imports for the caller's brand plus the real total, so the page can say "showing the
 * latest 500 of N" instead of presenting a capped list as complete.
 */
export async function listImports(
  supabase: SupabaseClient<Database>,
): Promise<{ rows: ImportRow[]; total: number }> {
  const { data, error, count } = await supabase
    .from('imports')
    .select('*', { count: 'exact' })
    .order('started_at', { ascending: false })
    .limit(IMPORTS_SHOWN);
  if (error) throw new Error(`imports query failed: ${error.message}`);
  if (count === null) throw new Error('imports query returned no count');
  return { rows: data, total: count };
}

/** One import, or null when it is not the caller's (RLS) or does not exist. */
export async function getImport(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<ImportRow | null> {
  const { data, error } = await supabase.from('imports').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`import lookup failed: ${error.message}`);
  return data;
}

/** One page of an import's rejected rows in file order, with a real total. */
export async function listRejects(
  supabase: SupabaseClient<Database>,
  importId: string,
  page: number,
): Promise<Page<RejectRow>> {
  const { from, to } = rangeFor(page);
  const result = await supabase
    .from('import_rejects')
    .select('id, row_number, reason, raw', { count: 'exact' })
    .eq('import_id', importId)
    .order('row_number', { ascending: true })
    .range(from, to);
  return toPage('rejects', page, result, () =>
    supabase
      .from('import_rejects')
      .select('id', { count: 'exact', head: true })
      .eq('import_id', importId),
  );
}

/** Reject reasons grouped for the import header, so the marketer sees the shape before the rows. */
export async function rejectReasonSummary(
  supabase: SupabaseClient<Database>,
  importId: string,
): Promise<Array<{ reason: string; count: number }>> {
  // Grouped in the database by the import_reject_summary view (security_invoker, so RLS applies).
  // Grouping in the app would see at most the 1,000 rows PostgREST returns per response.
  const { data, error } = await supabase
    .from('import_reject_summary')
    .select('reason, rows')
    .eq('import_id', importId)
    .order('rows', { ascending: false });
  if (error) throw new Error(`reject summary failed: ${error.message}`);
  return data.map((r) => ({ reason: r.reason ?? '', count: r.rows ?? 0 }));
}
