import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { serverEnv } from '@/lib/env';
import type { Database } from './database.types';

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Allowed only where a user-scoped client cannot work, and every call site must say why in a
 * comment next to the call:
 *   - scripts/ (import CLI, user seeding): no user session exists
 *   - the /share route handler: the viewer has no login; the brand is resolved from a token the
 *     handler has already verified, never from a request parameter
 * Edge Functions run in Deno and carry their own client; they do not import this file.
 */
export function createAdminClient() {
  const env = serverEnv();
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
