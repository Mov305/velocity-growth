import { expect, test } from '@playwright/test';

/** The scheduler's route: reachable without a session, refused without the secret. */
test('POST /api/poll without the secret is 403, not a redirect to login', async ({ request }) => {
  const res = await request.post('/api/poll', { maxRedirects: 0 });
  expect(res.status()).toBe(403);
  expect(await res.json()).toEqual({ error: 'forbidden' });
});

test('POST /api/poll with a wrong secret is 403', async ({ request }) => {
  const res = await request.post('/api/poll', {
    headers: { 'x-poll-secret': 'definitely-not-the-secret-value' },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(403);
});
