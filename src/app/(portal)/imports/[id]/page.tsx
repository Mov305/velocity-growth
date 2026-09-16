import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { parseListParams } from '@/lib/params';
import { getImport, listRejects, rejectReasonSummary } from '@/lib/queries/imports';
import { fmtDateTime, fmtNum } from '@/components/data/format';
import { EmptyState, Footnote, PageHeader, Pagination } from '@/components/data/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const metadata: Metadata = { title: 'Import detail' };

export default async function ImportDetailPage({
  params,
  searchParams,
}: PageProps<'/imports/[id]'>) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const list = parseListParams(await searchParams);
  const supabase = await createClient();

  const imp = await getImport(supabase, id);
  if (!imp) notFound();

  const [rejects, summary] = await Promise.all([
    listRejects(supabase, id, list.page),
    rejectReasonSummary(supabase, id),
  ]);

  const accounted =
    imp.rows_upserted + imp.rows_rejected + imp.rows_skipped_duplicate + imp.rows_already_present;

  return (
    <>
      <p className="mb-3 text-sm">
        <Link href="/imports" className="text-muted-foreground underline-offset-2 hover:underline">
          ← All imports
        </Link>
      </p>
      <PageHeader eyebrow={`${imp.kind} · ${imp.status}`} title={imp.file_name} />

      <dl className="rise rise-2 grid grid-cols-2 gap-x-6 gap-y-3 rounded-sm border border-rule bg-card p-4 font-mono text-xs sm:grid-cols-4 lg:grid-cols-6">
        <div>
          <dt className="text-muted-foreground">started</dt>
          <dd>{fmtDateTime(imp.started_at)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">read</dt>
          <dd>{fmtNum(imp.rows_read)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">upserted</dt>
          <dd>{fmtNum(imp.rows_upserted)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">rejected</dt>
          <dd className={imp.rows_rejected > 0 ? 'text-bad' : ''}>{fmtNum(imp.rows_rejected)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">dup skipped</dt>
          <dd>{fmtNum(imp.rows_skipped_duplicate)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">already present</dt>
          <dd>{fmtNum(imp.rows_already_present)}</dd>
        </div>
      </dl>
      <Footnote n={1}>
        {imp.status === 'succeeded'
          ? accounted === imp.rows_read
            ? `Every one of the ${fmtNum(imp.rows_read)} rows read is accounted for above.`
            : `Warning: ${fmtNum(imp.rows_read)} rows read but only ${fmtNum(accounted)} accounted for. This should not happen; report it.`
          : imp.status === 'failed'
            ? `This load failed and stored nothing: ${imp.error ?? 'no reason recorded'}.`
            : 'This load is still running.'}
      </Footnote>

      {summary.length > 0 ? (
        <div className="rise rise-3 mt-8">
          <h3 className="text-xl">Why rows were refused</h3>
          <ul className="mt-3 flex flex-col gap-1 font-mono text-xs">
            {summary.map((s) => (
              <li key={s.reason} className="flex justify-between gap-6 border-b border-rule py-1.5">
                <span>{s.reason}</span>
                <span className="text-muted-foreground">{fmtNum(s.count)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rise rise-4 mt-8">
        <h3 className="text-xl">Refused rows</h3>
        {rejects.total === 0 ? (
          <div className="mt-3">
            <EmptyState title="Nothing was refused in this load" />
          </div>
        ) : (
          <>
            <div className="mt-3 overflow-x-auto rounded-sm border border-rule bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24 text-right">Line</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Row as it appeared in the file</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rejects.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-right font-mono text-xs">
                        {fmtNum(r.row_number)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs text-bad">
                        {r.reason}
                      </TableCell>
                      <TableCell>
                        <details>
                          <summary className="cursor-pointer font-mono text-xs text-muted-foreground">
                            show values
                          </summary>
                          <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5 font-mono text-[11px]">
                            {Object.entries((r.raw ?? {}) as Record<string, string>).map(
                              ([k, v]) => (
                                <div key={k} className="contents">
                                  <dt className="text-muted-foreground">{k}</dt>
                                  <dd className="break-all">
                                    {v === '' ? (
                                      <span className="text-muted-foreground">(empty)</span>
                                    ) : (
                                      v
                                    )}
                                  </dd>
                                </div>
                              ),
                            )}
                          </dl>
                        </details>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination
              page={rejects.page}
              pageSize={rejects.pageSize}
              total={rejects.total}
              makeHref={(p) => (p > 1 ? `/imports/${id}?page=${p}` : `/imports/${id}`)}
            />
          </>
        )}
      </div>
    </>
  );
}
