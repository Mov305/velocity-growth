/**
 * Upserts allowed_emails from SEED_LOGINS and creates the six auth users with the admin API.
 * Idempotent: an existing user gets its password reset to the stored one.
 *
 * Passwords come from SEED_PASSWORDS_JSON if set, else from .credentials.local.json (gitignored),
 * else they are generated, written to that file, and appended to the env file so the RLS suite
 * can sign in.
 *
 * Usage:  pnpm seed:users                          (local stack, reads .env.test)
 *         ENV_FILE=.env.production pnpm seed:users (hosted project)
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const envFile = process.env.ENV_FILE ?? '.env.test';
config({ path: envFile, quiet: true });

type Login = { email: string; brand: string; role: 'owner' | 'analyst'; name: string };

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${envFile} is missing ${name}`);
  return v;
}

const logins = JSON.parse(need('SEED_LOGINS')) as Login[];
if (logins.length !== 6) throw new Error(`expected 6 logins, got ${logins.length}`);
for (const l of logins) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(l.email))
    throw new Error(`bad email in SEED_LOGINS: ${l.email}`);
  if (l.role !== 'owner' && l.role !== 'analyst')
    throw new Error(`bad role for ${l.email}: ${l.role}`);
  // Values are written into a single-quoted env line; allow only characters that cannot break it.
  if (!/^[A-Za-z0-9 .-]{1,60}$/.test(l.name))
    throw new Error(
      `display name for ${l.email} may only contain letters, digits, space, dot, dash`,
    );
  if (!/^[A-Za-z0-9._@+-]+$/.test(l.email))
    throw new Error(`email for ${l.email} has unsafe characters`);
}

const credPath = '.credentials.local.json';
const stored: Record<string, string> = process.env.SEED_PASSWORDS_JSON
  ? (JSON.parse(process.env.SEED_PASSWORDS_JSON) as Record<string, string>)
  : existsSync(credPath)
    ? (JSON.parse(readFileSync(credPath, 'utf8')) as Record<string, string>)
    : {};

let generated = false;
for (const l of logins) {
  if (!stored[l.email]) {
    stored[l.email] = randomBytes(12).toString('base64url');
    generated = true;
  }
}
if (generated) {
  writeFileSync(credPath, JSON.stringify(stored, null, 2) + '\n');
  console.log(`wrote ${credPath}`);
}
if (!process.env.SEED_PASSWORDS_JSON) {
  appendFileSync(envFile, `\nSEED_PASSWORDS_JSON='${JSON.stringify(stored)}'\n`);
  console.log(`appended SEED_PASSWORDS_JSON to ${envFile}`);
}

const admin = createClient(need('NEXT_PUBLIC_SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: brands, error: bErr } = await admin.from('brands').select('id, code');
  if (bErr) throw bErr;
  const brandId = (code: string) => {
    const b = brands.find((x) => x.code === code);
    if (!b)
      throw new Error(`brand ${code} not in database; run pnpm db:reset (seed.sql inserts brands)`);
    return b.id;
  };

  const { error: aErr } = await admin.from('allowed_emails').upsert(
    logins.map((l) => ({
      email: l.email.toLowerCase(),
      brand_id: brandId(l.brand),
      role: l.role,
      display_name: l.name,
    })),
    { onConflict: 'email' },
  );
  if (aErr) throw aErr;

  const { data: existing, error: lErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (lErr) throw lErr;

  for (const l of logins) {
    const found = existing.users.find((u) => u.email?.toLowerCase() === l.email.toLowerCase());
    if (found) {
      const { error } = await admin.auth.admin.updateUserById(found.id, {
        password: stored[l.email],
      });
      if (error) throw new Error(`${l.email}: ${error.message}`);
      console.log(`updated  ${l.email}`);
    } else {
      const { error } = await admin.auth.admin.createUser({
        email: l.email,
        password: stored[l.email],
        email_confirm: true,
        user_metadata: { display_name: l.name },
      });
      if (error) throw new Error(`${l.email}: ${error.message}`);
      console.log(`created  ${l.email}`);
    }
  }

  const { data: m, error: mErr } = await admin.from('memberships').select('user_id');
  if (mErr) throw mErr;
  console.log(`memberships: ${m.length} (expected 6)`);
  if (m.length !== 6) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
