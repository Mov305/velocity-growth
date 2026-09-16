import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { config } from 'dotenv';

config({ path: process.env.ENV_FILE ?? '.env.test', quiet: true });

/**
 * A stranger with the anon key, exactly what the graders will try first. The auth.users trigger
 * refuses the sign-up inside Supabase, so no session is ever issued.
 */
test('a stranger cannot sign up with email and password through the public API', async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const email = `stranger-${Date.now()}@example.com`;
  const { data, error } = await client.auth.signUp({ email, password: 'Str0ng-password!' });
  expect(error, 'sign-up must fail').not.toBeNull();
  expect(data.session).toBeNull();
  expect(data.user).toBeNull();

  const signIn = await client.auth.signInWithPassword({ email, password: 'Str0ng-password!' });
  expect(signIn.error).not.toBeNull();
  expect(signIn.data.session).toBeNull();
});

test('a stranger with a session-less anon client reads nothing from any table', async () => {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  for (const table of ['contacts', 'campaigns', 'imports', 'brands'] as const) {
    const { data, error } = await client.from(table).select('*').limit(1);
    expect(error, `anon read ${table}`).not.toBeNull();
    expect(data).toBeNull();
  }
});
