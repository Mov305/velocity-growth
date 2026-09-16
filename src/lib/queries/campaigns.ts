import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { rangeFor, type ListParams } from '@/lib/params';
import { escapeLike, toPage, type Page } from './page';

export type CampaignRow = Pick<
  Database['public']['Tables']['campaigns']['Row'],
  | 'id'
  | 'external_id'
  | 'name'
  | 'channel'
  | 'target_country'
  | 'reported_sent'
  | 'reported_delivered'
  | 'reported_bounced'
  | 'reported_opens'
  | 'reported_clicks'
  | 'spend'
  | 'sent_at'
  | 'parent_external_id'
  | 'flags'
>;

const COLUMNS =
  'id, external_id, name, channel, target_country, reported_sent, reported_delivered, reported_bounced, reported_opens, reported_clicks, spend, sent_at, parent_external_id, flags';

function withFilters<Q extends { or: (f: string) => Q }>(query: Q, params: ListParams): Q {
  if (!params.q) return query;
  const term = `%${escapeLike(params.q)}%`;
  return query.or(`name.ilike.${term},external_id.ilike.${term}`);
}

/** One page of the caller's campaigns, newest send first. Figures are as reported in the brand's file. */
export async function listCampaigns(
  supabase: SupabaseClient<Database>,
  params: ListParams,
): Promise<Page<CampaignRow>> {
  const { from, to } = rangeFor(params.page);
  const result = await withFilters(
    supabase.from('campaigns').select(COLUMNS, { count: 'exact' }),
    params,
  )
    .order('sent_at', { ascending: false, nullsFirst: false })
    .order('external_id', { ascending: true })
    .range(from, to);

  return toPage('campaigns', params.page, result, () =>
    withFilters(supabase.from('campaigns').select('id', { count: 'exact', head: true }), params),
  );
}
