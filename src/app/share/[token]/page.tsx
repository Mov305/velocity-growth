import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { serverEnv } from '@/lib/env';
import { SHARE_TOKEN_RE, readShareCookie, shareCookieName } from '@/lib/share/cookie';
import { fmtDateTime, fmtNum } from '@/components/data/format';
import { Footnote } from '@/components/data/states';
import { serverNowMs } from '@/lib/time';
import { UnlockForm } from './unlock-form';

export const metadata: Metadata = {
  title: 'Shared results',
  robots: { index: false, follow: false },
};

/**
 * Public page. The only input it takes from the request is the token in the path, and the only
 * thing that token can do is name a share_links row by hash. The campaign and brand come from
 * that row inside share_results; no id on this page is chosen by the viewer.
 */
export default async function SharePage({ params }: PageProps<'/share/[token]'>) {
  const { token } = await params;
  if (!SHARE_TOKEN_RE.test(token)) notFound();

  const env = serverEnv();
  const store = await cookies();
  const linkId = readShareCookie(
    env.SHARE_COOKIE_SECRET,
    token,
    store.get(shareCookieName(token))?.value,
    serverNowMs(),
  );

  if (!linkId) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
        <div className="rise">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Velocity Growth
          </p>
          <h1 className="mt-2 text-4xl">Shared results</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            This page was shared with a password. Enter it to see the campaign&rsquo;s results. Ten
            wrong tries lock the link, and thirty tries from one connection pause it, for fifteen
            minutes.
          </p>
        </div>
        <div className="rise rise-2 mt-10 border-t border-rule pt-8">
          <UnlockForm token={token} />
        </div>
      </main>
    );
  }

  // Service role: the viewer is anonymous; linkId came from a cookie this server signed after
  // open_share_link accepted the password, and share_results re-checks revoked and expired.
  const admin = createAdminClient();
  const r = await admin.rpc('share_results', { p_link_id: linkId });
  if (r.error) {
    if (r.error.code === 'P0002') {
      return (
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
          <h1 className="text-3xl">This link is no longer available</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            It was revoked or has expired. Ask the person who shared it for a new one.
          </p>
        </main>
      );
    }
    console.error('share_results failed', r.error.code, r.error.message);
    throw new Error('share results failed');
  }
  const d = r.data?.[0];
  if (!d) throw new Error('share results returned no row');

  const outcomes: Array<[string, number]> = [
    ['Delivered', d.delivered],
    ['Opened', d.opened],
    ['Clicked', d.clicked],
    ['Bounced', d.bounced],
    ['Complained', d.complained],
    ['Unsubscribed', d.unsubscribed],
    ['Rejected at hand-over', d.rejected],
    ['Awaiting a provider report', d.pending],
  ];
  const log = Object.entries((d.log_events ?? {}) as Record<string, number>).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
      <div className="rise">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          {d.brand_name} · {d.campaign_external_id} · {d.channel}
        </p>
        <h1 className="mt-1 text-3xl sm:text-4xl">{d.campaign_name}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Shared read-only view. Link valid until {fmtDateTime(d.expires_at)}.
        </p>
      </div>

      <section className="rise rise-2 mt-8 rounded-sm border border-rule bg-card p-6">
        <p className="text-xs text-muted-foreground">
          Sent from this portal<span className="fn">1</span>
        </p>
        <p className="mt-1 font-mono text-4xl">{fmtNum(d.approved)}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          recipients across {fmtNum(d.sends)} {d.sends === 1 ? 'send' : 'sends'}
          {d.last_dispatched_at ? `, last on ${fmtDateTime(d.last_dispatched_at)}` : ''}
        </p>
        <Footnote n={1}>
          Recipients frozen at approval for every send that reached the provider. Each recipient
          appears in exactly one row below, in its latest reported state; the rows add up to this
          number. Feedback is polled every minute, so &ldquo;awaiting&rdquo; shrinks over time.
        </Footnote>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {outcomes.map(([label, n]) => (
                <tr key={label} className="border-t border-rule">
                  <td className="py-2 pr-4">{label}</td>
                  <td className="py-2 text-right font-mono">{fmtNum(n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rise rise-3 mt-6 rounded-sm border border-rule bg-card p-6">
        <p className="text-xs text-muted-foreground">
          Engagement log<span className="fn">2</span>
        </p>
        <Footnote n={2}>
          Events imported from the brand&rsquo;s engagement log for this campaign, counted by type.
          These predate the portal&rsquo;s own sends.
        </Footnote>
        {log.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No logged events for this campaign.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {log.map(([t, n]) => (
                  <tr key={t} className="border-t border-rule">
                    <td className="py-2 pr-4">{t}</td>
                    <td className="py-2 text-right font-mono">{fmtNum(n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
