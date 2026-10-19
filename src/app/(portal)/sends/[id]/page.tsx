import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getMembership } from '@/lib/auth/membership';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime, fmtNum } from '@/components/data/format';
import { Footnote, PageHeader } from '@/components/data/states';
import { serverNowMs } from '@/lib/time';
import { describeDispatchProgress, describeSendError } from '@/lib/send/describe-error';
import { PROVIDER_BATCH_CAP } from '@/lib/provider/client';
import { SendControls } from './send-controls';

export const metadata: Metadata = { title: 'Send' };
// Both actions on this page work under a time budget inside this ceiling: poll-now walks provider
// batches for up to 50 s, confirm starts no new 500-recipient chunk after 25 s (a chunk can take
// the provider's 30 s timeout) and leaves the rest for a resume.
export const maxDuration = 60;

const STATUS_TEXT: Record<string, string> = {
  approved: 'Approved, not sent. The audience and count below are frozen.',
  dispatching:
    'Being handed to the provider. If this has said so for more than five minutes, the process died and an owner can retry safely: the same idempotency key means the provider cannot send twice.',
  dispatched: 'Handed to the provider. Feedback below updates as it arrives.',
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

  const batches = await supabase
    .from('send_batches')
    .select(
      'chunk_index, provider_batch_id, submitted_count, accepted_count, rejected_count, unaccounted_count, unidentified_rejections, rejection_reasons, last_polled_at',
      {
        count: 'exact',
      },
    )
    .eq('send_id', id)
    .order('chunk_index', { ascending: true })
    .range(0, 199);
  if (batches.error) throw new Error(`send batches lookup failed: ${batches.error.message}`);

  const incomplete = await supabase
    .from('send_batches')
    .select('chunk_index', { count: 'exact', head: true })
    .eq('send_id', id)
    .eq('poll_incomplete', true);
  if (incomplete.error)
    throw new Error(`send batches poll state lookup failed: ${incomplete.error.message}`);
  if (incomplete.count === null) throw new Error('send batches poll state returned no count');
  const truncatedBatches = incomplete.count;

  const outcomes = await supabase.rpc('send_outcomes', { p_send_id: id });
  if (outcomes.error) throw new Error(`send outcomes failed: ${outcomes.error.message}`);
  const o = outcomes.data?.[0];
  if (!o) throw new Error('send outcomes returned no row');

  // Batches this send needs: chunks of the frozen audience with at least one recipient who is
  // not withheld. A chunk whose members were all withheld is never posted, so it is not counted.
  const needed = await supabase.rpc('send_batches_needed', {
    p_send_id: id,
    p_cap: PROVIDER_BATCH_CAP,
  });
  if (needed.error) throw new Error(`send batch count failed: ${needed.error.message}`);
  const totalBatches = needed.data;

  const handedOver = o.total - o.queued - o.withheld;
  const paused = s.status === 'failed' && (s.last_error ?? '').startsWith('paused:');
  // Failed with no batch recorded and nobody queued: every approved recipient was withheld (or
  // the audience was empty). There is nothing to retry; approving the campaign again freezes a
  // new audience under a new send.
  const nothingLeft = s.status === 'failed' && o.batches === 0 && o.queued === 0;
  // A stopped send is described from what is recorded, never as "nothing was sent" when a batch
  // already reached the provider.
  const statusText = nothingLeft
    ? `Nothing left to hand over: every approved recipient became uncontactable after approval, so no batch was posted by this send. ${describeDispatchProgress(
        { recordedBatches: 0, totalBatches, handedOver: 0, remaining: 0 },
      )} Approving the campaign again freezes a new audience under a new send.`
    : s.status === 'failed'
      ? `${paused ? 'Paused partway through the hand-over.' : 'The hand-over stopped before it finished.'} ${describeDispatchProgress(
          {
            recordedBatches: o.batches,
            totalBatches,
            handedOver,
            remaining: o.queued,
          },
        )}`
      : (STATUS_TEXT[s.status] ?? s.status);
  const withheldReasons = Object.entries((o.withheld_reasons ?? {}) as Record<string, number>)
    .map(([k, v]) => `${k} ${fmtNum(v)}`)
    .join(', ');

  const rows: Array<[string, number, string]> = [
    ['Queued', o.queued, 'approved, not yet handed to the provider'],
    [
      'Withheld',
      o.withheld,
      'approved, then no longer contactable when the send was handed over; never sent',
    ],
    ['Accepted', o.accepted, 'provider took it, no delivery report yet'],
    ['Rejected', o.rejected, 'provider refused it at hand-over'],
    [
      'Unaccounted',
      o.unaccounted,
      "handed over, but the provider's answer named it neither accepted nor rejected; not re-sent, outcome unknown until a report arrives",
    ],
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
        eyebrow={`send · ${paused ? 'paused' : s.status}`}
        title={
          <>
            {campaign?.external_id} <span className="text-muted-foreground">{campaign?.name}</span>
          </>
        }
      />

      <section className="rise grid gap-3 sm:grid-cols-4">
        <div className="rounded-sm border border-rule bg-card p-4">
          <p className="text-xs text-muted-foreground">
            Approved audience<span className="fn">1</span>
          </p>
          <p className="mt-1 font-mono text-3xl">{fmtNum(s.approved_count)}</p>
        </div>
        <div className="rounded-sm border border-rule bg-card p-4">
          <p className="text-xs text-muted-foreground">
            Withheld at hand-over<span className="fn">3</span>
          </p>
          <p className="mt-1 font-mono text-3xl">{fmtNum(o.withheld)}</p>
        </div>
        <div className="rounded-sm border border-rule bg-card p-4">
          <p className="text-xs text-muted-foreground">
            Provider accepted<span className="fn">2</span>
          </p>
          <p className="mt-1 font-mono text-3xl">{fmtNum(s.provider_accepted)}</p>
        </div>
        <div className="rounded-sm border border-rule bg-card p-4">
          <p className="text-xs text-muted-foreground">Feedback events stored</p>
          <p className="mt-1 font-mono text-3xl">{fmtNum(o.events)}</p>
        </div>
      </section>
      <p className="mt-3 text-sm">
        Approved {fmtNum(s.approved_count)}, withheld {fmtNum(o.withheld)} because they became
        uncontactable after approval, handed to the provider {fmtNum(handedOver)}
        {o.queued > 0 ? `, not yet handed over ${fmtNum(o.queued)}` : ''}.
      </p>
      <Footnote n={1}>
        Frozen when the audience was approved on {fmtDateTime(s.approved_at)}:{' '}
        {s.audience_definition}. This number does not change afterwards, whatever happens to the
        contacts.
      </Footnote>
      <Footnote n={2}>
        The provider takes at most 500 recipients per batch, so a send is handed over in{' '}
        {fmtNum(o.batches)} {o.batches === 1 ? 'batch' : 'batches'}, each under its own idempotency
        key. Accepted is the sum over every batch; rejected recipients and the provider&rsquo;s
        reason are listed per batch below.
      </Footnote>
      <Footnote n={3}>
        Approved recipients who were no longer contactable, by the same definition, at the moment
        the send was handed to the provider. They are never sent and stay counted in the approved
        audience.{withheldReasons ? ` Why: ${withheldReasons}.` : ''}
      </Footnote>

      <section className="rise rise-2 mt-6 rounded-sm border border-rule bg-card p-4">
        <p className="text-sm">{statusText}</p>
        {truncatedBatches > 0 ? (
          <p className="mt-2 border-l-2 border-bad pl-3 text-sm">
            {fmtNum(truncatedBatches)} of {fmtNum(o.batches)} batches have more provider events than
            one poll reads (20 pages); the next poll continues from where it stopped. Outcomes below
            are incomplete until then.
          </p>
        ) : null}
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-xs sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">idempotency key</dt>
            <dd className="break-all">{s.idempotency_key}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">first provider batch</dt>
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
            recordedBatches={o.batches}
            remaining={o.queued}
            stalled={
              s.status === 'dispatching' &&
              s.provider_batch_id === null &&
              s.dispatch_started_at !== null &&
              serverNowMs() - new Date(s.dispatch_started_at).getTime() > 5 * 60_000
            }
          />
        </div>
      </section>

      {batches.data.length > 0 ? (
        <section className="rise rise-3 mt-6 rounded-sm border border-rule bg-card p-4">
          <p className="text-sm">
            Provider batches
            {batches.count !== null && batches.count > batches.data.length
              ? ` (showing the first ${fmtNum(batches.data.length)} of ${fmtNum(batches.count)})`
              : ''}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Per batch, handed over = accepted + rejected + unaccounted. Unaccounted recipients were
            in the batch but the provider&rsquo;s answer named them neither way. A rejection that
            arrives without an id of this batch (an unrecognised shape) is counted beside the
            rejected figure, not dropped.
            {o.unidentified_rejections > 0
              ? ` ${fmtNum(o.unidentified_rejections)} such rejections across this send.`
              : ''}
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-normal">#</th>
                  <th className="py-1 pr-3 font-normal">batch</th>
                  <th className="py-1 pr-3 text-right font-normal">handed over</th>
                  <th className="py-1 pr-3 text-right font-normal">accepted</th>
                  <th className="py-1 pr-3 text-right font-normal">rejected</th>
                  <th className="py-1 pr-3 text-right font-normal">unaccounted</th>
                  <th className="py-1 pr-3 font-normal">reasons</th>
                  <th className="py-1 font-normal">last polled</th>
                </tr>
              </thead>
              <tbody>
                {batches.data.map((b) => (
                  <tr key={b.chunk_index} className="border-t border-rule">
                    <td className="py-1 pr-3 font-mono">{b.chunk_index + 1}</td>
                    <td className="py-1 pr-3 font-mono break-all">{b.provider_batch_id}</td>
                    <td className="py-1 pr-3 text-right font-mono">{fmtNum(b.submitted_count)}</td>
                    <td className="py-1 pr-3 text-right font-mono">{fmtNum(b.accepted_count)}</td>
                    <td className="py-1 pr-3 text-right font-mono">
                      {fmtNum(b.rejected_count)}
                      {b.unidentified_rejections > 0
                        ? ` (+${fmtNum(b.unidentified_rejections)} without an id of ours)`
                        : ''}
                    </td>
                    <td className="py-1 pr-3 text-right font-mono">
                      {fmtNum(b.unaccounted_count)}
                    </td>
                    <td className="py-1 pr-3">
                      {Object.entries((b.rejection_reasons ?? {}) as Record<string, number>)
                        .map(([k, v]) => `${k} ${fmtNum(v)}`)
                        .join(', ') || '–'}
                    </td>
                    <td className="py-1">{fmtDateTime(b.last_polled_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="rise rise-3 mt-6">
        <h3 className="text-xl">
          Where each recipient stands<span className="fn">4</span>
        </h3>
        <Footnote n={4}>
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
