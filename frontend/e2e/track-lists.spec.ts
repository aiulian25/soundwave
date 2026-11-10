import { test, expect, Page, Browser } from '@playwright/test';

// Every page that lists tracks uses one table: the same row height, titles that roll when they
// do not fit, artwork only from this server, and no sideways scrolling on a phone. The API is
// stubbed, so no real login is spent; workers are blocked so every request reaches page.route.
const STUB_ACCOUNT = { id: 1, username: 'stub', email: 'stub@example.test', password_change_required: false };
// Longer than the title column on any screen, so it must roll everywhere.
const LONG_TITLE = `${'A very long song title that keeps going | '.repeat(6)}Best Of Vol.13`;
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const ROW_HEIGHT_PX = 60;
const ROW_HEIGHT_TOLERANCE_PX = 1;
const PLAYLIST_ID = 'PL_stub';
const SMART_PLAYLIST_ID = 7;
const CHANNEL_ID = 'UC_stub';
const SAMPLE_RATE = 8000;
const TRACK_SECONDS = 30;
// One transparent pixel, standing in for kept artwork.
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const track = (id: number, title = `Song ${id}`) => ({
  id, youtube_id: `yt${id}`, title, channel_name: 'Channel', artist: '', duration: 200, file_size: 1,
  play_count: 0, view_count: 10, is_favorite: true, file_path: `${id}.wav`, media_url: `/media/${id}.wav`,
  thumbnail_url: `/api/audio/yt${id}/artwork/`, published_date: '2026-01-01T00:00:00Z',
});
const TRACKS = [track(1, LONG_TITLE), track(2), track(3)];
const SMART_CHOICES = {
  fields: [{ value: 'year', label: 'Year' }],
  operators: [{ value: 'greater_than', label: 'Greater than' }],
  order_by_options: [{ value: 'random', label: 'Random' }],
  field_types: { year: 'numeric' },
  operator_groups: { numeric: ['greater_than'] },
};
const SMART_PLAYLIST = {
  id: SMART_PLAYLIST_ID, name: 'Smart', description: '', icon: 'auto_awesome', color: '#7C3AED', is_system: true,
  invalid_rule_ids: [], match_mode: 'all', order_by: 'random', limit: null, rules: [], track_count: TRACKS.length,
};

const PAGES: [string, string][] = [
  ['library', '/library'],
  ['favorites', '/favorites'],
  ['playlist', `/playlists/${PLAYLIST_ID}`],
  ['smart playlist', `/smart-playlist/${SMART_PLAYLIST_ID}`],
  ['channel', `/channels/${CHANNEL_ID}`],
];

function silentWav(seconds: number): Buffer {
  const dataBytes = seconds * SAMPLE_RATE;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([header, Buffer.alloc(dataBytes, 128)]);
}

interface Stubs {
  remoteSession: object | null;
  foreignImageRequests: string[];
}

async function open(browser: Browser, viewport: { width: number; height: number }, path: string, stubs: Stubs) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport });
  const page = await context.newPage();
  page.on('request', (request) => {
    const isImage = request.resourceType() === 'image';
    if (isImage && new URL(request.url()).origin !== new URL(page.url() || 'http://x').origin) {
      stubs.foreignImageRequests.push(request.url());
    }
  });
  await page.route((url) => url.pathname.startsWith('/media/'), (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body: silentWav(TRACK_SECONDS) }));
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const playlistItems = TRACKS.map((audio, position) => ({ id: audio.id, position, added_date: '', audio }));

    if (/^\/api\/audio\/[^/]+\/artwork\/$/.test(url.pathname)) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG });
    }
    if (url.pathname === '/api/user/account/') return json(STUB_ACCOUNT);
    if (url.pathname === '/api/user/config/') return json({ extra_settings: {}, playback_sync_enabled: true });
    if (url.pathname === '/api/audio/list/') return json({ data: TRACKS, next: null });
    if (url.pathname === '/api/audio/yt1/') return json(TRACKS[0]);
    if (url.pathname === '/api/playback-sync/') {
      return stubs.remoteSession
        ? json({ has_session: true, session: stubs.remoteSession })
        : json({ has_session: false }, 404);
    }
    if (url.pathname === '/api/playback-sync/queue/') return json({ data: [TRACKS[0]], index: 0, missing: 0 });
    if (url.pathname === `/api/playlist/${PLAYLIST_ID}/`) {
      return json({
        id: 1, playlist_id: PLAYLIST_ID, title: 'Stub playlist', description: '', channel_name: 'x', thumbnail_url: '',
        subscribed: false, playlist_type: 'custom', item_count: TRACKS.length, remote_total: TRACKS.length,
        downloaded_count: TRACKS.length, progress_percent: 100, last_refresh: null, sync_status: 'success',
        status_display: 'Success', error_message: '', active: true,
      });
    }
    const isReadingPlaylistItems = url.pathname === `/api/playlist/${PLAYLIST_ID}/items/` && route.request().method() === 'GET';
    if (isReadingPlaylistItems) return json({ data: playlistItems, next: null });
    if (url.pathname === `/api/playlist/smart/${SMART_PLAYLIST_ID}/tracks/`) {
      return json({ data: TRACKS, playlist: SMART_PLAYLIST, next: null });
    }
    if (url.pathname === `/api/playlist/smart/${SMART_PLAYLIST_ID}/`) return json(SMART_PLAYLIST);
    if (url.pathname === '/api/playlist/smart/choices/') return json(SMART_CHOICES);
    if (url.pathname === `/api/channel/${CHANNEL_ID}/`) {
      return json({
        id: 1, channel_id: CHANNEL_ID, channel_name: 'Channel', channel_thumbnail: '', subscribed: true,
        video_count: TRACKS.length, subscriber_count: 0, downloaded_count: TRACKS.length, last_refreshed: '',
        sync_status: 'success', sync_depth: 50, status_display: 'Success', error_message: '', active: true,
        progress_percent: 100, audio_files: TRACKS, audio_count: TRACKS.length,
      });
    }
    return json({ data: [] });
  });
  await page.goto(path);
  await expect(page.getByTestId('track-row').or(page.getByTestId('track-card')).first()).toBeVisible({ timeout: 20_000 });
  return { context, page };
}

const measure = (page: Page) => page.evaluate(() => ({
  rowHeights: [...document.querySelectorAll('[data-testid="track-row"]')].map((row) => row.getBoundingClientRect().height),
  pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
  tableOverflow: Math.max(...[...document.querySelectorAll('.MuiTableContainer-root')].map((table) => table.scrollWidth - table.clientWidth)),
}));

for (const [label, viewport] of [['phone', PHONE], ['desktop', DESKTOP]] as const) {
  for (const [name, path] of PAGES) {
    test(`${name} on a ${label}: same rows, rolling long title, local artwork, no sideways scroll`, async ({ browser }) => {
      const stubs: Stubs = { remoteSession: null, foreignImageRequests: [] };
      const { context, page } = await open(browser, viewport, path, stubs);

      const longTitleRow = page.getByTestId('track-row').filter({ hasText: LONG_TITLE });
      await expect(longTitleRow.locator('.scrolling-text-content')).toHaveAttribute('data-scrolling', 'true');

      const { rowHeights, pageOverflow, tableOverflow } = await measure(page);
      expect(rowHeights).toHaveLength(TRACKS.length);
      for (const height of rowHeights) expect(Math.abs(height - ROW_HEIGHT_PX)).toBeLessThanOrEqual(ROW_HEIGHT_TOLERANCE_PX);
      expect(pageOverflow).toBeLessThanOrEqual(0);
      expect(tableOverflow).toBeLessThanOrEqual(0);
      expect(stubs.foreignImageRequests).toEqual([]);
      await context.close();
    });
  }
}

const remoteSession = (live: boolean) => ({
  youtube_id: 'yt1', position: 12, duration: TRACK_SECONDS, is_playing: live, is_live: live, volume: 100,
  queue_youtube_ids: ['yt1'], queue_index: 0, device_id: 'device_elsewhere', device_name: 'Mac',
  updated_at: '', seconds_since_update: 2, audio_details: { ...TRACKS[0], album: '', cover_art_url: '' },
});

test('another device playing shows here, and can be taken over', async ({ browser }) => {
  const stubs: Stubs = { remoteSession: remoteSession(true), foreignImageRequests: [] };
  const { context, page } = await open(browser, DESKTOP, '/library', stubs);

  const banner = page.getByTestId('remote-playback');
  await expect(banner).toContainText('Playing on Mac');
  const playingRow = page.getByTestId('track-row').filter({ hasText: LONG_TITLE });
  await expect(playingRow.getByRole('img', { name: 'Now playing' })).toBeVisible();

  await banner.getByRole('button', { name: 'Play here' }).click();

  await expect(page.getByTestId('player-playpause')).toBeVisible({ timeout: 20_000 });
  await expect(banner).toBeHidden();
  await context.close();
});

test('a device that stopped playing no longer shows', async ({ browser }) => {
  const stubs: Stubs = { remoteSession: remoteSession(false), foreignImageRequests: [] };
  const { context, page } = await open(browser, DESKTOP, '/library', stubs);

  await expect(page.getByTestId('remote-playback')).toBeHidden();
  await expect(page.getByRole('img', { name: 'Now playing' })).toHaveCount(0);
  await context.close();
});

// The main area clips overflow, so a card past the edge would be cut off without the page scrolling.
const measureCards = (page: Page) => page.evaluate(() => {
  const cards = [...document.querySelectorAll('[data-testid="track-card"]')].map((card) => card.getBoundingClientRect());
  return {
    cards: cards.length,
    cardsCutOff: cards.filter((card) => card.left < 0 || card.right > window.innerWidth).length,
    pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
  };
});

for (const [label, viewport] of [['phone', PHONE], ['desktop', DESKTOP]] as const) {
  for (const [name, path] of PAGES) {
    test(`${name} on a ${label} as cards: every track, rolling long title, local artwork, no sideways scroll`, async ({ browser }) => {
      const stubs: Stubs = { remoteSession: null, foreignImageRequests: [] };
      const { context, page } = await open(browser, viewport, path, stubs);

      await page.getByRole('button', { name: 'Card view' }).click();

      const longTitleCard = page.getByTestId('track-card').filter({ hasText: LONG_TITLE });
      await expect(longTitleCard.locator('.scrolling-text-content')).toHaveAttribute('data-scrolling', 'true');
      const { cards, cardsCutOff, pageOverflow } = await measureCards(page);
      expect(cards).toBe(TRACKS.length);
      expect(cardsCutOff).toBe(0);
      expect(pageOverflow).toBeLessThanOrEqual(0);
      await expect(page.getByTestId('track-row')).toHaveCount(0);
      await expect(page.getByTestId('track-card-duration')).toHaveText(Array(TRACKS.length).fill('3:20'));
      expect(stubs.foreignImageRequests).toEqual([]);
      await context.close();
    });
  }
}

test('the chosen view is kept on this device, and playing from a card works', async ({ browser }) => {
  const stubs: Stubs = { remoteSession: null, foreignImageRequests: [] };
  const { context, page } = await open(browser, DESKTOP, '/library', stubs);

  await page.getByRole('button', { name: 'Card view' }).click();
  await page.reload();
  await expect(page.getByTestId('track-card').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Card view' })).toHaveAttribute('aria-pressed', 'true');

  const card = page.getByTestId('track-card').filter({ hasText: 'Song 2' });
  await card.getByRole('button').first().click();
  await expect(page.getByTestId('player-playpause')).toBeVisible({ timeout: 20_000 });
  await expect(card.getByRole('img', { name: 'Now playing' })).toBeVisible();

  await page.getByRole('button', { name: 'List view' }).click();
  await expect(page.getByTestId('track-row')).toHaveCount(TRACKS.length);
  await context.close();
});

/** Every DELETE the page sends, as "path body". */
function recordDeletes(page: Page): string[] {
  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'DELETE') return;
    sent.push(`${new URL(request.url()).pathname} ${request.postData() ?? ''}`.trim());
  });
  return sent;
}

async function openActionsOf(page: Page, title: string) {
  const row = page.getByTestId('track-row').filter({ hasText: title });
  await row.getByRole('button', { name: 'More actions' }).click();
  return row;
}

test('a track is deleted from the library only after confirming', async ({ browser }) => {
  const stubs: Stubs = { remoteSession: null, foreignImageRequests: [] };
  const { context, page } = await open(browser, DESKTOP, '/library', stubs);
  const sent = recordDeletes(page);

  const row = await openActionsOf(page, 'Song 2');
  await expect(page.getByTestId('track-remove-from-playlist')).toHaveCount(0);
  await page.getByTestId('track-delete').click();
  const question = page.getByTestId('confirm-dialog');
  await expect(question).toContainText('“Song 2” will be removed from your library');
  await expect(question).toContainText('This cannot be undone.');
  await question.getByRole('button', { name: 'Cancel' }).click();
  await expect(row).toBeVisible();
  expect(sent).toEqual([]);

  await openActionsOf(page, 'Song 2');
  await page.getByTestId('track-delete').click();
  await page.getByTestId('confirm-dialog-confirm').click();

  await expect(row).toHaveCount(0);
  await expect(page.getByTestId('track-row')).toHaveCount(TRACKS.length - 1);
  expect(sent).toEqual(['/api/audio/yt2/']);
  // Answering the question must not count as a click on the row behind it.
  await expect(page.getByTestId('player-playpause')).toHaveCount(0);
  await context.close();
});

test('a track leaves a hand-made playlist without being deleted', async ({ browser }) => {
  const stubs: Stubs = { remoteSession: null, foreignImageRequests: [] };
  const { context, page } = await open(browser, DESKTOP, `/playlists/${PLAYLIST_ID}`, stubs);
  const sent = recordDeletes(page);

  const row = await openActionsOf(page, 'Song 2');
  await page.getByTestId('track-remove-from-playlist').click();

  await expect(row).toHaveCount(0);
  expect(sent).toEqual([`/api/playlist/${PLAYLIST_ID}/items/ {"youtube_id":"yt2"}`]);
  await context.close();
});

// The player is loaded on first use, which on a freshly started server can take a few seconds.
const PLAYER_READY = { timeout: 20_000 };

/** Makes these tracks' files fail to load, as a deleted file or a lost connection would. */
async function breakMedia(page: Page, trackIds: number[]) {
  const brokenPaths = trackIds.map((id) => `/media/${id}.wav`);
  await page.route((url) => brokenPaths.includes(url.pathname), (route) => route.fulfill({ status: 404, body: '' }));
}

test('a track that cannot be played says so, and the next one plays', async ({ browser }) => {
  const stubs: Stubs = { remoteSession: null, foreignImageRequests: [] };
  const { context, page } = await open(browser, DESKTOP, '/library', stubs);
  await breakMedia(page, [2]);

  await page.getByTestId('track-row').filter({ hasText: 'Song 2' }).click();

  await expect(page.getByTestId('playback-notice')).toContainText('“Song 2” could not be played. Skipping to the next track.', PLAYER_READY);
  const nextRow = page.getByTestId('track-row').filter({ hasText: 'Song 3' });
  await expect(nextRow.getByRole('img', { name: 'Now playing' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('player-playpause')).toHaveAttribute('data-playing', 'true');
  await context.close();
});

test('several tracks in a row that cannot be played stop playback with one explanation', async ({ browser }) => {
  const stubs: Stubs = { remoteSession: null, foreignImageRequests: [] };
  const { context, page } = await open(browser, DESKTOP, '/library', stubs);
  await breakMedia(page, TRACKS.map((song) => song.id));

  await page.getByTestId('track-row').filter({ hasText: LONG_TITLE }).click();

  await expect(page.getByTestId('playback-notice')).toContainText('Playback stopped: several tracks in a row could not be played.', PLAYER_READY);
  await expect(page.getByTestId('player-playpause')).toHaveAttribute('data-playing', 'false');
  await context.close();
});

test('the only track in the queue failing is reported without skipping anywhere', async ({ browser }) => {
  const stubs: Stubs = { remoteSession: remoteSession(true), foreignImageRequests: [] };
  const { context, page } = await open(browser, DESKTOP, '/library', stubs);
  await breakMedia(page, [1]);

  await page.getByTestId('remote-playback').getByRole('button', { name: 'Play here' }).click();

  await expect(page.getByTestId('playback-notice')).toContainText('could not be played.', PLAYER_READY);
  await expect(page.getByTestId('playback-notice')).not.toContainText('Skipping');
  await context.close();
});


test('a long playlist shows its first tracks while the rest are still arriving', async ({ browser }) => {
  const stubs: Stubs = { remoteSession: null, foreignImageRequests: [] };
  const { context, page } = await open(browser, DESKTOP, `/playlists/${PLAYLIST_ID}`, stubs);
  const pageOfItems = (tracks: typeof TRACKS, next: number | null) => JSON.stringify({
    data: tracks.map((audio) => ({ id: audio.id, position: audio.id, added_date: '', audio })),
    next,
  });
  let releaseSecondPage = () => {};
  const secondPageHeld = new Promise<void>((release) => { releaseSecondPage = release; });
  await page.route((url) => url.pathname === `/api/playlist/${PLAYLIST_ID}/items/`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const isFirstPage = new URL(route.request().url()).searchParams.get('page') === '1';
    if (!isFirstPage) await secondPageHeld;
    const body = isFirstPage ? pageOfItems(TRACKS.slice(0, 2), 2) : pageOfItems(TRACKS.slice(2), null);
    return route.fulfill({ status: 200, contentType: 'application/json', body });
  });

  await page.reload();

  await expect(page.getByTestId('track-row')).toHaveCount(2);
  await expect(page.getByTestId('playlist-loading-more')).toHaveText(`Loading tracks: 2 of ${TRACKS.length}`);
  await expect(page.getByRole('button', { name: 'Play All' })).toBeDisabled();

  releaseSecondPage();

  await expect(page.getByTestId('track-row')).toHaveCount(TRACKS.length);
  await expect(page.getByTestId('playlist-loading-more')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play All' })).toBeEnabled();
  await context.close();
});
