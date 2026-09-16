import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getMembership } from '@/lib/auth/membership';
import { UploadForm } from './upload-form';
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

const UPLOAD_ERRORS: Record<string, string> = {
  'owner-only': 'Only an owner can import a file.',
  'bad-form': 'The upload did not arrive as a form. Try again.',
  'bad-kind': 'Choose what the file contains: contacts, campaigns, events or send log.',
  'no-file': 'Choose a CSV file first.',
  'too-large': 'That file is over 4 MB. Files that size load through the CLI (README section 8).',
  'not-csv': 'Only .csv files are accepted.',
  failed:
    'The file could not be loaded. Nothing from it was stored; the failed load is listed below with its reason.',
};

export default async function ImportsPage({ searchParams }: PageProps<'/imports'>) {
  const [supabase, m, params] = await Promise.all([createClient(), getMembership(), searchParams]);
  const { rows: imports, total } = await listImports(supabase);
  const code = typeof params.error === 'string' ? params.error : undefined;
  const uploadError = code ? (UPLOAD_ERRORS[code] ?? 'The upload failed.') : undefined;

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

      <section className="rise rise-2 mt-6 rounded-sm border border-rule bg-card p-6">
        <h3 className="text-lg">Import a file</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          A CSV in this brand&rsquo;s own layout, up to 4 MB. Every row is checked before anything
          is stored; refused rows are listed with their line number and reason, and loading the same
          file twice changes nothing. Larger files load through the CLI (README section 8).
        </p>
        <div className="mt-4">
          {m?.role === 'owner' ? (
            <UploadForm error={uploadError} />
          ) : (
            <p className="rounded-sm border border-dashed border-rule px-4 py-3 text-sm text-muted-foreground">
              Only an owner can import a file. Your login is an analyst.
            </p>
          )}
        </div>
      </section>

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
