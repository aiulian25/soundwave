import { test, expect, Page } from '@playwright/test';

// The API is stubbed and workers are blocked, so this needs no real login (logins are rate
// limited across the suite), yet IndexedDB and Cache Storage are the browser's real ones.
// Removing a playlist needs a live worker and is covered in offline.spec.ts.
const STUB_ACCOUNT = { id: 1, username: 'stub', email: 'stub@example.test', password_change_required: false };
const AUDIO_CACHE = 'soundwave-audio-v3';
const API_CACHE = 'soundwave-api-v3';
const TRACK = {
  id: 1, youtube_id: 'stubLyrics', title: 'Lyric track', channel_name: 'x', duration: 60, file_path: 'a.m4a',
  thumbnail_url: '/img/icons/icon-192x192.png',
};
const SUGGESTION = {
  id: 5, track_name: 'Lyric track', artist_name: 'x', plain_lyrics: 'applied words', synced_lyrics: '', instrumental: false, language: 'en', duration: 60,
};
const PARTIAL_PLAYLIST_ID = 'PLpartial';
const partialItem = (id: string) => ({
  id, position: 0, added_date: '2026-01-01T00:00:00Z', audio: { ...TRACK, id, youtube_id: id, title: `Track ${id}` },
});
const PARTIAL_PLAYLIST = {
  id: 2, playlist_id: PARTIAL_PLAYLIST_ID, title: 'Partly saved', description: '', channel_name: 'x', thumbnail_url: '',
  subscribed: true, playlist_type: 'youtube', item_count: 2, remote_total: 2, downloaded_count: 2, progress_percent: 100,
  last_refresh: null, sync_status: 'success', status_display: 'Success', error_message: '', active: true,
  items: [partialItem('X'), partialItem('Y')],
};
const lyricsResponse = (words: string) => ({
  audio_id: TRACK.youtube_id, audio_title: TRACK.title, plain_lyrics: words, synced_lyrics: '', is_instrumental: false,
  source: 'manual', language: 'en', has_lyrics: true, is_synced: false, display_lyrics: words,
  fetch_attempted: true, fetch_attempts: 1, last_error: '',
});

async function stubApi(page: Page) {
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.pathname === '/api/user/account/') return json(STUB_ACCOUNT);
    if (url.pathname === '/api/user/config/') return json({ extra_settings: {} });
    if (url.pathname === '/api/audio/list/') return json({ data: [TRACK], next: null });
    if (url.pathname.endsWith('/lyrics/fetch/')) return json(lyricsResponse('new words'));
    if (url.pathname.endsWith('/lyrics/delete/')) return json({}, 200);
    if (url.pathname.endsWith('/lyrics/apply/')) return json(lyricsResponse('applied words'));
    if (url.pathname.endsWith('/lyrics/upload/')) return json(lyricsResponse('uploaded words'));
    if (url.pathname.endsWith('/lyrics/suggestions/')) return json({ suggestions: [SUGGESTION] });
    if (url.pathname === `/api/playlist/${PARTIAL_PLAYLIST_ID}/`) return json(PARTIAL_PLAYLIST);
    if (url.pathname.endsWith('/lyrics/') && method === 'GET') return json(lyricsResponse('old words'));
    return json({ data: [] });
  });
}

function savePlaylistsAndPin(page: Page, playlists: unknown[], pinnedTrackIds: string[]) {
  return page.evaluate(async ([saved, pinned, cacheName]) => {
    const cache = await caches.open(cacheName as string);
    for (const id of pinned as string[]) {
      await cache.put(`/api/audio/${id}/download/`, new Response('audio'));
    }
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const opening = indexedDB.open('soundwave-offline');
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const tx = db.transaction('playlists', 'readwrite');
    (saved as unknown[]).forEach((playlist) => tx.objectStore('playlists').put(playlist));
    await new Promise((resolve) => { tx.oncomplete = resolve; });
    db.close();
  }, [playlists, pinnedTrackIds, AUDIO_CACHE] as const);
}

const storedLyrics = (page: Page, youtubeId: string) => page.evaluate(async (id) => {
  const db: IDBDatabase = await new Promise((resolve, reject) => {
    const opening = indexedDB.open('soundwave-offline');
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  const row: any = await new Promise((resolve) => {
    const reading = db.transaction('lyrics').objectStore('lyrics').get(id);
    reading.onsuccess = () => resolve(reading.result);
  });
  db.close();
  return row?.plain_lyrics ?? null;
}, youtubeId);

test('the offline page follows the bytes across reloads and eviction', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  await stubApi(page);
  await page.goto('/offline');
  await expect(page.getByText('Offline Storage')).toBeVisible({ timeout: 20_000 });

  const item = (id: string) => ({ id, position: 0, audio: { youtube_id: id, title: id } });
  await savePlaylistsAndPin(page, [{
    id: 1, playlist_id: 'PLwhole', title: 'Saved playlist', channel_name: 'x', item_count: 2,
    downloaded_count: 2, items: [item('X'), item('Y')], offline: true, lastSync: Date.now(),
  }], ['X', 'Y']);

  await page.reload();
  await expect(page.getByText('2 tracks', { exact: true })).toBeVisible();

  await page.evaluate(async (cacheName) => {
    const cache = await caches.open(cacheName);
    await cache.delete('/api/audio/Y/download/');
  }, AUDIO_CACHE);
  await page.reload();

  await expect(page.getByText('1 of 2 tracks playable offline')).toBeVisible();

  await context.close();
});

test('a partly saved playlist says so and offers the missing tracks', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  await stubApi(page);
  await page.goto('/offline');
  await expect(page.getByText('Offline Storage')).toBeVisible({ timeout: 20_000 });
  await savePlaylistsAndPin(page, [{ ...PARTIAL_PLAYLIST, offline: true, lastSync: Date.now() }], ['X']);

  await page.goto(`/playlists/${PARTIAL_PLAYLIST_ID}`);

  await expect(page.getByText('1 tracks are available offline, 1 are missing')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Download missing' })).toBeVisible();
  await expect(page.getByText('Partly cached')).toBeVisible();

  await context.close();
});

test('changing or deleting lyrics changes the offline copies', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  await stubApi(page);
  await page.goto('/library');
  await page.getByText(TRACK.title).first().click();
  await expect(page.getByTestId('player-playpause')).toBeVisible({ timeout: 20_000 });

  const lyricsUrl = `/api/audio/${TRACK.youtube_id}/lyrics/`;
  await page.evaluate(async ([cacheName, url]) => {
    const cache = await caches.open(cacheName);
    await cache.put(url, new Response('{"plain_lyrics":"old words"}'));
  }, [API_CACHE, lyricsUrl] as const);
  const storedResponseExists = () => page.evaluate(async ([cacheName, url]) => {
    const cache = await caches.open(cacheName);
    return Boolean(await cache.match(url));
  }, [API_CACHE, lyricsUrl] as const);

  await page.getByTitle('Click to toggle lyrics').first().click();
  await expect.poll(() => storedLyrics(page, TRACK.youtube_id)).toBe('old words');

  await page.getByTitle('Refresh lyrics').click();
  await expect.poll(() => storedLyrics(page, TRACK.youtube_id)).toBe('new words');
  expect(await storedResponseExists()).toBe(false);

  await page.getByTitle('Find Different Lyrics').click();
  await page.getByRole('button', { name: 'Use' }).first().click();
  await expect.poll(() => storedLyrics(page, TRACK.youtube_id)).toBe('applied words');

  await page.setInputFiles('input[type="file"]', {
    name: 'words.lrc', mimeType: 'text/plain', buffer: Buffer.from('[00:01.00]uploaded words'),
  });
  await expect.poll(() => storedLyrics(page, TRACK.youtube_id)).toBe('uploaded words');

  await page.evaluate(async ([cacheName, url]) => {
    const cache = await caches.open(cacheName);
    await cache.put(url, new Response('{"plain_lyrics":"new words"}'));
  }, [API_CACHE, lyricsUrl] as const);
  await page.getByTitle('Find Different Lyrics').click();
  await page.getByRole('button', { name: 'Clear & Search' }).click();
  await expect.poll(() => storedLyrics(page, TRACK.youtube_id)).toBeNull();
  expect(await storedResponseExists()).toBe(false);

  await context.close();
});
