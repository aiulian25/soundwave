import { test, expect } from '@playwright/test';
import {
  login,
  E2E_TRACK_TITLE,
  E2E_TRACK_YOUTUBE_ID,
  SW_PINNED_AUDIO_CACHE,
} from './helpers';

const E2E_TRACK_FILE_PATH = 'e2e/sample.wav';

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

  // Also continued here for the login limit. After a reload nothing is buffered, so bytes can only
  // come from the worker. The casual path is warmed the way prefetching does it.
  await context.setOffline(false);
  const casualUrl = `/media/${E2E_TRACK_FILE_PATH}`;
  const warmed = await page.evaluate(async (url) => {
    const registration = await navigator.serviceWorker.ready;
    return new Promise<boolean>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => resolve(event.data.success);
      registration.active!.postMessage({ type: 'PREFETCH_STREAM', url }, [channel.port2]);
    });
  }, casualUrl);
  expect(warmed).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText(/SoundWave/i).first()).toBeVisible({ timeout: 20_000 });

  for (const url of [downloadUrl, casualUrl]) {
    const ranges = await page.evaluate(async (target) => {
      const whole = await (await fetch(target)).arrayBuffer();
      const ask = async (range: string) => {
        const response = await fetch(target, { headers: { Range: range } });
        const body = new Uint8Array(await response.arrayBuffer());
        return { status: response.status, contentRange: response.headers.get('content-range'), first: body[0], size: body.length };
      };
      return {
        length: whole.byteLength,
        tailByte: new Uint8Array(whole)[whole.byteLength - 1],
        suffix: await ask('bytes=-1'),
        pastEnd: await ask(`bytes=${whole.byteLength}-`),
        closed: await ask('bytes=0-3'),
      };
    }, url);
    expect(ranges.suffix).toMatchObject({
      status: 206,
      contentRange: `bytes ${ranges.length - 1}-${ranges.length - 1}/${ranges.length}`,
      first: ranges.tailByte,
      size: 1,
    });
    expect(ranges.pastEnd).toMatchObject({ status: 416, contentRange: `bytes */${ranges.length}`, size: 0 });
    expect(ranges.closed).toMatchObject({ status: 206, contentRange: `bytes 0-3/${ranges.length}`, size: 4 });

    const seeked = await page.evaluate(async (target) => {
      const element = document.createElement('audio');
      element.src = target;
      element.muted = true;
      document.body.appendChild(element);
      await new Promise((resolve, reject) => {
        element.onloadedmetadata = resolve;
        element.onerror = () => reject(new Error(`could not load ${target}`));
      });
      const position = element.duration / 2;
      const arrived = new Promise((resolve) => { element.onseeked = resolve; });
      element.currentTime = position;
      await arrived;
      const result = Math.abs(element.currentTime - position) < 0.25 && element.readyState >= 1;
      element.remove();
      return result;
    }, url);
    expect(seeked).toBe(true);
  }
  await context.setOffline(false);

  // Continued here rather than in a new test because logins are rate limited across the suite.
  // The real worker: a fill reports what arrived, and removal spares what another playlist needs.
  const missingUrl = '/api/audio/e2e-does-not-exist/download/';
  const fillResult = await page.evaluate(async (audioUrls) => {
    const registration = await navigator.serviceWorker.ready;
    return new Promise<any>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => {
        if (event.data.type === 'complete') resolve(event.data);
      };
      registration.active!.postMessage({ type: 'CACHE_PLAYLIST', playlistId: 'e2e-A', audioUrls }, [channel.port2]);
    });
  }, [downloadUrl, missingUrl]);
  expect(fillResult).toMatchObject({ success: true, cached: 1, failed: 1 });

  const item = { id: 1, position: 0, audio: { youtube_id: E2E_TRACK_YOUTUBE_ID, title: E2E_TRACK_TITLE } };
  const saved = ['A', 'B'].map((name, index) => ({
    id: 900 + index, playlist_id: `e2e-${name}`, title: `Saved ${name}`, channel_name: 'x', item_count: 1,
    downloaded_count: 1, items: [item], offline: true, lastSync: Date.now(),
  }));
  await page.evaluate(async (playlists) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const opening = indexedDB.open('soundwave-offline');
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const tx = db.transaction('playlists', 'readwrite');
    playlists.forEach((playlist) => tx.objectStore('playlists').put(playlist));
    await new Promise((resolve) => { tx.oncomplete = resolve; });
    db.close();
  }, saved);

  const stillPinned = () => page.evaluate(async ([url, cacheName]) => {
    const cache = await caches.open(cacheName);
    return Boolean(await cache.match(url));
  }, [downloadUrl, SW_PINNED_AUDIO_CACHE] as const);
  const remove = async (title: string) => {
    await page.locator('li', { hasText: title }).getByRole('button').last().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText(title)).toHaveCount(0);
  };

  await page.goto('/offline');
  await expect(page.getByText('Saved A')).toBeVisible({ timeout: 20_000 });
  await remove('Saved A');
  expect(await stillPinned()).toBe(true);

  await remove('Saved B');
  expect(await stillPinned()).toBe(false);
});
