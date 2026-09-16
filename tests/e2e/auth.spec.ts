import { expect, test } from '@playwright/test';
import { loginFor, signIn } from './helpers';

test('signed-out visitors are sent to /login from every portal route', async ({ page }) => {
  for (const path of ['/', '/contacts', '/campaigns', '/imports']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }
});

test('a wrong password shows one message and reveals nothing about the email', async ({ page }) => {
  const owner = loginFor('KAROO', 'owner');
  await page.goto('/login');
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Password').fill('definitely-not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Next adds its own role=alert route announcer; target the form's message.
  await expect(page.locator('p[role="alert"]')).toContainText('do not match a login');
  await expect(page).toHaveURL(/\/login$/);
});

test('each login lands in its own brand and only that brand', async ({ page }) => {
  for (const [brand, name] of [
    ['KILELE', 'Kilele Rides'],
    ['KAROO', 'Karoo Coaches'],
    ['MARRAKECH', 'Marrakech Express'],
  ] as const) {
    await signIn(page, loginFor(brand, 'analyst'));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
    for (const other of ['Kilele Rides', 'Karoo Coaches', 'Marrakech Express'].filter(
      (n) => n !== name,
    )) {
      await expect(page.getByText(other)).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
  }
});

test('the role badge shows owner or analyst from the membership, not the UI', async ({ page }) => {
  await signIn(page, loginFor('MARRAKECH', 'owner'));
  await expect(page.getByText('owner', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page, loginFor('MARRAKECH', 'analyst'));
  await expect(page.getByText('analyst', { exact: true })).toBeVisible();
});
