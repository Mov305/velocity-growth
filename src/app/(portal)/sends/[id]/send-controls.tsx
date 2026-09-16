'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { confirmSend, pollNow, type ActionState } from '../actions';

export function SendControls({
  sendId,
  status,
  role,
  hasBatch,
  approvedCount,
  stalled,
}: {
  sendId: string;
  status: string;
  role: 'owner' | 'analyst';
  hasBatch: boolean;
  approvedCount: number;
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

  const canConfirm =
    role === 'owner' &&
    !hasBatch &&
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
                : status === 'failed'
                  ? `Retry send to ${approvedCount.toLocaleString('en-GB')}`
                  : status === 'dispatching'
                    ? `Retry stalled send to ${approvedCount.toLocaleString('en-GB')}`
                    : `Confirm send to ${approvedCount.toLocaleString('en-GB')}`}
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
          Confirming calls the provider once with this send&apos;s idempotency key. Pressing it
          again, or from another session, cannot send twice.
        </p>
      ) : null}
    </div>
  );
}
