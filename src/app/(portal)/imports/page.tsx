import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { listImports } from '@/lib/queries/imports';
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

export const metadata: Metadata = { title: 'Imports' };

const STATUS_CLASS: Record<string, string> = {
  succeeded: 'text-ok',
  failed: 'text-bad',
  running: 'text-warn',
};

export default async function ImportsPage() {
  const supabase = await createClient();
  const { rows: imports, total } = await listImports(supabase);

  return (
    <>
      <PageHeader
        eyebrow="Imports"
        title={
          <>
            {total.toLocaleString('en-GB')} file loads<span className="fn">1</span>
          </>
        }
      />
      <Footnote n={1}>
        {total > imports.length
          ? `Showing the latest ${imports.length.toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')} loads. `
          : null}
        One row per file load, newest first. For every load, read = upserted + rejected + duplicates
        skipped + already present. Open a load to see each refused row with its line number and
        reason.
      </Footnote>

      {imports.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="Nothing has been imported for this brand" />
        </div>
      ) : (
        <div className="rise rise-2 mt-6 overflow-x-auto rounded-sm border border-rule bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>File</TableHead>
                <TableHead className="text-right">Read</TableHead>
                <TableHead className="text-right">Upserted</TableHead>
                <TableHead className="text-right">Rejected</TableHead>
                <TableHead className="text-right">Dup skipped</TableHead>
                <TableHead className="text-right">Already present</TableHead>
                <TableHead>Encoding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {imports.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs">
                    <Link href={`/imports/${i.id}`} className="underline-offset-2 hover:underline">
                      {fmtDateTime(i.started_at)}
                    </Link>
                  </TableCell>
                  <TableCell className={`font-mono text-xs ${STATUS_CLASS[i.status] ?? ''}`}>
                    {i.status}
                    {i.error ? (
                      <span
                        className="ml-2 block max-w-xs truncate text-[11px] text-muted-foreground"
                        title={i.error}
                      >
                        {i.error}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{i.kind}</TableCell>
                  <TableCell className="font-mono text-xs">{i.file_name}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {fmtNum(i.rows_read)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {fmtNum(i.rows_upserted)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {i.rows_rejected > 0 ? (
                      <Link
                        href={`/imports/${i.id}`}
                        className="text-bad underline-offset-2 hover:underline"
                      >
                        {fmtNum(i.rows_rejected)}
                      </Link>
                    ) : (
                      fmtNum(i.rows_rejected)
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {fmtNum(i.rows_skipped_duplicate)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {fmtNum(i.rows_already_present)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{i.encoding}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
