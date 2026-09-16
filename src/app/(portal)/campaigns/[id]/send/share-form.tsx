'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { publishResults, type ShareState } from './share-actions';

export function ShareForm({ campaignId }: { campaignId: string }) {
  const [state, action, pending] = useActionState<ShareState, FormData>(publishResults, {});
  if (state.url) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm">Link created. It is shown once; copy it now.</p>
        <p className="break-all rounded-sm border border-rule bg-background px-3 py-2 font-mono text-xs">
          {state.url}
        </p>
        <p className="text-xs text-muted-foreground">
          Send the password separately. The link expires in 30 days and can be revoked below.
        </p>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="campaignId" value={campaignId} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="share-password">Password for the link</Label>
        <Input
          id="share-password"
          name="password"
          type="password"
          autoComplete="off"
          required
          minLength={8}
          maxLength={128}
        />
      </div>
      {state.error ? (
        <p role="alert" className="border-l-2 border-bad pl-3 text-sm text-bad">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? 'Creating link…' : 'Create shareable results link'}
      </Button>
    </form>
  );
}
