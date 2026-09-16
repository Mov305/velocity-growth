import type { ReactNode } from 'react';
import type { Membership } from '@/lib/auth/membership';
import { Button } from '@/components/ui/button';
import { MobileNav, NavLinks } from './nav';

export function Shell({ membership, children }: { membership: Membership; children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-rule bg-paper/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <MobileNav />
          <div className="flex min-w-0 items-baseline gap-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              VG
            </span>
            <h1 className="truncate text-xl leading-none sm:text-2xl">{membership.brandName}</h1>
          </div>
          <nav className="ml-8 hidden md:block">
            <NavLinks />
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span
              className="rounded-sm border border-rule bg-card px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground"
              title={membership.email}
            >
              {membership.role}
            </span>
            <form action="/auth/signout" method="post">
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">{children}</main>
      <footer className="mx-auto w-full max-w-7xl px-4 pb-8 text-xs text-muted-foreground sm:px-6">
        Numbers on this portal carry a footnote saying how they were counted. If a number has no
        footnote, it is a raw count of rows.
      </footer>
    </div>
  );
}
