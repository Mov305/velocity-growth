import { z } from 'zod';

/**
 * The only place process.env is read. Every value is parsed against an allow-list schema and a
 * missing or malformed variable throws EnvError at the first call, not undefined at the hundredth.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const serverSchema = publicSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  PROVIDER_BASE_URL: z.url().refine((u) => new URL(u).protocol === 'https:', {
    message: 'PROVIDER_BASE_URL must use https',
  }),
  PROVIDER_API_KEY: z.string().min(1),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvError';
  }
}

function parse<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined>,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new EnvError(`Invalid environment: ${problems}`);
  }
  return result.data;
}

/** Safe in the browser. Next inlines NEXT_PUBLIC_* at build time only when read by full name. */
export function publicEnv(): PublicEnv {
  return parse(publicSchema, {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

/** Server only. Calling this in the browser is a bug and throws rather than leaking. */
export function serverEnv(): ServerEnv {
  if (typeof window !== 'undefined') throw new EnvError('serverEnv() called in the browser');
  return parse(serverSchema, process.env);
}
