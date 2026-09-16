import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getMembership } from '@/lib/auth/membership';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime, fmtNum } from '@/components/data/format';
import { Footnote, PageHeader } from '@/components/data/states';
import { serverNowMs } from '@/lib/time';
import { describeSendError } from '@/lib/send/describe-error';
import { SendControls } from './send-controls';

export const metadata: Metadata = { title: 'Send' };

const STATUS_TEXT: Record<string, string> = {
  approved: 'Approved, not sent. The audience and count below are frozen.',
  dispatching:
    'Being handed to the provider. If this has said so for more than five minutes, the process died and an owner can retry safely: the same idempotency key means the provider cannot send twice.',
  dispatched: 'Handed to the provider. Feedback below updates as it arrives.',
  failed: 'The provider did not accept it. Nothing was sent. It can be retried.',
};

export default async function SendPage({ params }: PageProps<'/sends/[id]'>) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const [m, supabase] = await Promise.all([getMembership(), createClient()]);

  const send = await supabase
    .from('sends')
    .select('*, campaigns ( external_id, name, channel )')
    .eq('id', id)
    .maybeSingle();
  if (send.error) throw new Error(`send lookup failed: ${send.error.message}`);
  if (!send.data) notFound();
  const s = send.data;
  const campaign = Array.isArray(s.campaigns) ? s.campaigns[0] : s.campaigns;

  const outcomes = await supabase.rpc('send_outcomes', { p_send_id: id });
  if (outcomes.error) throw new Error(`send outcomes failed: ${outcomes.error.message}`);
  const o = outcomes.data?.[0];
  if (!o) throw new Error('send outcomes returned no row');

  const rows: Array<[string, number, string]> = [
    ['Queued', o.queued, 'approved, not yet handed to the provider'],
    ['Accepted', o.accepted, 'provider took it, no delivery report yet'],
    ['Rejected', o.rejected, 'provider refused it at hand-over'],
    ['Delivered', o.delivered, 'provider reported delivery'],
    ['Opened', o.opened, 'provider reported an open'],
    ['Clicked', o.clicked, 'provider reported a click'],
    ['Bounced', o.bounced, 'terminal: contact is no longer contactable'],
    ['Complained', o.complained, 'terminal: contact is no longer contactable'],
    ['Unsubscribed', o.unsubscribed, 'terminal: contact is no longer contactable'],
  ];

  return (
    <>
      <p className="mb-3 text-sm">
        <Link href="/sends" className="text-muted-foreground underline-offset-2 hover:underline">
          ← Sends
        </Link>
      </p>
      <PageHeader
        eyebrow={`send · ${s.status}`}
        title={
          <>
            {campaign?.external_id} <span className="text-muted-foreground">{campaign?.name}</span>
          </>
        }
      />

      <section className="rise grid gap-3 sm:grid-cols-3">
        <div className="rounded-sm border border-rule bg-card p-4">
          <p className="text-xs text-muted-foreground">
            Approved audience<span className="fn">1</span>
          </p>
          <p className="mt-1 font-mono text-3xl">{fmtNum(s.approved_count)}</p>
        </div>
        <div className="rounded-sm border border-rule bg-card p-4">
          <p className="text-xs text-muted-foreground">Provider accepted</p>
          <p className="mt-1 font-mono text-3xl">{fmtNum(s.provider_accepted)}</p>
        </div>
        <div className="rounded-sm border border-rule bg-card p-4">
          <p className="text-xs text-muted-foreground">Feedback events stored</p>
          <p className="mt-1 font-mono text-3xl">{fmtNum(o.events)}</p>
        </div>
      </section>
      <Footnote n={1}>
        Frozen when the audience was approved on {fmtDateTime(s.approved_at)}:{' '}
        {s.audience_definition}. This number does not change afterwards, whatever happens to the
        contacts.
      </Footnote>

      <section className="rise rise-2 mt-6 rounded-sm border border-rule bg-card p-4">
        <p className="text-sm">{STATUS_TEXT[s.status] ?? s.status}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-xs sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">idempotency key</dt>
            <dd className="break-all">{s.idempotency_key}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">provider batch</dt>
            <dd className="break-all">{s.provider_batch_id ?? '–'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">dispatched</dt>
            <dd>{fmtDateTime(s.dispatched_at)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">last polled</dt>
            <dd>{fmtDateTime(s.last_polled_at)}</dd>
          </div>
        </dl>
        {s.last_error ? (
          <p className="mt-3 border-l-2 border-bad pl-3 text-sm text-bad">
            {describeSendError(s.last_error)}
          </p>
        ) : null}
        <div className="mt-4">
          <SendControls
            sendId={id}
            status={s.status}
            role={m?.role ?? 'analyst'}
            hasBatch={s.provider_batch_id !== null}
            approvedCount={s.approved_count}
            stalled={
              s.status === 'dispatching' &&
              s.provider_batch_id === null &&
              s.dispatch_started_at !== null &&
              serverNowMs() - new Date(s.dispatch_started_at).getTime() > 5 * 60_000
            }
          />
        </div>
      </section>

      <section className="rise rise-3 mt-6">
        <h3 className="text-xl">
          Where each recipient stands<span className="fn">2</span>
        </h3>
        <Footnote n={2}>
          One row per recipient in the frozen audience, at its latest state. States only move
          forward; a bounce, complaint or unsubscribe is final even if a later delivery report
          arrives. Rows add up to the approved audience.
        </Footnote>
        <div className="mt-3 overflow-x-auto rounded-sm border border-rule bg-card">
          <table className="w-full text-sm">
            <tbody>
              {rows.map(([label, n, meaning]) => (
                <tr key={label} className="border-t border-rule first:border-t-0">
                  <td className="px-4 py-2">{label}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{fmtNum(n)}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{meaning}</td>
                </tr>
              ))}
              <tr className="border-t border-rule bg-paper">
                <td className="px-4 py-2 font-medium">Total</td>
                <td className="px-4 py-2 text-right font-mono text-xs">{fmtNum(o.total)}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">
                  {o.total === s.approved_count
                    ? 'equals the approved audience'
                    : 'does not equal the approved audience: report this'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
