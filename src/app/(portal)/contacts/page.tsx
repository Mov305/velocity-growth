import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { CONTACT_STATUSES, parseListParams } from '@/lib/params';
import { listContacts } from '@/lib/queries/contacts';
import { fmtDate } from '@/components/data/format';
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

export const metadata: Metadata = { title: 'Contacts' };

export default async function ContactsPage({ searchParams }: PageProps<'/contacts'>) {
  const params = parseListParams(await searchParams);
  const supabase = await createClient();
  const page = await listContacts(supabase, params);

  const href = (p: number) => {
    const s = new URLSearchParams();
    if (params.q) s.set('q', params.q);
    if (params.status) s.set('status', params.status);
    if (p > 1) s.set('page', String(p));
    const qs = s.toString();
    return qs ? `/contacts?${qs}` : '/contacts';
  };

  return (
    <>
      <PageHeader
        eyebrow="Contacts"
        title={
          <>
            {page.total.toLocaleString('en-GB')} contacts<span className="fn">1</span>
          </>
        }
      >
        <form method="get" action="/contacts" className="flex flex-wrap items-center gap-2">
          <Input
            name="q"
            defaultValue={params.q}
            placeholder="Search name, email or id"
            aria-label="Search contacts"
            className="w-60"
          />
          <select
            name="status"
            defaultValue={params.status ?? ''}
            aria-label="Status"
            className="h-9 rounded-sm border border-input bg-card px-2 text-sm"
          >
            <option value="">Any status</option>
            {CONTACT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline" size="sm">
            Filter
          </Button>
        </form>
      </PageHeader>
      <Footnote n={1}>
        Rows in this brand&apos;s contact table matching the filter, including contacts marked
        deleted (shown struck through). The dashboard&apos;s &ldquo;total customers&rdquo; excludes
        deleted contacts and says so there.
      </Footnote>

      {page.rows.length === 0 && page.total > 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Nothing on this page"
            hint={`There are ${page.total.toLocaleString('en-GB')} contacts; this page number is past the end.`}
          />
        </div>
      ) : page.rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={params.q || params.status ? 'No contacts match' : 'No contacts loaded yet'}
            hint={
              params.q || params.status
                ? 'Clear the filter to see everything.'
                : 'Run an import to load this brand’s contact file.'
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
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Consent</TableHead>
                <TableHead>Signed up</TableHead>
                <TableHead>Flags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.rows.map((c) => {
                const deleted = c.deleted_at !== null;
                const suppressed =
                  c.suppressed_until !== null && new Date(c.suppressed_until) > new Date();
                return (
                  <TableRow
                    key={c.id}
                    className={deleted ? 'text-muted-foreground line-through' : ''}
                  >
                    <TableCell className="font-mono text-xs">{c.external_id}</TableCell>
                    <TableCell className="whitespace-nowrap">{c.full_name ?? '–'}</TableCell>
                    <TableCell className="font-mono text-xs">{c.email ?? '–'}</TableCell>
                    <TableCell className="font-mono text-xs">{c.phone ?? '–'}</TableCell>
                    <TableCell>{c.country ?? '–'}</TableCell>
                    <TableCell>
                      <span className="font-mono text-xs">{c.status}</span>
                      {deleted ? (
                        <span className="ml-1 font-mono text-[10px] uppercase">deleted</span>
                      ) : null}
                      {suppressed ? (
                        <span className="ml-1 font-mono text-[10px] uppercase">suppressed</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {c.consent_marketing ? 'yes' : 'no'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {fmtDate(c.signup_at)}
                    </TableCell>
                    <TableCell>
                      <Flags flags={c.flags} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination page={page.page} pageSize={page.pageSize} total={page.total} makeHref={href} />
    </>
  );
}
