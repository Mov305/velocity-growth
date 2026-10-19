'use client';

import { ErrorState } from '@/components/data/states';

/**
 * Any thrown query error lands here. It shows a retry and a reference, never a zero and never
 * the raw database text (which names tables). The full message is in the server log.
 *
 * Next 16 passes `retry`, which re-fetches the server data and re-renders the segment; `reset`
 * only re-renders without re-fetching, so a failed query would fail again from the same payload
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md).
 */
export default function PortalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const ref = error.digest ? `reference ${error.digest}` : 'no reference available';
  return <ErrorState message={ref} reset={retry} />;
}
