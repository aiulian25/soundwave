import { test, expect, Page, Browser } from '@playwright/test';

// Real playback in a real <audio> element against a stubbed API, so no real login is spent.
// Playback is sped up, which is fine because listened time follows playback position.
const STUB_ACCOUNT = { id: 1, username: 'stub', email: 'stub@example.test', password_change_required: false };
const FAST_PLAYBACK_RATE = 4;
const LONG_TRACK_SECONDS = 120;
const SHORT_TRACK_SECONDS = 12;
const SAMPLE_RATE = 8000;

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

const track = (id: number, youtubeId: string, duration: number) => ({
  id, youtube_id: youtubeId, title: `Track ${youtubeId}`, channel_name: 'x', duration,
  media_url: `/media/${youtubeId}.wav`, file_path: `${youtubeId}.wav`,
});
const LONG_A = track(1, 'longA', LONG_TRACK_SECONDS);
const LONG_B = track(2, 'longB', LONG_TRACK_SECONDS);
const SHORT = track(3, 'short', SHORT_TRACK_SECONDS);

interface Stubs {
  events: any[];
  radioCalls: string[];
  failNextEvents: number;
}

async function openLibrary(browser: Browser, tracks: unknown[], extraSettings: object = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const stubs: Stubs = { events: [], radioCalls: [], failNextEvents: 0 };

  await page.route((url) => url.pathname.startsWith('/media/'), (route) => {
    const seconds = route.request().url().includes('short') ? SHORT_TRACK_SECONDS : LONG_TRACK_SECONDS;
    return route.fulfill({ status: 200, contentType: 'audio/wav', body: silentWav(seconds) });
  });
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.pathname === '/api/user/account/') return json(STUB_ACCOUNT);
    if (url.pathname === '/api/user/config/') return json({ extra_settings: {}, playback_sync_enabled: false, ...extraSettings });
    if (url.pathname === '/api/audio/list/') return json({ data: tracks, next: null });
    if (url.pathname === '/api/stats/record/') {
      if (stubs.failNextEvents > 0) {
        stubs.failNextEvents -= 1;
        return route.abort('failed');
      }
      stubs.events.push(route.request().postDataJSON());
      return json({}, 201);
    }
    if (url.pathname === '/api/radio/start/') return json({ session: { tracks_skipped: 0 }, first_track: LONG_A });
    if (url.pathname === '/api/radio/next/') return json({ track: SHORT, reason: 'next', total_played: 1 });
    if (url.pathname === '/api/radio/skip/' || url.pathname === '/api/radio/like/') {
      stubs.radioCalls.push(url.pathname);
      return json({});
    }
    return json({ data: [] });
  });

  await page.goto('/library');
  return { context, page, stubs };
}

async function startTrack(page: Page, title: string) {
  await page.getByText(title).first().click();
  await expect(page.getByTestId('player-playpause')).toHaveAttribute('data-playing', 'true', { timeout: 20_000 });
}

const position = (page: Page) => page.evaluate(() => document.querySelector('audio')!.currentTime);
const speedUp = (page: Page) => page.evaluate((rate) => {
  document.querySelector('audio')!.playbackRate = rate;
}, FAST_PLAYBACK_RATE);
const playPast = async (page: Page, seconds: number) => {
  const start = await position(page);
  await expect.poll(async () => (await position(page)) - start, { timeout: 20_000 }).toBeGreaterThan(seconds);
};

test('a partial listen survives a skip, and seek distance adds nothing', async ({ browser }) => {
  const { context, page, stubs } = await openLibrary(browser, [LONG_A, LONG_B]);
  await startTrack(page, LONG_A.title);
  await speedUp(page);
  await playPast(page, 12);

  await page.evaluate(() => {
    const element = document.querySelector('audio')!;
    element.currentTime = element.currentTime + 60;
  });
  await page.getByTestId('player-next').click();

  await expect.poll(() => stubs.events.length).toBe(1);
  const [event] = stubs.events;
  expect(event).toMatchObject({ youtube_id: LONG_A.youtube_id, completed: false });
  expect(event.duration_listened).toBeGreaterThanOrEqual(12);
  expect(event.duration_listened).toBeLessThan(30);

  await context.close();
});

test('a track that plays to its end is one completed play', async ({ browser }) => {
  const { context, page, stubs } = await openLibrary(browser, [SHORT]);
  await startTrack(page, SHORT.title);
  await speedUp(page);

  await expect.poll(() => stubs.events.length, { timeout: 20_000 }).toBe(1);
  expect(stubs.events[0]).toMatchObject({ youtube_id: SHORT.youtube_id, completed: true });

  await context.close();
});

test('repeat-one makes separate plays', async ({ browser }) => {
  const { context, page, stubs } = await openLibrary(browser, [SHORT], { repeat_mode: 'one' });
  await startTrack(page, SHORT.title);
  await speedUp(page);

  await expect.poll(() => stubs.events.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  expect(stubs.events[0].event_id).not.toBe(stubs.events[1].event_id);
  expect(stubs.events[0].completed).toBe(true);

  await context.close();
});

test('a failed delivery waits and is sent again with the same identity and time', async ({ browser }) => {
  const { context, page, stubs } = await openLibrary(browser, [SHORT]);
  stubs.failNextEvents = 1;
  await startTrack(page, SHORT.title);
  await speedUp(page);

  const waitingEvent = () => page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const opening = indexedDB.open('soundwave-offline');
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const rows: any[] = await new Promise((resolve) => {
      const reading = db.transaction('listeningOutbox').objectStore('listeningOutbox').getAll();
      reading.onsuccess = () => resolve(reading.result);
    });
    db.close();
    return rows[0] ?? null;
  });
  await expect.poll(async () => (await waitingEvent())?.event_id ?? null, { timeout: 20_000 }).not.toBeNull();
  const stored = await waitingEvent();
  expect(stubs.events).toHaveLength(0);

  await page.reload();

  await expect.poll(() => stubs.events.length, { timeout: 20_000 }).toBe(1);
  expect(stubs.events[0]).toMatchObject({ event_id: stored.event_id, occurred_at: stored.occurred_at });
  await expect.poll(waitingEvent).toBeNull();

  await context.close();
});

test('radio hears a skip as a skip and a natural end as a play', async ({ browser }) => {
  const { context, page, stubs } = await openLibrary(browser, [LONG_A]);
  await startTrack(page, LONG_A.title);
  await page.getByTestId('player-start-radio').first().click();
  await page.getByText('Track Radio').click();

  await page.getByTestId('player-next').click();
  await expect(page.locator('audio')).toHaveAttribute('src', /short/);
  expect(stubs.radioCalls).toEqual(['/api/radio/skip/']);

  await expect(page.getByTestId('player-playpause')).toHaveAttribute('data-playing', 'true', { timeout: 20_000 });
  await speedUp(page);
  await expect.poll(() => stubs.radioCalls, { timeout: 20_000 }).toEqual(['/api/radio/skip/', '/api/radio/like/']);

  await context.close();
});
