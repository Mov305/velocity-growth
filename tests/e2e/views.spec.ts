import { expect, test } from '@playwright/test';
import { loginFor, signIn } from './helpers';

/** "82,509 contacts¹" -> 82509. The footnote marker sits inside the heading, so never strip digits blindly. */
function headingCount(text: string): number {
  const m = /^([\d,]+)\s/.exec(text.trim());
  if (!m) throw new Error(`heading has no leading count: ${text}`);
  return Number(m[1].replace(/,/g, ''));
}

/**
 * The views against real seed volume. Kilele has 82k contacts; the list must paginate with a
 * true total. Marrakech's events import refused 633 rows; the imports view must show them.
 */

test('contacts paginate with a real total and a footnote saying what is counted', async ({
  page,
}) => {
  await signIn(page, loginFor('KILELE', 'analyst'));
  await page.goto('/contacts');
  const heading = page.getByRole('heading', { level: 2 });
  await expect(heading).toContainText(/contacts/);
  const total = headingCount(await heading.innerText());
  expect(total).toBeGreaterThan(1000);
  await expect(page.getByText('Showing 1–50 of')).toBeVisible();
  await expect(page.getByText(/including contacts marked deleted/)).toBeVisible();

  // The pagination control renders an anchor with a button role (base-ui Button + Link).
  await page.locator('a', { hasText: 'Next' }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByText('Showing 51–100 of')).toBeVisible();
});

test('contacts search narrows by id and the count follows', async ({ page }) => {
  await signIn(page, loginFor('KAROO', 'owner'));
  await page.goto('/contacts?q=CT-0057');
  const heading = page.getByRole('heading', { level: 2 });
  const total = headingCount(await heading.innerText());
  expect(total).toBeGreaterThan(0);
  expect(total).toBeLessThan(200);
  const ids = await page.locator('tbody tr td:first-child').allInnerTexts();
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) expect(id).toContain('CT-0057');
});

test('ILIKE wildcards in the search box are literal characters, not patterns', async ({ page }) => {
  await signIn(page, loginFor('KAROO', 'analyst'));
  await page.goto('/contacts?q=_');
  await expect(page.getByRole('heading', { level: 2 })).toContainText('0 contacts');
  await page.goto('/contacts?q=%25');
  await expect(page.getByRole('heading', { level: 2 })).toContainText('0 contacts');
});

test('a page number past the end is an empty page with the same real total, not an error', async ({
  page,
}) => {
  await signIn(page, loginFor('MARRAKECH', 'analyst'));
  await page.goto('/contacts?page=999');
  await expect(page.getByRole('heading', { level: 2 })).toContainText(/contacts/);
  await expect(page.getByText('Showing 0–0 of 918')).toBeVisible();
  await expect(page.getByText('Nothing on this page')).toBeVisible();
});

test('imports list every load and the detail shows refused rows with reasons', async ({ page }) => {
  await signIn(page, loginFor('MARRAKECH', 'owner'));
  await page.goto('/imports');
  await expect(page.getByRole('heading', { level: 2 })).toContainText(/file loads/);
  const eventsRow = page.locator('tbody tr', { hasText: 'marrakech-events.csv' }).first();
  await expect(eventsRow).toBeVisible();
  await eventsRow.getByRole('link', { name: '633' }).click();
  await expect(page).toHaveURL(/\/imports\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('marrakech-events.csv');
  await expect(page.getByText(/Every one of the 940 rows read is accounted for/)).toBeVisible();
  await expect(page.getByText('unknown campaign …')).toBeVisible();
  await expect(
    page.locator('tbody tr td', { hasText: /unknown campaign MAR-00/ }).first(),
  ).toBeVisible();
});

test('an import id from another brand is not found, not shown', async ({ page, request }) => {
  // Find a Kilele import id with the Kilele analyst, then try to open it as Karoo.
  await signIn(page, loginFor('KILELE', 'analyst'));
  await page.goto('/imports');
  const href = await page.locator('tbody tr a[href^="/imports/"]').first().getAttribute('href');
  expect(href).toBeTruthy();
  await page.getByRole('button', { name: 'Sign out' }).click();

  await signIn(page, loginFor('KAROO', 'analyst'));
  await page.goto(href!);
  // The portal layout streams before the page decides, so the HTTP status is not the signal;
  // the rendered content is. Nothing of the Kilele import may appear.
  await expect(page.getByText('Not found in this brand')).toBeVisible();
  await expect(page.getByText(/kilele-/)).toHaveCount(0);
  await expect(page.getByText(/rows read is accounted for/)).toHaveCount(0);
  void request;
});

test('the campaigns list labels its figures as reported by the brand', async ({ page }) => {
  await signIn(page, loginFor('KILELE', 'owner'));
  await page.goto('/campaigns');
  await expect(page.getByRole('heading', { level: 2 })).toContainText('44 campaigns');
  await expect(page.getByText(/as reported in the brand/)).toBeVisible();
  await expect(page.locator('tbody tr', { hasText: 'KIL-0044' })).toHaveCount(1);
});
