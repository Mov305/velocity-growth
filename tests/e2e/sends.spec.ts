import { expect, test } from '@playwright/test';
import { loginFor, signIn } from './helpers';

/**
 * The approve half of the send flow through the UI. Confirming would call the live provider, so
 * that path is exercised by the Vitest suite against a mock and by the recorded live run in the
 * README, not on every test run.
 */

test('an analyst can see the audience but cannot approve', async ({ page }) => {
  await signIn(page, loginFor('MARRAKECH', 'analyst'));
  await page.goto('/campaigns');
  await page.getByRole('link', { name: 'Audience', exact: true }).first().click();
  await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}\/send$/);
  await expect(page.getByText('contactable customers, counted now')).toBeVisible();
  await expect(page.getByText('Only an owner can approve a send')).toBeVisible();
  await expect(page.getByRole('button', { name: /Approve audience/ })).toHaveCount(0);
});

test('an owner approves an audience and lands on a send with a frozen count', async ({ page }) => {
  await signIn(page, loginFor('MARRAKECH', 'owner'));
  await page.goto('/campaigns');
  await page.getByRole('link', { name: 'Send', exact: true }).first().click();
  const button = page.getByRole('button', { name: /Approve audience of/ });
  await expect(button).toBeVisible();
  const label = await button.innerText();
  const count = Number(label.replace(/[^\d]/g, ''));
  expect(count).toBeGreaterThan(0);
  await button.click();
  await expect(page).toHaveURL(/\/sends\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Approved, not sent')).toBeVisible();
  await expect(page.locator('section').first().locator('p.font-mono').first()).toHaveText(
    count.toLocaleString('en-GB'),
  );
  await expect(
    page.getByRole('button', { name: `Confirm send to ${count.toLocaleString('en-GB')}` }),
  ).toBeVisible();
  await expect(page.getByText('equals the approved audience')).toBeVisible();
});

test('the sends list shows the approved send and an analyst sees no confirm button on it', async ({
  page,
}) => {
  await signIn(page, loginFor('MARRAKECH', 'analyst'));
  await page.goto('/sends');
  await expect(page.getByRole('heading', { level: 2 })).toContainText(/sends/);
  await page.locator('tbody tr a').first().click();
  await expect(page).toHaveURL(/\/sends\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('button', { name: /Confirm send/ })).toHaveCount(0);
  await expect(page.getByText('Only an owner can confirm this send')).toBeVisible();
});
