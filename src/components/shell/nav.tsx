'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';

const LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/contacts', label: 'Contacts' },
  { href: '/campaigns', label: 'Campaigns' },
  { href: '/imports', label: 'Imports' },
] as const;

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-1 md:flex-row md:gap-6">
      {LINKS.map((l) => {
        const active = isActive(pathname, l.href);
        return (
          <li key={l.href}>
            <Link
              href={l.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={
                'block py-2 text-sm transition md:py-1 ' +
                (active
                  ? 'border-b-2 border-accent-ink text-ink'
                  : 'border-b-2 border-transparent text-muted-foreground hover:text-ink')
              }
            >
              {l.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <div className="md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={
            <Button variant="outline" size="sm" aria-label="Open navigation">
              Menu
            </Button>
          }
        />
        <SheetContent side="left" className="w-72">
          <SheetTitle className="font-heading text-lg">Navigate</SheetTitle>
          <div className="mt-4">
            <NavLinks onNavigate={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
