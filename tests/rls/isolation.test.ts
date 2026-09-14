import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TENANT_TABLES, adminClient, cleanFixtures, seedFixtures, type BrandRow } from './fixtures';
import { rlsEnv, seedLogins, seedPasswords } from './setup';

/**
 * Signs in as each of the six users with the anon key, exactly as the graders will, and asserts
 * that every table shows only that user's brand, shows all of it, and refuses direct writes.
 */

type Session = {
  email: string;
  brandCode: string;
  brandId: string;
  role: string;
  client: SupabaseClient;
};

const admin = adminClient();
let brands: BrandRow[] = [];
let sessions: Session[] = [];

beforeAll(async () => {
  const logins = seedLogins();
  const passwords = seedPasswords();
  const { data: users, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;

  const ownerUserIdByBrand: Record<string, string> = {};
  for (const l of logins.filter((l) => l.role === 'owner')) {
    const u = users.users.find((u) => u.email?.toLowerCase() === l.email.toLowerCase());
    if (!u) throw new Error(`seed user ${l.email} missing. Run pnpm seed:users`);
    ownerUserIdByBrand[l.brand] = u.id;
  }
  const seeded = await seedFixtures(admin, ownerUserIdByBrand);
  brands = seeded.brands;

  sessions = [];
  for (const l of logins) {
    const client = createClient(rlsEnv.url, rlsEnv.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await client.auth.signInWithPassword({
      email: l.email,
      password: passwords[l.email],
    });
    if (signInError) throw new Error(`sign in ${l.email}: ${signInError.message}`);
    const brand = brands.find((b) => b.code === l.brand);
    if (!brand) throw new Error(`brand ${l.brand} not seeded`);
    sessions.push({ email: l.email, brandCode: l.brand, brandId: brand.id, role: l.role, client });
  }
});

afterAll(async () => {
  await cleanFixtures(admin);
});

describe('tenant isolation, as each of the six users', () => {
  it('has six sessions across three brands', () => {
    expect(sessions).toHaveLength(6);
    expect(new Set(sessions.map((s) => s.brandId)).size).toBe(3);
  });

  for (const table of TENANT_TABLES) {
    it(`${table}: a user sees only their own brand, and sees all of it`, async () => {
      for (const s of sessions) {
        // Rows: PostgREST caps a page at max_rows (1000), so never compare fetched lengths.
        // Brand check on a page, count check server-side under the user's own session.
        const page = await s.client.from(table).select('brand_id').limit(1000);
        expect(page.error, `${s.email} select ${table}`).toBeNull();
        const seen = [...new Set((page.data ?? []).map((r: { brand_id: string }) => r.brand_id))];
        expect(seen, `${s.email} saw foreign brand rows in ${table}`).toEqual(
          seen.length ? [s.brandId] : [],
        );

        const visible = await s.client
          .from(table)
          .select('brand_id', { count: 'exact', head: true });
        expect(visible.error, `${s.email} count ${table}`).toBeNull();

        const expected = await admin
          .from(table)
          .select('brand_id', { count: 'exact', head: true })
          .eq('brand_id', s.brandId);
        expect(expected.error).toBeNull();
        expect(expected.count, `fixture missing for ${table}`).toBeGreaterThan(0);
        expect(
          visible.count,
          `${s.email} sees a different number of ${table} rows than exist for their brand`,
        ).toBe(expected.count);
      }
    });

    it(`${table}: filtering by another brand's id returns nothing`, async () => {
      for (const s of sessions) {
        const other = brands.find((b) => b.id !== s.brandId)!;
        const { data, error } = await s.client
          .from(table)
          .select('brand_id')
          .eq('brand_id', other.id);
        expect(error).toBeNull();
        expect(data).toEqual([]);
      }
    });
  }

  it('brands: a user sees only their own brand row', async () => {
    for (const s of sessions) {
      const { data, error } = await s.client.from('brands').select('id');
      expect(error).toBeNull();
      expect(data?.map((b: { id: string }) => b.id)).toEqual([s.brandId]);
    }
  });

  it('memberships: a user sees only their own membership', async () => {
    for (const s of sessions) {
      const { data, error } = await s.client.from('memberships').select('brand_id, role');
      expect(error).toBeNull();
      expect(data).toEqual([{ brand_id: s.brandId, role: s.role }]);
    }
  });

  it('allowed_emails: no user can read it', async () => {
    for (const s of sessions) {
      const { data, error } = await s.client.from('allowed_emails').select('email');
      expect(error, `${s.email} could read allowed_emails`).not.toBeNull();
      expect(data).toBeNull();
    }
  });

  it('direct writes are refused for own brand and another brand, owner or analyst', async () => {
    for (const s of sessions) {
      const other = brands.find((b) => b.id !== s.brandId)!;
      for (const brandId of [s.brandId, other.id]) {
        const ins = await s.client.from('contacts').insert({
          brand_id: brandId,
          external_id: 'CT-999999999',
          status: 'active',
          consent_marketing: false,
        });
        expect(ins.error, `${s.email} inserted into contacts for ${brandId}`).not.toBeNull();
      }
      const upd = await s.client
        .from('contacts')
        .update({ notes: 'tampered' })
        .eq('brand_id', other.id)
        .select('id');
      expect(upd.data ?? []).toEqual([]);
      const del = await s.client.from('contacts').delete().eq('brand_id', other.id).select('id');
      expect(del.data ?? []).toEqual([]);
    }
    const untouched = await admin.from('contacts').select('id').eq('notes', 'tampered');
    expect(untouched.data).toEqual([]);
  });
});

describe('anonymous', () => {
  const anon = createClient(rlsEnv.url, rlsEnv.anonKey, { auth: { persistSession: false } });
  for (const table of [...TENANT_TABLES, 'brands', 'memberships', 'allowed_emails'] as const) {
    it(`${table}: anon gets an error, not an empty list`, async () => {
      const { data, error } = await anon.from(table).select('*').limit(1);
      expect(error, `anon read ${table}`).not.toBeNull();
      expect(data).toBeNull();
    });
  }
});
