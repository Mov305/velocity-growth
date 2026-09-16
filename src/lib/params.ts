import { z } from 'zod';

export const PAGE_SIZE = 50;

export const CONTACT_STATUSES = ['active', 'unsubscribed', 'bounced', 'pending'] as const;
export type ContactStatusFilter = (typeof CONTACT_STATUSES)[number];

export type ListParams = {
  page: number;
  q: string;
  status: ContactStatusFilter | undefined;
};

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const Schema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || !/^\d+$/.test(v)) return 1;
      const n = Number(v);
      return n >= 1 ? n : 1;
    }),
  q: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .trim()
        // Control characters never belong in a search. Everything else, including dots, commas
        // and quotes, is kept: the query layer quotes the value for PostgREST (see orValue).
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .slice(0, 100),
    ),
  status: z
    .string()
    .optional()
    .transform((v) =>
      (CONTACT_STATUSES as readonly string[]).includes(v ?? '')
        ? (v as ContactStatusFilter)
        : undefined,
    ),
});

/** URL search params to a safe, bounded shape. Garbage becomes the default, never an error page. */
export function parseListParams(searchParams: SearchParams): ListParams {
  return Schema.parse({
    page: first(searchParams.page),
    q: first(searchParams.q),
    status: first(searchParams.status),
  });
}

export function rangeFor(page: number): { from: number; to: number } {
  const from = (page - 1) * PAGE_SIZE;
  return { from, to: from + PAGE_SIZE - 1 };
}
