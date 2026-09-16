import { getMembership } from '@/lib/auth/membership';
import { PageHeader } from '@/components/data/states';

/** Placeholder until stage 4 delivers the dashboard. Says so instead of showing zeros. */
export default async function DashboardPage() {
  const m = await getMembership();
  return (
    <>
      <PageHeader eyebrow="Dashboard" title={m?.brandName ?? 'Dashboard'} />
      <div className="rounded-sm border border-dashed border-rule px-6 py-14 text-center">
        <p className="font-heading text-xl">The dashboard arrives in the next release</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Total customers, contactable customers, signups over the last 30 days and campaign
          performance, each with a footnote saying how it was counted.
        </p>
      </div>
    </>
  );
}
