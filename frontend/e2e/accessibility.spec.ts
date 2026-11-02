import { test, expect, Page, Browser } from '@playwright/test';

// A real <audio> element and real canvas against a stubbed API, so no real login is spent.
const STUB_ACCOUNT = { id: 1, username: 'stub', email: 'stub@example.test', password_change_required: false };
const SAMPLE_RATE = 8000;
const TRACK_SECONDS = 60;
const MOBILE = { width: 390, height: 844 };
const MAX_TAB_PRESSES = 60;

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

const track = (id: number, name: string) => ({
  id, youtube_id: `yt${id}`, title: name, channel_name: 'x', duration: TRACK_SECONDS,
  media_url: `/media/${id}.wav`, file_path: `${id}.wav`,
});
const TRACKS = [track(1, 'First song'), track(2, 'Second song'), track(3, 'Third song')];

async function openLibrary(
  browser: Browser,
  options: { language?: string; reducedMotion?: 'reduce'; viewport?: { width: number; height: number } } = {},
) {
  const context = await browser.newContext({
    serviceWorkers: 'block',
    reducedMotion: options.reducedMotion,
    viewport: options.viewport,
  });
  const page = await context.newPage();
  // Counts real drawing, whatever the visualizer style.
  await page.addInitScript(({ language, VISUALIZER_MIN_HEIGHT }) => {
    if (language) localStorage.setItem('soundwave_language', language);
    (window as any).canvasClears = 0;
    const original = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function patched(...args) {
      // The seek bar has its own, much shorter canvas.
      if (this.canvas.height >= VISUALIZER_MIN_HEIGHT) (window as any).canvasClears += 1;
      return original.apply(this, args);
    };
  }, { language: options.language ?? '', VISUALIZER_MIN_HEIGHT: 100 });
  await page.route((url) => url.pathname.startsWith('/media/'), (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body: silentWav(TRACK_SECONDS) }));
  let config: Record<string, unknown> = { extra_settings: {}, playback_sync_enabled: false, visualizer_enabled: true };
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.pathname === '/api/user/account/') return json(STUB_ACCOUNT);
    if (url.pathname === '/api/user/config/') {
      if (route.request().method() === 'GET') return json(config);
      config = { ...config, ...route.request().postDataJSON() };
      return json({ config });
    }
    if (url.pathname === '/api/audio/list/') return json({ data: TRACKS, next: null });
    return json({ data: [] });
  });
  await page.goto('/library');
  return { context, page };
}

async function startFirstTrack(page: Page) {
  await page.getByText('First song').first().click();
  await expect(page.getByTestId('player-playpause')).toHaveAttribute('data-playing', 'true', { timeout: 20_000 });
}

const canvasClears = (page: Page) => page.evaluate(() => (window as any).canvasClears as number);
const position = (page: Page) => page.evaluate(() => document.querySelector('audio')!.currentTime);

test('player controls have names and report their state', async ({ browser }) => {
  const { context, page } = await openLibrary(browser);
  await startFirstTrack(page);

  for (const name of ['Pause', 'Previous track', 'Next track', 'Shuffle', 'Repeat: off', 'Mute']) {
    await expect(page.getByRole('button', { name, exact: true }).first()).toBeVisible();
  }
  await expect(page.getByRole('slider', { name: 'Volume' }).first()).toBeVisible();

  const mute = page.getByRole('button', { name: 'Mute', exact: true }).first();
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  await mute.click();
  await expect(page.getByRole('button', { name: 'Unmute', exact: true }).first()).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Repeat: off' }).first().click();
  await expect(page.getByRole('button', { name: 'Repeat: this track' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Repeat: this track' }).first().click();
  await expect(page.getByRole('button', { name: 'Repeat: all tracks' }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Pause', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Play', exact: true }).first()).toBeVisible();

  await context.close();
});

test('the names are translated', async ({ browser }) => {
  const { context, page } = await openLibrary(browser, { language: 'ro' });
  await startFirstTrack(page);

  await expect(page.getByRole('button', { name: 'Melodia urmatoare' }).first()).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Volum' }).first()).toBeVisible();

  await context.close();
});

test('the queue can be reordered from the keyboard, and focus stays with the track', async ({ browser }) => {
  const { context, page } = await openLibrary(browser);
  await startFirstTrack(page);
  await page.locator('button:has(svg[data-testid="QueueMusicIcon"])').first().click();

  const titles = () => page.locator('[class*="MuiListItem-root"]').allInnerTexts();
  const moveDownSecond = page.getByRole('button', { name: 'Move down: Second song' });
  await expect(moveDownSecond).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move up: Second song' })).toBeDisabled();

  await moveDownSecond.focus();
  await page.keyboard.press('Enter');

  await expect.poll(async () => {
    const order = await titles();
    return order.findIndex((text) => text.includes('Third song')) < order.findIndex((text) => text.includes('Second song'));
  }).toBe(true);
  // It reached the end, so its Move down is disabled and focus moves to its Move up.
  await expect(page.getByRole('button', { name: 'Move up: Second song' })).toBeFocused();

  await page.keyboard.press('Enter');

  await expect.poll(async () => {
    const order = await titles();
    return order.findIndex((text) => text.includes('Second song')) < order.findIndex((text) => text.includes('Third song'));
  }).toBe(true);
  await expect(page.getByRole('button', { name: 'Move down: Second song' })).toBeFocused();

  await context.close();
});

test('on a phone, the mini player is restored and played from the keyboard', async ({ browser }) => {
  const { context, page } = await openLibrary(browser, { viewport: MOBILE });
  await startFirstTrack(page);

  await page.getByRole('button', { name: 'Minimize player' }).focus();
  await page.keyboard.press('Enter');
  const restore = page.getByRole('button', { name: 'Open player: First song' });
  await expect(restore).toBeVisible();
  await expect(restore).toBeFocused();

  const miniPause = page.getByRole('button', { name: 'Pause', exact: true }).last();
  await expect(miniPause).toBeVisible();
  await miniPause.click();
  await expect(page.getByRole('button', { name: 'Play', exact: true }).last()).toBeVisible();
  await expect(restore).toBeVisible();

  // Reached by tabbing, as a keyboard user would, starting from the page.
  await page.locator('body').evaluate((body) => (body as HTMLElement).focus());
  for (let press = 0; press < MAX_TAB_PRESSES && !(await restore.evaluate((el) => el === document.activeElement)); press += 1) {
    await page.keyboard.press('Tab');
  }
  await expect(restore).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(restore).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Minimize player' })).toBeFocused();

  await context.close();
});

test('nothing draws while the player is hidden, and the music carries on', async ({ browser }) => {
  const { context, page } = await openLibrary(browser, { viewport: MOBILE });
  await startFirstTrack(page);
  await expect.poll(() => canvasClears(page), { timeout: 10_000 }).toBeGreaterThan(5);

  await page.getByRole('button', { name: 'Minimize player' }).click();
  await expect(page.getByRole('button', { name: 'Open player: First song' })).toBeVisible();
  await page.waitForTimeout(800);

  const clearsWhenHidden = await canvasClears(page);
  const positionWhenHidden = await position(page);
  await page.waitForTimeout(1000);

  expect(await canvasClears(page)).toBe(clearsWhenHidden);
  expect(await position(page)).toBeGreaterThan(positionWhenHidden);

  await page.getByRole('button', { name: 'Open player: First song' }).click();
  await expect.poll(() => canvasClears(page), { timeout: 10_000 }).toBeGreaterThan(clearsWhenHidden);

  await context.close();
});

test('nothing draws when less motion is asked for, and the music plays', async ({ browser }) => {
  const { context, page } = await openLibrary(browser, { reducedMotion: 'reduce' });
  await startFirstTrack(page);
  const started = await position(page);

  await page.waitForTimeout(1200);

  expect(await canvasClears(page)).toBe(0);
  expect(await position(page)).toBeGreaterThan(started);

  await context.close();
});

test('every visible button on the library page has a name, and primary buttons have readable text', async ({ browser }) => {
  const { page, context } = await openLibrary(browser);
  await expect(page.getByText('First song').first()).toBeVisible();

  const unnamedButtons = await page.evaluate(() => [...document.querySelectorAll('button, [role=button]')]
    .filter((button) => button.getBoundingClientRect().width > 0)
    .filter((button) => !button.getAttribute('aria-label') && !button.getAttribute('title') && !button.textContent?.trim())
    .map((button) => button.outerHTML.slice(0, 120)));
  expect(unnamedButtons).toEqual([]);

  const primaryButton = page.locator('.MuiButton-containedPrimary').first();
  await expect(primaryButton).toBeVisible();
  const textColor = await primaryButton.evaluate((button) => getComputedStyle(button).color);
  expect(textColor).not.toBe('rgb(255, 255, 255)');

  await context.close();
});

