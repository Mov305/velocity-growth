import type { Metadata } from 'next';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'No access' };

/** Signed in, but no membership. No data query runs on this page. */
export default function NoAccessPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
        Velocity Growth
      </p>
      <h1 className="mt-2 text-3xl">This login has no brand</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        You signed in, but no brand is assigned to this account, so there is nothing to show. Ask
        Velocity Growth to add you to a brand, then sign in again.
      </p>
      <form action="/auth/signout" method="post" className="mt-8">
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </main>
  );
}
