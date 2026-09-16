import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** POST only: a GET that signs you out is a link someone can send you. */
export async function POST(request: NextRequest) {
  // A cross-site form post carries a foreign Origin (or none). Refuse it rather than rely on
  // cookie SameSite defaults alone.
  const origin = request.headers.get('origin');
  const self = new URL(request.url).origin;
  if (origin && origin !== self) return new NextResponse('forbidden', { status: 403 });
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', new URL(request.url).origin), { status: 303 });
}
