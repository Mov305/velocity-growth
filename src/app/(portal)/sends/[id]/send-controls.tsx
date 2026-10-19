'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { confirmSend, pollNow, type ActionState } from '../actions';

const fmt = (x: number) => x.toLocaleString('en-GB');

export function SendControls({
  sendId,
  status,
  role,
  hasBatch,
  approvedCount,
  recordedBatches,
  remaining,
  stalled,
}: {
  sendId: string;
  status: string;
  role: 'owner' | 'analyst';
  hasBatch: boolean;
  approvedCount: number;
  /** batches already recorded as handed to the provider */
  recordedBatches: number;
  /** recipients still queued: what a confirm or resume would hand over now */
  remaining: number;
  /** dispatching with no batch for more than five minutes: the process died mid-flight */
  stalled: boolean;
}) {
  const router = useRouter();
  const [confirmState, confirmAction, confirming] = useActionState<ActionState, FormData>(
    confirmSend,
    {},
  );
  const [pollState, pollAction, polling] = useActionState<ActionState, FormData>(pollNow, {});

  useEffect(() => {
    if (confirmState.notice || pollState.notice) router.refresh();
  }, [confirmState.notice, pollState.notice, router]);

  // A failed send with no batch recorded and nobody queued has nothing to hand over; a retry
  // would only fail again. The page tells the owner to approve the campaign again instead.
  const nothingLeft = status === 'failed' && recordedBatches === 0 && remaining === 0;
  const canConfirm =
    role === 'owner' &&
    !hasBatch &&
    !nothingLeft &&
    (status === 'approved' || status === 'failed' || (status === 'dispatching' && stalled));
  const canPoll = hasBatch && status === 'dispatched';
  const message = confirmState.error ?? confirmState.notice ?? pollState.error ?? pollState.notice;
  const isError = Boolean(confirmState.error || pollState.error);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {canConfirm ? (
          <form action={confirmAction}>
            <input type="hidden" name="sendId" value={sendId} />
            <Button type="submit" disabled={confirming}>
              {confirming
                ? 'Sending…'
                : status === 'approved'
                  ? `Confirm send to ${fmt(approvedCount)}`
                  : recordedBatches > 0
                    ? `Resume: hand over the remaining ${fmt(remaining)}`
                    : status === 'dispatching'
                      ? `Retry stalled send to ${fmt(remaining)}`
                      : `Retry send to ${fmt(remaining)}`}
            </Button>
          </form>
        ) : null}
        {canPoll ? (
          <form action={pollAction}>
            <input type="hidden" name="sendId" value={sendId} />
            <Button type="submit" variant="outline" disabled={polling}>
              {polling ? 'Polling…' : 'Poll provider now'}
            </Button>
          </form>
        ) : null}
        {role === 'analyst' && !hasBatch ? (
          <p className="text-sm text-muted-foreground">Only an owner can confirm this send.</p>
        ) : null}
      </div>
      {message ? (
        <p
          role="status"
          className={`border-l-2 pl-3 text-sm ${isError ? 'border-bad text-bad' : 'border-ok'}`}
        >
          {message}
        </p>
      ) : null}
      {canConfirm ? (
        <p className="text-xs text-muted-foreground">
          Confirming hands the audience to the provider in batches of 500, each under its own
          idempotency key derived from this send&apos;s. Pressing it again, or from another session,
          cannot send twice; a resume skips every batch already recorded. Anyone who became
          uncontactable since approval is withheld at hand-over and counted separately.
        </p>
      ) : null}
    </div>
  );
}
