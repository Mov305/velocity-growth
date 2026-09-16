import Link from 'next/link';

/**
 * Reached when a page calls notFound(): an id that does not exist, or one that belongs to
 * another brand. Both look identical here on purpose; RLS makes them the same thing.
 */
export default function PortalNotFound() {
  return (
    <div className="rounded-sm border border-dashed border-rule px-6 py-14 text-center">
      <p className="font-heading text-xl">Not found in this brand</p>
      <p className="mt-2 text-sm text-muted-foreground">
        There is nothing at this address for your brand. It may belong to another brand, or the link
        may be wrong.
      </p>
      <Link href="/" className="mt-4 inline-block text-sm underline-offset-2 hover:underline">
        Back to the dashboard
      </Link>
    </div>
  );
}
