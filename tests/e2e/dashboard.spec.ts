import { expect, test } from '@playwright/test';
import { loginFor, signIn } from './helpers';

/**
 * The dashboard against the real seed. Every headline number carries a footnote; the four counts
 * add up on screen; the chart says so honestly when the window is empty.
 */

function num(text: string): number {
  return Number(text.replace(/[^\d]/g, ''));
}

test('four numbers with footnotes that add up, for the big brand', async ({ page }) => {
  await signIn(page, loginFor('KILELE', 'analyst'));
  const tiles = page.locator('section').first().locator('p.font-mono');
  await expect(tiles).toHaveCount(4);
  const [total, contactable, notContactable, deleted] = await tiles.allInnerTexts();
  expect(num(total)).toBeGreaterThan(80000);
  expect(num(contactable) + num(notContactable)).toBe(num(total));
  expect(num(deleted)).toBeGreaterThan(0);
  await expect(page.getByText(/Contactable means status active, consent given/)).toBeVisible();
  await expect(page.getByText(/whose deleted-at is empty/)).toBeVisible();
  await expect(page.getByRole('img', { name: /Signups per day/ })).toBeVisible();
  await expect(page.getByText('Reported by brand')).toBeVisible();
  await expect(page.getByText('Observed in event log')).toBeVisible();
  await expect(page.locator('section').last().locator('tbody tr')).toHaveCount(44);
});

test('an empty 30-day window says so instead of drawing nothing', async ({ page }) => {
  await signIn(page, loginFor('MARRAKECH', 'owner'));
  await expect(page.getByText(/No signups between/)).toBeVisible();
  await expect(page.getByText(/Thirty days, all zero/)).toBeVisible();
  await expect(page.locator('section').last().locator('tbody tr')).toHaveCount(6);
});

test('reported and observed columns are both present and observed never exceeds contacts', async ({
  page,
}) => {
  await signIn(page, loginFor('KAROO', 'analyst'));
  const rows = page.locator('section').last().locator('tbody tr');
  await expect(rows).toHaveCount(19);
  const cells = await rows.first().locator('td').allInnerTexts();
  // columns: campaign, sent at, R sent, R delivered, R bounced, R opens, R clicks,
  // O with events, O opened, O clicked, O bounced, O complained, O unsub
  expect(cells).toHaveLength(13);
  expect(num(cells[8])).toBeLessThanOrEqual(num(cells[7]));
});
