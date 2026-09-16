'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(200),
});

export type LoginState = { error?: string };

/**
 * Email and password sign-in. Errors are returned as a short message for the form, never the
 * raw Supabase error, and never reveal whether the email exists.
 */
export async function signInWithPassword(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = Credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success)
    return { error: 'Enter a valid email and a password of at least 8 characters.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: 'That email and password do not match a login on this portal.' };
  redirect('/');
}

/** Starts the Google flow. The callback route finishes it. */
export async function signInWithGoogle(): Promise<never> {
  // The Origin header on a server-action POST is set by the browser, not by a proxy, and
  // Supabase only redirects to URLs on its allow-list. x-forwarded-host is never trusted.
  const h = await headers();
  const base = h.get('origin') ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${base}/auth/callback` },
  });
  if (error || !data.url) redirect('/login?error=google-failed');
  redirect(data.url);
}
