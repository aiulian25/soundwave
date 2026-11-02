import { Page, expect } from '@playwright/test';

// Credentials must match the backend `seed_e2e` management command (same env defaults).
export const E2E_USERNAME = process.env.E2E_USERNAME || 'e2e_user';
export const E2E_PASSWORD = process.env.E2E_PASSWORD || 'E2e-Test_2026!';
export const E2E_SECOND_USERNAME = process.env.E2E_SECOND_USERNAME || 'e2e_user_two';
export const E2E_TRACK_TITLE = 'E2E Sample Track';
export const E2E_TRACK_YOUTUBE_ID = 'e2e-sample-0001';
// Must match AUDIO_CACHE_NAME in public/service-worker.js — the pinned ("Make available
// offline") download cache.
export const SW_PINNED_AUDIO_CACHE = 'soundwave-audio-v3';

/** Log in with the seeded test user and wait for the app shell. */
export async function login(page: Page, username: string = E2E_USERNAME): Promise<void> {
  // Tests share an account, so one test's playback can make the app offer it back in the next.
  await page.addLocatorHandler(page.getByRole('dialog', { name: 'Continue Listening?' }), async (dialog) => {
    await dialog.getByRole('button', { name: 'Not Now' }).click();
  });
  await page.goto('/');
  await page.getByTestId('login-username').fill(username);
  await page.getByTestId('login-password').fill(E2E_PASSWORD);
  await page.getByTestId('login-submit').click();
  // Login replaces the auth screen with the app — the login form should disappear.
  await expect(page.getByTestId('login-submit')).toBeHidden({ timeout: 20_000 });
}
