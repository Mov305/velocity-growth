import { config } from 'dotenv';
import { existsSync } from 'node:fs';

if (!existsSync('.env.test')) {
  throw new Error('.env.test missing. Run: pnpm db:start && pnpm env:local && pnpm seed:users');
}
config({ path: '.env.test', quiet: true });

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`.env.test is missing ${name}`);
  return v;
}

export const rlsEnv = {
  url: need('NEXT_PUBLIC_SUPABASE_URL'),
  anonKey: need('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  serviceKey: need('SUPABASE_SERVICE_ROLE_KEY'),
  dbUrl: need('DATABASE_URL'),
};

export type SeedLogin = { email: string; brand: string; role: 'owner' | 'analyst'; name: string };

export function seedLogins(): SeedLogin[] {
  const raw = process.env.SEED_LOGINS;
  if (!raw) throw new Error('SEED_LOGINS missing from .env.test. Run pnpm env:local.');
  const parsed = JSON.parse(raw) as SeedLogin[];
  if (parsed.length !== 6) throw new Error(`expected 6 seed logins, got ${parsed.length}`);
  return parsed;
}

export function seedPasswords(): Record<string, string> {
  const raw = process.env.SEED_PASSWORDS_JSON;
  if (!raw) throw new Error('SEED_PASSWORDS_JSON missing from .env.test. Run pnpm seed:users.');
  return JSON.parse(raw) as Record<string, string>;
}
