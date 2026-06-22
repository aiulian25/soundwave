import { defineConfig, devices } from '@playwright/test';

// The app under test (the built PWA served by the prod stack). Override in CI.
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:8889';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Touch enabled for the pull-to-refresh gesture; autoplay so the audio element can
    // start without a synthetic user-gesture per click.
    hasTouch: true,
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], hasTouch: true, viewport: { width: 1280, height: 900 } },
    },
  ],
});
