import 'server-only';

import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';

export type Role = 'owner' | 'analyst';

export type Membership = {
  userId: string;
  email: string;
  brandId: string;
  brandCode: string;
  brandName: string;
  role: Role;
};

/**
 * The caller's brand and role, from their membership row and nothing else. Never from a URL,
 * cookie or form field. Cached per request so the layout and pages share one lookup.
 *
 * Returns null when there is no user or the user has no membership. Throws when the database
 * itself fails: a failed read must never look like "no access".
 */
export const getMembership = cache(async (): Promise<Membership | null> => {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  // No session is a normal state. Any other auth failure must surface, never read as no access.
  if (userError && userError.name !== 'AuthSessionMissingError') {
    throw new Error(`auth check failed: ${userError.message}`);
  }
  if (!user) return null;

  const { data, error } = await supabase
    .from('memberships')
    .select('brand_id, role, brands ( code, name )')
    .eq('user_id', user.id)
    .limit(2);
  if (error) throw new Error(`membership lookup failed: ${error.message}`);
  if (!data || data.length === 0) return null;
  if (data.length > 1)
    throw new Error('user belongs to more than one brand; the portal assumes one');

  const m = data[0];
  const brand = Array.isArray(m.brands) ? m.brands[0] : m.brands;
  if (!brand) throw new Error('membership without brand row');
  return {
    userId: user.id,
    email: user.email ?? '',
    brandId: m.brand_id,
    brandCode: brand.code,
    brandName: brand.name,
    role: m.role,
  };
});
