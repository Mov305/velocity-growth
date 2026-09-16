import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * OAuth landing. Supabase redirects here with a one-time code; exchanging it sets the session
 * cookie. A stranger's Google sign-in fails inside Supabase (the auth.users trigger refuses the
 * insert) and arrives here with an error instead of a code.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const errorCode = url.searchParams.get('error');

  if (errorCode || !code) {
    // Errors Google itself raises before Supabase sees the user (cancelled, bad request).
    // Anything else on this URL is Supabase refusing to create the user: the auth.users trigger.
    const GOOGLE_SIDE = new Set([
      'access_denied',
      'invalid_request',
      'unauthorized_client',
      'invalid_scope',
      'temporarily_unavailable',
    ]);
    // server_error is what Supabase sends when the auth.users trigger refuses a stranger, and
    // also what Google sends during an outage. The two cannot be told apart without parsing
    // prose, so that case gets a message that is true in both.
    const reason = !errorCode
      ? 'google-failed'
      : GOOGLE_SIDE.has(errorCode)
        ? 'google-failed'
        : errorCode === 'server_error'
          ? 'not-completed'
          : 'not-allowed';
    return NextResponse.redirect(new URL(`/login?error=${reason}`, url.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL('/login?error=google-failed', url.origin));
  }
  return NextResponse.redirect(new URL('/', url.origin));
}
