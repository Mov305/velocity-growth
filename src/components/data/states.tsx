import type { ReactNode } from 'react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

export function PageHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="rise mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          {eyebrow}
        </p>
        <h2 className="mt-1 text-3xl sm:text-4xl">{title}</h2>
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

/** Footnote marker plus its text, rendered together so the definition is never separated. */
export function Footnote({ n, children }: { n: number; children: ReactNode }) {
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      <span className="fn">{n}</span> {children}
    </p>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-sm border border-dashed border-rule px-6 py-14 text-center">
      <p className="font-heading text-xl">{title}</p>
      {hint ? <p className="mt-2 text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function ErrorState({ message, reset }: { message: string; reset?: () => void }) {
  return (
    <div role="alert" className="rounded-sm border border-bad/40 bg-card px-6 py-8">
      <p className="font-heading text-xl text-bad">This view could not load</p>
      <p className="mt-2 font-mono text-xs text-muted-foreground">{message}</p>
      <p className="mt-3 text-sm text-muted-foreground">
        Nothing on this screen is a real number until it loads. Try again, or sign out and back in.
      </p>
      {reset ? (
        <Button onClick={reset} variant="outline" size="sm" className="mt-4">
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-9 w-64" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  makeHref,
}: {
  page: number;
  pageSize: number;
  total: number;
  makeHref: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  // A page past the end shows 0–0, never an arithmetic range that runs beyond the total.
  const beyond = (page - 1) * pageSize >= total;
  const from = total === 0 || beyond ? 0 : (page - 1) * pageSize + 1;
  const to = total === 0 || beyond ? 0 : Math.min(total, page * pageSize);
  return (
    <div className="mt-4 flex flex-col items-start justify-between gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center">
      <span className="font-mono text-xs">
        Showing {from.toLocaleString('en-GB')}–{to.toLocaleString('en-GB')} of{' '}
        {total.toLocaleString('en-GB')}
      </span>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Button
            render={<Link href={makeHref(page - 1)} />}
            nativeButton={false}
            variant="outline"
            size="sm"
          >
            Previous
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Previous
          </Button>
        )}
        <span className="font-mono text-xs">
          page {page} / {pages}
        </span>
        {page < pages ? (
          <Button
            render={<Link href={makeHref(page + 1)} />}
            nativeButton={false}
            variant="outline"
            size="sm"
          >
            Next
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}

const FLAG_LABEL: Record<string, string> = {
  email_invalid: 'email invalid',
  phone_corrupted: 'phone corrupted',
  phone_invalid: 'phone invalid',
  no_channel: 'no channel',
  consent_missing: 'consent missing',
  country_unrecognised: 'country unknown',
  signup_missing: 'no signup date',
  name_missing: 'no name',
  brand_code_missing: 'brand code missing',
  parent_unresolved: 'parent not in this brand',
};

export function Flags({ flags }: { flags: string[] }) {
  if (flags.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <span
          key={f}
          className="rounded-sm border border-warn/50 bg-warn/10 px-1.5 py-0.5 font-mono text-[10px] text-ink"
        >
          {FLAG_LABEL[f] ?? f}
        </span>
      ))}
    </span>
  );
}
