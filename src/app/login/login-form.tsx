'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signInWithPassword, type LoginState } from './actions';

export function LoginForm({ urlError }: { urlError?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signInWithPassword, {});
  const error = state.error ?? urlError;

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
        />
      </div>
      {error ? (
        <p role="alert" className="border-l-2 border-bad pl-3 text-sm text-bad">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="mt-1">
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
