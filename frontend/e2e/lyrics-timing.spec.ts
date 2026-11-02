import { test, expect, Page, Browser } from '@playwright/test';

// A real <audio> element and real IndexedDB against a stubbed API, so no real login is spent.
const STUB_ACCOUNT = { id: 1, username: 'stub', email: 'stub@example.test', password_change_required: false };
const SAMPLE_RATE = 8000;
const TRACK_SECONDS = 60;
const SYNCED = '[00:10.00]First line\n[00:20.00]Second line\n[00:30.00]Third line';
const REVISION = 'revision-one';
const MINIMUM_STAMP_SECONDS = 1;
const STAMP_TOLERANCE_SECONDS = 1.5;
const TRACK = {
  id: 1, youtube_id: 'lyricTrack1', title: 'Timed song', channel_name: 'x', duration: TRACK_SECONDS,
  media_url: '/media/1.wav', file_path: '1.wav',
};

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

const lyricsRecord = (syncedLyrics: string, revision: string, original = '') => ({
  audio_id: TRACK.youtube_id, audio_title: TRACK.title, synced_lyrics: syncedLyrics,
  original_synced_lyrics: original, revision, plain_lyrics: '', is_instrumental: false, source: 'lrclib',
  language: '', has_lyrics: true, is_synced: true, display_lyrics: syncedLyrics, fetch_attempted: true,
  fetch_attempts: 1, last_error: '',
});

interface Stubs {
  current: ReturnType<typeof lyricsRecord>;
  saves: { synced_lyrics: string; base_revision: string }[];
}

async function openEditor(browser: Browser) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const stubs: Stubs = { current: lyricsRecord(SYNCED, REVISION), saves: [] };

  await page.route((url) => url.pathname.startsWith('/media/'), (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body: silentWav(TRACK_SECONDS) }));
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.pathname === '/api/user/account/') return json(STUB_ACCOUNT);
    if (url.pathname === '/api/user/config/') return json({ extra_settings: {}, playback_sync_enabled: false });
    if (url.pathname === '/api/audio/list/') return json({ data: [TRACK], next: null });
    if (url.pathname.endsWith('/lyrics/timing/')) {
      const body = route.request().postDataJSON();
      if (body.base_revision !== stubs.current.revision) return json({ error: 'changed', current: stubs.current }, 409);
      stubs.saves.push(body);
      stubs.current = lyricsRecord(body.synced_lyrics, 'revision-saved', SYNCED);
      return json(stubs.current);
    }
    if (url.pathname.endsWith('/lyrics/')) return json(stubs.current);
    return json({ data: [] });
  });

  await page.goto('/library');
  await showEditor(page);
  return { context, page, stubs };
}

async function showEditor(page: Page) {
  await page.getByText(TRACK.title).first().click();
  await expect(page.getByTestId('player-playpause')).toBeVisible({ timeout: 20_000 });
  await page.getByTitle('Click to toggle lyrics').first().click();
  await page.getByRole('button', { name: 'Adjust timing' }).click();
  await expect(page.getByTestId('lyrics-timing-editor')).toBeVisible();
}

const shownTimes = (page: Page) =>
  page.getByTestId('lyrics-timing-line').getByRole('button', { name: /^Play from/ }).allTextContents();
const storedRecord = (page: Page, storeName: string) => page.evaluate(({ storeName, youtubeId }) => new Promise<any>((resolve, reject) => {
  const opening = indexedDB.open('soundwave-offline');
  opening.onerror = () => reject(opening.error);
  opening.onsuccess = () => {
    const reading = opening.result.transaction(storeName).objectStore(storeName).get(youtubeId);
    reading.onsuccess = () => {
      opening.result.close();
      resolve(reading.result);
    };
  };
}), { storeName, youtubeId: TRACK.youtube_id });
const storedDraftStart = async (page: Page) => (await storedRecord(page, 'lyricsTimingDrafts'))?.lines[0].timeMs;
const parsePosition = (shown: string) => {
  const [minutes, seconds] = shown.split(':');
  return Number(minutes) * 60 + Number(seconds);
};

test('shifting all lines, undoing, and saving sends the canonical timing', async ({ browser }) => {
  const { page, context, stubs } = await openEditor(browser);

  await page.getByRole('button', { name: '1 s later', exact: true }).click();
  await page.getByRole('button', { name: '1 s later', exact: true }).click();
  await expect.poll(() => shownTimes(page)).toEqual(['0:12.000', '0:22.000', '0:32.000']);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => shownTimes(page)).toEqual(['0:11.000', '0:21.000', '0:31.000']);

  await page.getByRole('button', { name: 'Save timing' }).click();
  await expect(page.getByTestId('lyrics-timing-editor')).toBeHidden();

  expect(stubs.saves).toEqual([{
    synced_lyrics: '[00:11.000]First line\n[00:21.000]Second line\n[00:31.000]Third line',
    base_revision: REVISION,
  }]);
  // What offline playback reads next, and no draft left to come back later.
  await expect.poll(async () => (await storedRecord(page, 'lyrics'))?.synced_lyrics)
    .toBe('[00:11.000]First line\n[00:21.000]Second line\n[00:31.000]Third line');
  expect(await storedRecord(page, 'lyricsTimingDrafts')).toBeUndefined();
  await context.close();
});

test('the stamp key times the next line at the playing position, and order is enforced', async ({ browser }) => {
  const { page, context } = await openEditor(browser);
  const playingPosition = () => page.evaluate(() => document.querySelector('audio')!.currentTime);
  await expect.poll(playingPosition, { timeout: 20_000 }).toBeGreaterThan(MINIMUM_STAMP_SECONDS);

  await page.getByTestId('lyrics-timing-editor').press('t');
  const stampedAt = await playingPosition();
  const [firstTime] = await shownTimes(page);
  expect(Math.abs(parsePosition(firstTime) - stampedAt)).toBeLessThan(STAMP_TOLERANCE_SECONDS);
  expect(firstTime).not.toBe('0:10.000');

  // Still far earlier than the second line's 20 seconds, so the third line ends up out of order.
  await page.getByRole('button', { name: 'Stamp this line at the current position' }).nth(2).click();
  await expect(page.getByText('Starts before the previous line')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save timing' })).toBeDisabled();
  await context.close();
});

test('a draft survives an offline reload and can be downloaded with the same timing', async ({ browser }) => {
  const { page, context, stubs } = await openEditor(browser);

  await page.getByRole('button', { name: '0.1 s later', exact: true }).click();
  await expect.poll(() => shownTimes(page)).toEqual(['0:10.100', '0:20.100', '0:30.100']);
  // The write finishes after the screen updates, and a reload in between would abandon it.
  await expect.poll(() => storedDraftStart(page)).toBe(10_100);

  await page.reload();
  await showEditor(page);
  await expect(page.getByText('Your unsaved draft was restored')).toBeVisible();
  await expect.poll(() => shownTimes(page)).toEqual(['0:10.100', '0:20.100', '0:30.100']);

  await context.setOffline(true);
  await page.getByRole('button', { name: 'Save timing' }).click();
  await expect(page.getByText('You are offline')).toBeVisible();
  expect(stubs.saves).toEqual([]);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download revised LRC' }).click(),
  ]);
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
  expect(Buffer.concat(chunks).toString()).toBe('[00:10.100]First line\n[00:20.100]Second line\n[00:30.100]Third line');

  await context.setOffline(false);
  await page.getByRole('button', { name: 'Save timing' }).click();
  await expect(page.getByTestId('lyrics-timing-editor')).toBeHidden();
  expect(stubs.saves).toHaveLength(1);
  expect(stubs.saves[0].synced_lyrics).toContain('[00:10.100]First line');
  await context.close();
});

test('a change made elsewhere shows a conflict instead of being overwritten', async ({ browser }) => {
  const { page, context, stubs } = await openEditor(browser);

  await page.getByRole('button', { name: '1 s later', exact: true }).click();
  stubs.current = lyricsRecord('[00:15.000]First line\n[00:25.000]Second line\n[00:35.000]Third line', 'revision-other');
  await page.getByRole('button', { name: 'Save timing' }).click();

  await expect(page.getByTestId('lyrics-timing-conflict')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save timing' })).toBeDisabled();
  expect(stubs.saves).toEqual([]);
  await expect.poll(() => shownTimes(page)).toEqual(['0:11.000', '0:21.000', '0:31.000']);

  await page.getByRole('button', { name: 'Use the latest' }).click();
  await expect.poll(() => shownTimes(page)).toEqual(['0:15.000', '0:25.000', '0:35.000']);
  await context.close();
});

test('keeping mine after a conflict saves against the latest revision', async ({ browser }) => {
  const { page, context, stubs } = await openEditor(browser);

  await page.getByRole('button', { name: '1 s later', exact: true }).click();
  stubs.current = lyricsRecord('[00:15.000]First line\n[00:25.000]Second line\n[00:35.000]Third line', 'revision-other');
  await page.getByRole('button', { name: 'Save timing' }).click();
  await page.getByRole('button', { name: 'Keep mine' }).click();
  await page.getByRole('button', { name: 'Save timing' }).click();

  await expect(page.getByTestId('lyrics-timing-editor')).toBeHidden();
  expect(stubs.saves[0]).toEqual({
    synced_lyrics: '[00:11.000]First line\n[00:21.000]Second line\n[00:31.000]Third line',
    base_revision: 'revision-other',
  });
  await context.close();
});
