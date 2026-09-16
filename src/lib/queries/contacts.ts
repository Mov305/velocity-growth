import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { rangeFor, type ListParams } from '@/lib/params';
import { escapeLike, toPage, type Page } from './page';

export type { Page } from './page';

export type ContactRow = Pick<
  Database['public']['Tables']['contacts']['Row'],
  | 'id'
  | 'external_id'
  | 'full_name'
  | 'email'
  | 'phone'
  | 'country'
  | 'city'
  | 'signup_at'
  | 'status'
  | 'consent_marketing'
  | 'deleted_at'
  | 'suppressed_until'
  | 'flags'
>;

const COLUMNS =
  'id, external_id, full_name, email, phone, country, city, signup_at, status, consent_marketing, deleted_at, suppressed_until, flags';

function withFilters<Q extends { eq: (c: string, v: string) => Q; or: (f: string) => Q }>(
  query: Q,
  params: ListParams,
): Q {
  let q = query;
  if (params.status) q = q.eq('status', params.status);
  if (params.q) {
    const term = `%${escapeLike(params.q)}%`;
    q = q.or(`full_name.ilike.${term},email.ilike.${term},external_id.ilike.${term}`);
  }
  return q;
}

/**
 * One page of the caller's contacts. The client is user-scoped, so RLS decides the brand; this
 * function never filters by brand id. The total is a real server-side count, not the page length.
 */
export async function listContacts(
  supabase: SupabaseClient<Database>,
  params: ListParams,
): Promise<Page<ContactRow>> {
  const { from, to } = rangeFor(params.page);
  const result = await withFilters(
    supabase.from('contacts').select(COLUMNS, { count: 'exact' }),
    params,
  )
    .order('signup_at', { ascending: false, nullsFirst: false })
    .order('external_id', { ascending: true })
    .range(from, to);

  return toPage('contacts', params.page, result, () =>
    withFilters(supabase.from('contacts').select('id', { count: 'exact', head: true }), params),
  );
}
