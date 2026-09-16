import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime, fmtNum } from '@/components/data/format';
import { EmptyState, Footnote, PageHeader } from '@/components/data/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const metadata: Metadata = { title: 'Sends' };

export default async function SendsPage() {
  const supabase = await createClient();
  const { data, error, count } = await supabase
    .from('sends')
    .select(
      'id, status, approved_count, provider_accepted, provider_batch_id, approved_at, dispatched_at, last_error, campaigns ( external_id, name )',
      { count: 'exact' },
    )
    .order('approved_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(`sends query failed: ${error.message}`);
  if (count === null) throw new Error('sends query returned no count');

  return (
    <>
      <PageHeader
        eyebrow="Sends"
        title={
          <>
            {count.toLocaleString('en-GB')} sends<span className="fn">1</span>
          </>
        }
      />
      <Footnote n={1}>
        Every audience an owner approved for this brand, sent or not, newest first
        {data.length >= 200
          ? `; showing the latest ${data.length} of ${count.toLocaleString('en-GB')}`
          : ''}
        . Open one to confirm, retry, poll the provider, or read where each recipient stands.
      </Footnote>
      {data.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No sends yet"
            hint="Open a campaign and choose Send to approve an audience."
          />
        </div>
      ) : (
        <div className="rise rise-2 mt-6 overflow-x-auto rounded-sm border border-rule bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Approved</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Audience</TableHead>
                <TableHead className="text-right">Accepted</TableHead>
                <TableHead>Batch</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((s) => {
                const c = Array.isArray(s.campaigns) ? s.campaigns[0] : s.campaigns;
                return (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      <Link href={`/sends/${s.id}`} className="underline-offset-2 hover:underline">
                        {fmtDateTime(s.approved_at)}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className="font-mono text-xs">{c?.external_id}</span>{' '}
                      <span className="text-muted-foreground">{c?.name}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.status}
                      {s.last_error ? <span className="ml-2 text-bad">!</span> : null}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {fmtNum(s.approved_count)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {fmtNum(s.provider_accepted)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.provider_batch_id ?? '–'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
