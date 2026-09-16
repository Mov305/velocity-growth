'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { approveSend, type ActionState } from '@/app/(portal)/sends/actions';

export function ApproveForm({ campaignId, count }: { campaignId: string; count: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(approveSend, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="campaignId" value={campaignId} />
      {state.error ? (
        <p role="alert" className="border-l-2 border-bad pl-3 text-sm text-bad">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending || count === 0}>
        {pending
          ? 'Freezing the audience…'
          : `Approve audience of ${count.toLocaleString('en-GB')}`}
      </Button>
      <p className="text-xs text-muted-foreground">
        Nothing is sent at this step. You confirm on the next screen.
      </p>
    </form>
  );
}
