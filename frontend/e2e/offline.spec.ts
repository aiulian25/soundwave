import { test, expect } from '@playwright/test';
import {
  login,
  E2E_TRACK_TITLE,
  E2E_TRACK_YOUTUBE_ID,
  SW_PINNED_AUDIO_CACHE,
} from './helpers';

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
  await page.waitForTimeout(3000); // let the SW finish caching the media

  await context.setOffline(true);

  const playableOffline = await page.evaluate(async () => {
    const el = document.querySelector('audio') as HTMLAudioElement | null;
    if (!el) return false;
    el.currentTime = 0;
    try {
      await el.play();
    } catch {
      /* autoplay handled by the launch flag */
    }
    await new Promise((r) => setTimeout(r, 1500));
    // Served from cache offline: not paused and the element has decodable data buffered
    // (readyState >= HAVE_CURRENT_DATA) — more robust than a raw currentTime threshold.
    return !el.paused && el.readyState >= 2;
  });

  expect(playableOffline).toBe(true);
  await context.setOffline(false);
});

// Guard for the PINNED offline path (separate keying from casual /media/ streaming):
// "Make available offline" caches /api/audio/<id>/download/ in the pinned audio cache.
// The service worker must then serve that download — with HTTP range support, as an
// <audio> element requests — while offline. This is exactly the path the Player read-path
// rewrite (Steps 2-4) will lean on, so it must stay green independently of the casual
// /media/ path. We drive the SW + an <audio> element directly to avoid the Player's
// in-memory cache-index mount-timing race (the index is not observable from the test).
test('a "made available offline" download is served to <audio> while offline', async ({
  page,
  context,
}) => {
  await login(page);
  await page.goto('/library');
  await expect(page.getByText(E2E_TRACK_TITLE).first()).toBeVisible({ timeout: 20_000 });

  const downloadUrl = `/api/audio/${E2E_TRACK_YOUTUBE_ID}/download/`;

  // Pin it exactly like the feature does: cache the credentialed, same-origin /download/
  // response in the SW's pinned audio cache. We never stream /media/, so the only cached
  // copy is this pinned entry.
  const pinned = await page.evaluate(
    async ([url, cacheName]) => {
      if (!('caches' in window)) return false;
      const cache = await caches.open(cacheName);
      try {
        await cache.add(url); // same-origin GET sends the session cookie
      } catch {
        return false;
      }
      return !!(await cache.match(url));
    },
    [downloadUrl, SW_PINNED_AUDIO_CACHE] as const,
  );
  expect(pinned).toBe(true);

  await context.setOffline(true);

  // Offline, an <audio> element pointed at the pinned download must play: the SW serves
  // the cached bytes (handleRangeRequest answers the element's Range request).
  const playableOffline = await page.evaluate(async (url) => {
    const el = document.createElement('audio');
    el.src = url;
    el.muted = true;
    document.body.appendChild(el);
    try {
      await el.play();
    } catch {
      /* autoplay handled by the launch flag */
    }
    await new Promise((r) => setTimeout(r, 1500));
    const ok = !el.paused && el.readyState >= 2;
    el.remove();
    return ok;
  }, downloadUrl);

  expect(playableOffline).toBe(true);
  await context.setOffline(false);
});
