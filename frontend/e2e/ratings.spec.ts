import { test, expect, Browser, Page, Locator } from '@playwright/test';
import { login, E2E_TRACK_TITLE, E2E_TRACK_YOUTUBE_ID } from './helpers';

// Stars are finer than a heart, and a smart playlist can follow them: "rated four or more".
// These run against the real server, so each test leaves the track unrated and removes its playlist.
// Sign-in is rate limited, so the file signs in once and every test reuses that session.
type SignedInState = Awaited<ReturnType<Awaited<ReturnType<Browser['newContext']>>['storageState']>>;
let signedIn: SignedInState;

const PLAYLIST_NAME = 'Rated in e2e';
const TOP_RATED_PRESET = 'Top Rated (4 stars and up)';
const TRACK_ADDRESS = `/api/audio/${E2E_TRACK_YOUTUBE_ID}/`;
const UNRATED = '0';
const PLAYER_READY = { timeout: 20_000 };

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  await login(await context.newPage());
  signedIn = await context.storageState();
  await context.close();
});

/** A write to the real server from the signed-in page, the way the app sends one. */
async function send(page: Page, method: string, path: string, body?: unknown): Promise<unknown> {
  return page.evaluate(async ({ method, path, body }) => {
    const csrfToken = document.cookie.split('; ').find((cookie) => cookie.startsWith('csrftoken='))?.split('=')[1] ?? '';
    const response = await fetch(path, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return response.status === 204 ? null : response.json();
  }, { method, path, body });
}

async function forgetRatingAndPlaylist(page: Page) {
  await send(page, 'POST', TRACK_ADDRESS, { action: 'set_rating', rating: 0 });
  const listed = (await send(page, 'GET', '/api/playlist/smart/')) as { data: { id: number; name: string }[] };
  for (const playlist of listed.data.filter((candidate) => candidate.name === PLAYLIST_NAME)) {
    await send(page, 'DELETE', `/api/playlist/smart/${playlist.id}/`);
  }
}

async function open(browser: Browser, path: string): Promise<Page> {
  const context = await browser.newContext({ storageState: signedIn, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.addLocatorHandler(page.getByRole('dialog', { name: 'Continue Listening?' }), async (dialog) => {
    await dialog.getByRole('button', { name: 'Not Now' }).click();
  });
  await page.goto(path);
  await forgetRatingAndPlaylist(page);
  await page.reload();
  return page;
}

async function close(page: Page) {
  await forgetRatingAndPlaylist(page);
  await page.context().close();
}

const sampleRow = (page: Page) => page.getByTestId('track-row').filter({ hasText: E2E_TRACK_TITLE });
const stars = (scope: Page | Locator) => scope.getByTestId('track-rating');
const star = (scope: Page | Locator, position: number) => stars(scope).locator('label').nth(position - 1);

async function openMenuOfSample(page: Page) {
  await sampleRow(page).getByRole('button', { name: 'More actions' }).click();
  await expect(stars(page)).toBeVisible();
}

test('a smart playlist of tracks rated four or more follows the rating', async ({ browser }) => {
  const page = await open(browser, '/library');

  await openMenuOfSample(page);
  await expect(stars(page)).toHaveAttribute('data-rating', UNRATED);
  await star(page, 4).click();
  await expect(stars(page)).toHaveAttribute('data-rating', '4');

  await page.goto('/smart-playlists');
  await page.getByRole('button', { name: /^Create/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Create Smart Playlist' });
  await dialog.getByLabel('Name').fill(PLAYLIST_NAME);
  await dialog.getByLabel(TOP_RATED_PRESET).check();
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();

  await expect(page).toHaveURL(/\/smart-playlist\/\d+/);
  await expect(sampleRow(page)).toBeVisible();

  await openMenuOfSample(page);
  await expect(stars(page)).toHaveAttribute('data-rating', '4');
  await star(page, 3).click();
  await expect(stars(page)).toHaveAttribute('data-rating', '3');

  await page.reload();
  await expect(page.getByText('No tracks match the rules')).toBeVisible();
  await expect(sampleRow(page)).toHaveCount(0);

  await page.goto('/smart-playlists');
  await expect(page.locator('.MuiCard-root').filter({ hasText: PLAYLIST_NAME })).toContainText(/\D0 tracks$/);

  await close(page);
});

test('the rating is kept, and choosing the same star again takes it away', async ({ browser }) => {
  const page = await open(browser, '/library');

  await openMenuOfSample(page);
  await star(page, 5).click();
  await expect(stars(page)).toHaveAttribute('data-rating', '5');

  await page.reload();
  await openMenuOfSample(page);
  await expect(stars(page)).toHaveAttribute('data-rating', '5');

  await star(page, 5).click();
  await expect(stars(page)).toHaveAttribute('data-rating', UNRATED);
  await page.reload();
  await openMenuOfSample(page);
  await expect(stars(page)).toHaveAttribute('data-rating', UNRATED);

  await close(page);
});

test('the keyboard can rate from the track menu', async ({ browser }) => {
  const page = await open(browser, '/library');

  await openMenuOfSample(page);
  const ratingRow = page.getByRole('menuitem', { name: /^Rating:/ });
  await ratingRow.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(ratingRow).toHaveAccessibleName('Rating: 2 stars');
  await page.keyboard.press('ArrowLeft');
  await expect(ratingRow).toHaveAccessibleName('Rating: 1 star');

  await close(page);
});

test('stars the server did not keep are put back', async ({ browser }) => {
  const page = await open(browser, '/library');
  await page.route(`**${TRACK_ADDRESS}`, (route) =>
    route.request().method() === 'POST' ? route.fulfill({ status: 500, body: '{}' }) : route.fallback());

  await openMenuOfSample(page);
  const refused = page.waitForResponse((response) => response.url().endsWith(TRACK_ADDRESS) && response.status() === 500);
  await star(page, 4).click();
  await refused;

  await expect(stars(page)).toHaveAttribute('data-rating', UNRATED);

  await page.unroute(`**${TRACK_ADDRESS}`);
  await close(page);
});

test('the playing track can be rated from its details', async ({ browser }) => {
  const page = await open(browser, '/library');

  await sampleRow(page).click();
  await expect(page.getByTestId('player-playpause')).toBeVisible(PLAYER_READY);
  await page.getByTitle('Click to toggle lyrics').first().click();
  await page.getByRole('button', { name: 'Details' }).click();

  await expect(stars(page)).toHaveAttribute('data-rating', UNRATED);
  await star(page, 2).click();
  await expect(stars(page)).toHaveAttribute('data-rating', '2');

  await page.reload();
  await openMenuOfSample(page);
  await expect(stars(page)).toHaveAttribute('data-rating', '2');

  await close(page);
});
