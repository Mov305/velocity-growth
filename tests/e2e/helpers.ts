import { config } from 'dotenv';
import { type Page, expect } from '@playwright/test';

config({ path: '.env.test', quiet: true });

export type Login = { email: string; brand: string; role: 'owner' | 'analyst'; name: string };

export function logins(): Login[] {
  const raw = process.env.SEED_LOGINS;
  if (!raw) throw new Error('SEED_LOGINS missing from .env.test');
  return JSON.parse(raw) as Login[];
}

export function passwordFor(email: string): string {
  const raw = process.env.SEED_PASSWORDS_JSON;
  if (!raw) throw new Error('SEED_PASSWORDS_JSON missing from .env.test; run pnpm seed:users');
  const map = JSON.parse(raw) as Record<string, string>;
  const p = map[email];
  if (!p) throw new Error(`no password for ${email}`);
  return p;
}

export function loginFor(brand: string, role: 'owner' | 'analyst'): Login {
  const l = logins().find((x) => x.brand === brand && x.role === role);
  if (!l) throw new Error(`no ${role} login for ${brand}`);
  return l;
}

export async function signIn(page: Page, login: Login) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(login.email);
  await page.getByLabel('Password').fill(passwordFor(login.email));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/');
}
