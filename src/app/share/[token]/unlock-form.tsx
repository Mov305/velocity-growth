'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { unlockShare, type UnlockState } from './actions';

export function UnlockForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<UnlockState, FormData>(unlockShare, {});
  const router = useRouter();
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="off"
          required
          maxLength={128}
        />
      </div>
      {state.error ? (
        <p role="alert" className="border-l-2 border-bad pl-3 text-sm text-bad">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending || state.ok === true} className="mt-1">
        {pending || state.ok ? 'Opening…' : 'Open results'}
      </Button>
    </form>
  );
}
