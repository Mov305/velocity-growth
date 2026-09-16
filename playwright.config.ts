import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end flows against the local Supabase stack. Needs .env.test (pnpm env:local) and the
 * six seed users (pnpm seed:users). The dev server is started here with .env.test so the app and
 * the tests talk to the same database.
 *
 * Against a deployment: E2E_BASE_URL=https://... ENV_FILE=.env.production pnpm test:e2e
 * (no dev server is started; the logins come from that env file).
 */
const remote = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    baseURL: remote ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: remote
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://localhost:3000/login',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
