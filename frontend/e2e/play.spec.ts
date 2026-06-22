import { test, expect } from '@playwright/test';
import { login, E2E_TRACK_TITLE } from './helpers';

test('playing the seeded track starts playback', async ({ page }) => {
  await login(page);

  // Go to the Library and start the seeded track.
  await page.goto('/library');
  const row = page.getByText(E2E_TRACK_TITLE).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();

  // The player's play/pause control reflects the playing state via data-playing.
  const playPause = page.getByTestId('player-playpause');
  await expect(playPause).toBeVisible({ timeout: 20_000 });
  await expect(playPause).toHaveAttribute('data-playing', 'true', { timeout: 20_000 });
});
