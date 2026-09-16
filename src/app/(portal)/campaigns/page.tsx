import type { Metadata } from 'next';
import Link from 'next/link';
import { getMembership } from '@/lib/auth/membership';
import { createClient } from '@/lib/supabase/server';
import { parseListParams } from '@/lib/params';
import { listCampaigns } from '@/lib/queries/campaigns';
import { fmtDate, fmtMoney, fmtNum, fmtPct } from '@/components/data/format';
import { EmptyState, Flags, Footnote, PageHeader, Pagination } from '@/components/data/states';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const metadata: Metadata = { title: 'Campaigns' };

export default async function CampaignsPage({ searchParams }: PageProps<'/campaigns'>) {
  const params = parseListParams(await searchParams);
  const [m, supabase] = await Promise.all([getMembership(), createClient()]);
  const page = await listCampaigns(supabase, params);
  const isOwner = m?.role === 'owner';

  const href = (p: number) => {
    const s = new URLSearchParams();
    if (params.q) s.set('q', params.q);
    if (p > 1) s.set('page', String(p));
    const qs = s.toString();
    return qs ? `/campaigns?${qs}` : '/campaigns';
  };

  return (
    <>
      <PageHeader
        eyebrow="Campaigns"
        title={
          <>
            {page.total.toLocaleString('en-GB')} campaigns<span className="fn">1</span>
          </>
        }
      >
        <form method="get" action="/campaigns" className="flex items-center gap-2">
          <Input
            name="q"
            defaultValue={params.q}
            placeholder="Search name or id"
            aria-label="Search campaigns"
            className="w-56"
          />
          <Button type="submit" variant="outline" size="sm">
            Filter
          </Button>
        </form>
      </PageHeader>
      <Footnote n={1}>
        Figures are as reported in the brand&apos;s own campaign file: sent, delivered, opens and
        clicks are totals the brand supplied, so opens can exceed delivered when one person opened
        more than once. Delivery rate is delivered ÷ sent from those figures. The dashboard shows
        these next to what the event log observed.
      </Footnote>

      {page.rows.length === 0 && page.total > 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Nothing on this page"
            hint={`There are ${page.total.toLocaleString('en-GB')} campaigns; this page number is past the end.`}
          />
        </div>
      ) : page.rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={params.q ? 'No campaigns match' : 'No campaigns loaded yet'}
            hint={
              params.q
                ? 'Clear the search to see everything.'
                : 'Run an import to load this brand’s campaign file.'
            }
          />
        </div>
      ) : (
        <div className="rise rise-2 mt-6 overflow-x-auto rounded-sm border border-rule bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-mono text-xs">Id</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Sent at</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead className="text-right">Delivered</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Opens</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs">{c.external_id}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {c.name}
                    {c.parent_external_id ? (
                      <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                        child of {c.parent_external_id}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{c.channel}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs">
                    {fmtDate(c.sent_at)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {fmtNum(c.reported_sent)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {fmtNum(c.reported_delivered)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {fmtPct(c.reported_delivered, c.reported_sent)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {fmtNum(c.reported_opens)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {fmtNum(c.reported_clicks)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {fmtMoney(c.spend)}
                  </TableCell>
                  <TableCell>
                    <Flags flags={c.flags} />
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/campaigns/${c.id}/send`}
                      className="whitespace-nowrap font-mono text-xs underline-offset-2 hover:underline"
                    >
                      {isOwner ? 'Send' : 'Audience'}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination page={page.page} pageSize={page.pageSize} total={page.total} makeHref={href} />
    </>
  );
}
