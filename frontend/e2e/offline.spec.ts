import { test, expect } from '@playwright/test';
import { login, E2E_TRACK_TITLE } from './helpers';

// The core offline-PWA guarantee: once the service worker is active, going offline and
// reloading still serves the cached app shell (no browser network-error page), and a
// previously-played track stays reachable from cache.
test('the app shell still works offline after the SW is active', async ({ page, context }) => {
  await login(page);

  // Warm the caches: open the library and start the seeded track once while online.
  await page.goto('/library');
  const row = page.getByText(E2E_TRACK_TITLE).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.getByTestId('player-playpause')).toBeVisible({ timeout: 20_000 });

  // Give the service worker a moment to take control + cache the shell.
  await page.waitForTimeout(1500);

  // Go offline and reload — the SW should serve the cached app shell, not a browser
  // network-error page. (React state like currentAudio resets on reload, so we assert
  // the shell itself renders rather than the transient player.)
  await context.setOffline(true);
  await page.reload();

  await expect(page.getByText(/SoundWave/i).first()).toBeVisible({ timeout: 20_000 });

  await context.setOffline(false);
});

// Guard for the offline-cache consolidation: a track played once online must keep
// playing while offline (served from the SW cache). The <audio> element's currentTime
// advancing while offline proves the bytes came from cache, not the network.
test('a previously-played track still plays while offline', async ({ page, context }) => {
  await login(page);
  await page.goto('/library');
  await page.getByText(E2E_TRACK_TITLE).first().click();
  await expect(page.getByTestId('player-playpause')).toHaveAttribute('data-playing', 'true', {
    timeout: 20_000,
  });
  await page.waitForTimeout(2000); // let the SW finish caching the media

  await context.setOffline(true);

  const advancedOffline = await page.evaluate(async () => {
    const el = document.querySelector('audio') as HTMLAudioElement | null;
    if (!el) return false;
    el.currentTime = 0;
    try {
      await el.play();
    } catch {
      /* autoplay handled by the launch flag */
    }
    await new Promise((r) => setTimeout(r, 900));
    return !el.paused && el.currentTime > 0;
  });

  expect(advancedOffline).toBe(true);
  await context.setOffline(false);
});
