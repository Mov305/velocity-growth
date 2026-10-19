'use client';

import './globals.css';

/**
 * Last-resort boundary for a failure in the root layout itself, where error.tsx cannot render.
 * It replaces the whole document, so it carries its own html and body and no app fonts. Same
 * rule as every other boundary: a retry and a reference, never the raw error text.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const ref = error.digest ? `reference ${error.digest}` : 'no reference available';
  return (
    <html lang="en">
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        <title>Something went wrong · Velocity Growth</title>
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Velocity Growth
          </p>
          <div role="alert" className="mt-2">
            <h1 className="text-3xl text-bad">This page could not load</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              Something failed on our side, not in what you entered. Nothing was changed. Try again
              in a moment; if it keeps happening, send Velocity Growth the reference below.
            </p>
            <p className="mt-3 font-mono text-xs text-muted-foreground">{ref}</p>
            <button
              type="button"
              onClick={() => retry()}
              className="mt-8 rounded-sm border border-rule px-4 py-2 text-sm"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
