'use client';

import { ErrorState } from '@/components/data/states';

/**
 * Any thrown query error lands here. It shows a retry and a reference, never a zero and never
 * the raw database text (which names tables). The full message is in the server log.
 */
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const ref = error.digest ? `reference ${error.digest}` : 'no reference available';
  return <ErrorState message={ref} reset={reset} />;
}
