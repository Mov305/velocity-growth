import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

type Fn = Database['public']['Functions'];
export type Summary = Fn['dashboard_summary']['Returns'][number];
export type SignupDay = Fn['signups_last_30_days']['Returns'][number];
export type CampaignPerf = Fn['campaign_performance']['Returns'][number];

/**
 * Everything the dashboard shows, from three security-invoker functions. RLS decides the brand.
 * Any failure throws: a dashboard must never render a zero it did not compute.
 */
export async function getDashboard(supabase: SupabaseClient<Database>): Promise<{
  summary: Summary;
  signups: SignupDay[];
  campaigns: CampaignPerf[];
}> {
  const [s, d, c] = await Promise.all([
    supabase.rpc('dashboard_summary'),
    supabase.rpc('signups_last_30_days'),
    supabase.rpc('campaign_performance'),
  ]);
  if (s.error) throw new Error(`dashboard summary failed: ${s.error.message}`);
  if (d.error) throw new Error(`signups failed: ${d.error.message}`);
  if (c.error) throw new Error(`campaign performance failed: ${c.error.message}`);
  if (!s.data || s.data.length !== 1) throw new Error('dashboard summary returned no row');
  if (!d.data || d.data.length !== 30) {
    throw new Error(`signups returned ${d.data?.length ?? 0} days, expected 30`);
  }
  return { summary: s.data[0], signups: d.data, campaigns: c.data ?? [] };
}
