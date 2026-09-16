import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getMembership } from '@/lib/auth/membership';
import { createClient } from '@/lib/supabase/server';
import { fmtNum } from '@/components/data/format';
import { Footnote, PageHeader } from '@/components/data/states';
import { ApproveForm } from './approve-form';

export const metadata: Metadata = { title: 'Send campaign' };

export default async function SendCampaignPage({ params }: PageProps<'/campaigns/[id]/send'>) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const [m, supabase] = await Promise.all([getMembership(), createClient()]);
  const campaign = await supabase
    .from('campaigns')
    .select('id, external_id, name, channel')
    .eq('id', id)
    .maybeSingle();
  if (campaign.error) throw new Error(`campaign lookup failed: ${campaign.error.message}`);
  if (!campaign.data) notFound();

  const preview = await supabase.rpc('preview_send_audience', { p_campaign_id: id });
  if (preview.error) throw new Error(`audience preview failed: ${preview.error.message}`);
  const audience = preview.data?.[0];
  if (!audience) throw new Error('audience preview returned no row');

  return (
    <>
      <p className="mb-3 text-sm">
        <Link
          href="/campaigns"
          className="text-muted-foreground underline-offset-2 hover:underline"
        >
          ← Campaigns
        </Link>
      </p>
      <PageHeader
        eyebrow={`${campaign.data.external_id} · ${campaign.data.channel}`}
        title={campaign.data.name}
      />

      <section className="rise rounded-sm border border-rule bg-card p-6">
        <p className="text-xs text-muted-foreground">
          This send would go to<span className="fn">1</span>
        </p>
        <p className="mt-1 font-mono text-4xl">{fmtNum(audience.audience_count)}</p>
        <p className="mt-1 text-sm text-muted-foreground">contactable customers, counted now</p>
        <Footnote n={1}>
          Contactable means {audience.audience_definition}. This is a live count. Approving freezes
          the exact list and count; the confirmation screen shows the frozen number and that is what
          gets sent.
        </Footnote>

        <div className="mt-6">
          {m?.role === 'owner' ? (
            <ApproveForm campaignId={id} count={audience.audience_count} />
          ) : (
            <p className="rounded-sm border border-dashed border-rule px-4 py-3 text-sm text-muted-foreground">
              Only an owner can approve a send. Your login is an analyst.
            </p>
          )}
        </div>
      </section>
    </>
  );
}
