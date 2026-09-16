import type { Metadata } from 'next';
import { getMembership } from '@/lib/auth/membership';
import { createClient } from '@/lib/supabase/server';
import { getDashboard } from '@/lib/queries/dashboard';
import { fmtDate, fmtNum, fmtPct } from '@/components/data/format';
import { SignupsChart } from '@/components/data/signups-chart';
import { EmptyState, Footnote, PageHeader } from '@/components/data/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const metadata: Metadata = { title: 'Dashboard' };

function Stat({
  n,
  label,
  value,
  muted,
}: {
  n: number;
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <div className="rounded-sm border border-rule bg-card p-4">
      <p className="text-xs text-muted-foreground">
        {label}
        <span className="fn">{n}</span>
      </p>
      <p className={`mt-1 font-mono text-3xl ${muted ? 'text-muted-foreground' : ''}`}>
        {fmtNum(value)}
      </p>
    </div>
  );
}

export default async function DashboardPage() {
  const [m, supabase] = await Promise.all([getMembership(), createClient()]);
  const { summary, signups, campaigns } = await getDashboard(supabase);
  const contactablePct = fmtPct(summary.contactable, summary.total_customers);

  return (
    <>
      <PageHeader eyebrow="Dashboard" title={m?.brandName ?? 'Dashboard'} />

      <section className="rise grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat n={1} label="Total customers" value={summary.total_customers} />
        <Stat n={2} label="Contactable" value={summary.contactable} />
        <Stat n={2} label="Not contactable" value={summary.not_contactable} muted />
        <Stat n={1} label="Deleted, excluded above" value={summary.deleted_customers} muted />
      </section>
      <Footnote n={1}>
        Contacts loaded for this brand whose deleted-at is empty. Deleted contacts are counted
        separately and appear in the contacts list struck through.
      </Footnote>
      <Footnote n={2}>
        Contactable means {summary.contactable_definition}. That is {contactablePct} of total
        customers. The same definition builds the audience of a send.
      </Footnote>

      <section className="rise rise-2 mt-8">
        <SignupsChart days={signups} />
        <Footnote n={3}>
          Signups by the date in the contact&apos;s signup field, in UTC, for the 30 days ending
          today. Deleted contacts excluded. A day with no signups is shown as zero.
        </Footnote>
      </section>

      <section className="rise rise-3 mt-8">
        <h3 className="text-xl">Campaign performance</h3>
        <Footnote n={4}>
          Two sources side by side. <strong>Reported</strong> is what the brand&apos;s campaign file
          says: totals, so opens can exceed delivered when one person opened twice; a blank figure
          in the file shows as 0. <strong>Observed</strong> is what the engagement event log
          contains: &ldquo;with events&rdquo; is the number of distinct contacts that have any event
          for the campaign, and each event column is the number of distinct contacts with that
          event. The two sources do not reconcile in the seed data and are not made to.
        </Footnote>
        {campaigns.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="No campaigns loaded for this brand" />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-sm border border-rule bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead rowSpan={2} className="font-mono text-xs">
                    Campaign
                  </TableHead>
                  <TableHead rowSpan={2}>Sent at</TableHead>
                  <TableHead colSpan={5} className="border-l border-rule text-center">
                    Reported by brand
                  </TableHead>
                  <TableHead colSpan={6} className="border-l border-rule text-center">
                    Observed in event log
                  </TableHead>
                </TableRow>
                <TableRow>
                  <TableHead className="border-l border-rule text-right">Sent</TableHead>
                  <TableHead className="text-right">Delivered</TableHead>
                  <TableHead className="text-right">Bounced</TableHead>
                  <TableHead className="text-right">Opens</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="border-l border-rule text-right">With events</TableHead>
                  <TableHead className="text-right">Opened</TableHead>
                  <TableHead className="text-right">Clicked</TableHead>
                  <TableHead className="text-right">Bounced</TableHead>
                  <TableHead className="text-right">Complained</TableHead>
                  <TableHead className="text-right">Unsub.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-nowrap">
                      <span className="font-mono text-xs">{c.external_id}</span>{' '}
                      <span className="text-muted-foreground">{c.name}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {fmtDate(c.sent_at)}
                    </TableCell>
                    <TableCell className="border-l border-rule text-right font-mono text-xs">
                      {fmtNum(c.reported_sent)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {fmtNum(c.reported_delivered)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {fmtNum(c.reported_bounced)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {fmtNum(c.reported_opens)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {fmtNum(c.reported_clicks)}
                    </TableCell>
                    <TableCell className="border-l border-rule text-right font-mono text-xs">
                      {fmtNum(c.observed_contacts)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {fmtNum(c.observed_opened)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {fmtNum(c.observed_clicked)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {fmtNum(c.observed_bounced)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {fmtNum(c.observed_complained)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {fmtNum(c.observed_unsubscribed)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </>
  );
}
