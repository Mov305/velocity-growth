import { redirect } from 'next/navigation';
import { getMembership } from '@/lib/auth/membership';
import { Shell } from '@/components/shell/shell';

/**
 * Every portal page lives under this layout. The membership is resolved once here; pages receive
 * nothing about the brand and query through the user-scoped client, so RLS is the filter.
 */
export default async function PortalLayout({ children }: LayoutProps<'/'>) {
  const membership = await getMembership();
  if (!membership) redirect('/no-access');
  return <Shell membership={membership}>{children}</Shell>;
}
