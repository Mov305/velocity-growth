'use client';

import { Button } from '@/components/ui/button';

/**
 * Boundary for every route outside the portal shell: /share, /login, /no-access. The portal has its
 * own (portal)/error.tsx. Same rule as there: a retry and a reference, never the raw error text,
 * which can name tables. The full message is in the server log under the digest.
 */
export default function RootError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const ref = error.digest ? `reference ${error.digest}` : 'no reference available';
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
        Velocity Growth
      </p>
      <div role="alert" className="mt-2">
        <h1 className="text-3xl text-bad">This page could not load</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Something failed on our side, not in what you entered. Nothing was changed. Try again in a
          moment; if it keeps happening, send Velocity Growth the reference below.
        </p>
        <p className="mt-3 font-mono text-xs text-muted-foreground">{ref}</p>
        <Button onClick={() => retry()} variant="outline" className="mt-8">
          Try again
        </Button>
      </div>
    </main>
  );
}
