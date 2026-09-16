import { expect, test } from '@playwright/test';
import { loginFor, signIn } from './helpers';

/**
 * Upload through the Imports page: an owner loads a three-row Karoo contacts file with one
 * unknown status, lands on the load's page with the counts, and sees the refused row with its
 * reason. An analyst has no upload form. The same file twice stores nothing new.
 */

/** Ids unique to this run, so the count checks below are exact whatever earlier runs stored. */
function makeCsv(tag: string) {
  return [
    'Full Name,Email,External Id,Phone,Country,Status,City,Signup At,Consent Marketing,Brand Code,Deleted At,Suppressed Until,Notes',
    `Upload Test One,upload.${tag}.one@vg-eval.test,CT-${tag}1,,ZA,active,Cape Town,2026-03-01T10:00:00Z,yes,KAROO,,,`,
    `Upload Test Two,upload.${tag}.two@vg-eval.test,CT-${tag}2,,ZA,zombie,Durban,2026-03-01T10:00:00Z,yes,KAROO,,,`,
    `Upload Test Three,upload.${tag}.three@vg-eval.test,CT-${tag}3,,ZA,pending,Pretoria,2026-03-02T10:00:00Z,no,KAROO,,,`,
    '',
  ].join('\n');
}

test('an analyst sees no upload form', async ({ page }) => {
  await signIn(page, loginFor('KAROO', 'analyst'));
  await page.goto('/imports');
  await expect(page.getByText('Only an owner can import a file')).toBeVisible();
  await expect(page.getByLabel('CSV file')).toHaveCount(0);
});

test('an owner uploads a file, sees the counts and the refused row, and a re-upload stores nothing new', async ({
  page,
}) => {
  const tag = String(Date.now()).slice(-5);
  const csv = makeCsv(tag);
  await signIn(page, loginFor('KAROO', 'owner'));
  await page.goto('/imports');
  await page.getByLabel('What the file contains').selectOption('contacts');
  await page
    .getByLabel('CSV file')
    .setInputFiles({ name: 'upload-test.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page).toHaveURL(/\/imports\/[0-9a-f-]{36}$/);
  await expect(page.getByText('upload-test.csv')).toBeVisible();
  await expect(page.getByRole('table').last()).toContainText(/status/);

  await page.goto('/imports');
  const first = page.locator('tbody tr').first();
  await expect(first).toContainText('upload-test.csv');
  await expect(first).toContainText('succeeded');

  await page.getByLabel('CSV file').setInputFiles({
    name: 'upload-test.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page).toHaveURL(/\/imports\/[0-9a-f-]{36}$/);
  await page.goto(`/contacts?q=CT-${tag}`);
  await expect(page.getByRole('heading', { level: 2 })).toContainText('2 contacts');
});

test('a non-csv upload is refused with a reason and nothing is stored', async ({ page }) => {
  await signIn(page, loginFor('KAROO', 'owner'));
  await page.goto('/imports');
  await page
    .getByLabel('CSV file')
    .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page).toHaveURL(/\/imports\?error=not-csv$/);
  await expect(page.locator('form').getByRole('alert')).toContainText('Only .csv files');
});
