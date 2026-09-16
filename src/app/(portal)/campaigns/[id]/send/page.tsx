import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getMembership } from '@/lib/auth/membership';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime, fmtNum } from '@/components/data/format';
import { Footnote, PageHeader } from '@/components/data/states';
import { serverNowMs } from '@/lib/time';
import { ApproveForm } from './approve-form';
import { ShareForm } from './share-form';
import { revokeShareLink } from './share-actions';

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

  // Non-secret columns only; token_hash and password_hash have no grant to authenticated.
  const links = await supabase
    .from('share_links')
    .select('id, created_at, expires_at, revoked_at, failed_attempts, locked_until', {
      count: 'exact',
    })
    .eq('campaign_id', id)
    .order('created_at', { ascending: false })
    .range(0, 49);
  if (links.error) throw new Error(`share links lookup failed: ${links.error.message}`);
  const now = serverNowMs();

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

      <section className="rise rise-2 mt-6 rounded-sm border border-rule bg-card p-6">
        <h3 className="text-lg">Shared results link</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          A password-protected page showing this campaign&rsquo;s aggregate results and nothing
          else: no names, no contacts, no other campaign. Anyone with the link and the password can
          open it for 30 days.
        </p>
        <div className="mt-4">
          {m?.role === 'owner' ? (
            <ShareForm campaignId={id} />
          ) : (
            <p className="rounded-sm border border-dashed border-rule px-4 py-3 text-sm text-muted-foreground">
              Only an owner can create or revoke a shared link.
            </p>
          )}
        </div>
        {links.data.length > 0 ? (
          <div className="mt-6 overflow-x-auto">
            {links.count !== null && links.count > links.data.length ? (
              <p className="mb-2 text-xs text-muted-foreground">
                Showing the latest {fmtNum(links.data.length)} of {fmtNum(links.count)} links.
              </p>
            ) : null}
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4 font-normal">Created</th>
                  <th className="py-2 pr-4 font-normal">Expires</th>
                  <th className="py-2 pr-4 font-normal">State</th>
                  <th className="py-2 font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {links.data.map((l) => {
                  const state = l.revoked_at
                    ? 'revoked'
                    : new Date(l.expires_at).getTime() <= now
                      ? 'expired'
                      : l.locked_until && new Date(l.locked_until).getTime() > now
                        ? `locked after ${l.failed_attempts} wrong passwords`
                        : 'active';
                  return (
                    <tr key={l.id} className="border-t border-rule">
                      <td className="py-2 pr-4">{fmtDateTime(l.created_at)}</td>
                      <td className="py-2 pr-4">{fmtDateTime(l.expires_at)}</td>
                      <td className="py-2 pr-4">{state}</td>
                      <td className="py-2 text-right">
                        {m?.role === 'owner' && !l.revoked_at ? (
                          <form action={revokeShareLink}>
                            <input type="hidden" name="linkId" value={l.id} />
                            <input type="hidden" name="campaignId" value={id} />
                            <button
                              type="submit"
                              className="text-xs underline-offset-2 hover:underline"
                            >
                              Revoke
                            </button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </>
  );
}
