import { describe, expect, it } from 'vitest';
import { adminClient } from './fixtures';

/**
 * Who may log in is decided by a trigger on auth.users. These tests use the admin API, which is the
 * most privileged path there is: if a stranger cannot be created here, Google sign-in cannot create
 * one either.
 */
const admin = adminClient();

describe('auth gate: only allowed_emails can exist in auth.users', () => {
  it('refuses a stranger even through the admin API', async () => {
    const email = `stranger-${Date.now()}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: 'Str0ng-password!',
      email_confirm: true,
    });
    expect(error, 'stranger was created').not.toBeNull();
    expect(data.user).toBeNull();
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    expect(list?.users.some((u) => u.email === email)).toBe(false);
  });

  it('every allowed email has a user, and every user is an allowed email', async () => {
    const { data: list, error: lErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (lErr) throw lErr;
    const { data: allowed, error: aErr } = await admin.from('allowed_emails').select('email');
    if (aErr) throw aErr;
    const users = list.users.map((u) => u.email?.toLowerCase()).sort();
    const allowedEmails = allowed.map((a) => a.email).sort();
    expect(allowedEmails).toHaveLength(6);
    expect(users).toEqual(allowedEmails);
  });

  it('every auth user has exactly one membership matching allowed_emails', async () => {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const { data: memberships } = await admin.from('memberships').select('user_id, brand_id, role');
    const { data: allowed } = await admin.from('allowed_emails').select('email, brand_id, role');
    for (const u of list!.users) {
      const a = allowed!.find((x) => x.email === u.email?.toLowerCase());
      expect(a, `${u.email} is not in allowed_emails`).toBeDefined();
      const m = memberships!.filter((x) => x.user_id === u.id);
      expect(m).toEqual([{ user_id: u.id, brand_id: a!.brand_id, role: a!.role }]);
    }
  });
});
