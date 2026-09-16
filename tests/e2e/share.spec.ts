import { expect, test } from '@playwright/test';
import { loginFor, signIn } from './helpers';

/**
 * The shared results link end to end: an owner creates it, a browser with no session opens it
 * with the password, a wrong password is refused, and a revoked link is gone.
 */

test('a garbage share token is a 404, not a page', async ({ page }) => {
  const res = await page.goto('/share/not-a-token');
  expect(res?.status()).toBe(404);
});

test('owner publishes; a stranger needs the password; revoke closes it', async ({
  page,
  browser,
}, testInfo) => {
  await signIn(page, loginFor('KAROO', 'owner'));
  await page.goto('/campaigns');
  // Each Playwright project takes its own campaign so parallel workers never revoke each other's link.
  const nth = testInfo.project.name === 'mobile' ? 1 : 0;
  await page.getByRole('link', { name: 'Send', exact: true }).nth(nth).click();
  await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}\/send$/);
  const sendUrl = page.url();

  await page.getByLabel('Password for the link').fill('grader-password-1');
  await page.getByRole('button', { name: 'Create shareable results link' }).click();
  const shown = page.locator('p.font-mono.break-all');
  await expect(shown).toBeVisible();
  const url = (await shown.innerText()).trim();
  expect(url).toMatch(/\/share\/[0-9a-f]{64}$/);
  const path = new URL(url).pathname;

  // A fresh context: no portal session, no cookies.
  const stranger = await browser.newContext();
  const s = await stranger.newPage();
  const res = await s.goto(path);
  expect(res?.headers()['x-robots-tag']).toContain('noindex');
  await expect(s.getByRole('heading', { name: 'Shared results' })).toBeVisible();

  await s.getByLabel('Password').fill('wrong-password-xx');
  await s.getByRole('button', { name: 'Open results' }).click();
  await expect(s.locator('form').getByRole('alert')).toContainText('not right');

  await s.getByLabel('Password').fill('grader-password-1');
  await s.getByRole('button', { name: 'Open results' }).click();
  await expect(s.getByText('Shared read-only view')).toBeVisible();
  await expect(s.locator('p', { hasText: /^Sent from this portal/ })).toBeVisible();
  await expect(s.locator('p', { hasText: /^Engagement log/ })).toBeVisible();
  // Nothing on the page is a person.
  await expect(s.getByText(/@/)).toHaveCount(0);

  // Reloading keeps it open through the cookie, without the password.
  await s.reload();
  await expect(s.getByText('Shared read-only view')).toBeVisible();

  // The owner revokes it.
  await page.goto(sendUrl);
  // The newest link is ours; wait for that row, not any older revoked row, to change state.
  const newest = page.locator('tbody tr').first();
  await newest.getByRole('button', { name: 'Revoke' }).click();
  await expect(newest.getByText('revoked')).toBeVisible();

  await s.reload();
  await expect(s.getByRole('heading', { name: 'This link is no longer available' })).toBeVisible();
  await stranger.close();
});
