import { test, expect, Browser, Page } from '@playwright/test';
import { login } from './helpers';

// One place adds anything: a track, a playlist or a channel. The requests that would start real
// downloads are answered here, so the suite never fetches anything from YouTube. Sign-in is
// rate limited, so the whole file signs in once and every test reuses that session.
const VIDEO_LINK = 'https://www.youtube.com/watch?v=e2eAddMusic1';
const PLAYLIST_LINK = 'https://www.youtube.com/playlist?list=PLe2eAddMusic';
const CHANNEL_LINK = 'https://www.youtube.com/@e2eAddMusic';
const VIDEO_IN_PLAYLIST_LINK = `${VIDEO_LINK}&list=PLe2eAddMusic&index=2`;
const QUOTA_MESSAGE = 'Your storage quota is used up.';

interface SentRequest {
  path: string;
  body: unknown;
}

/** Answers the three "add" requests and records them; everything else reaches the server. */
async function answerAddRequests(page: Page, status = 201, responseBody: unknown = [{ status: 'pending' }]) {
  const sent: SentRequest[] = [];
  for (const path of ['/api/download/', '/api/playlist/', '/api/channel/']) {
    await page.route(`**${path}`, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      sent.push({ path, body: route.request().postDataJSON() });
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(responseBody) });
    });
  }
  return sent;
}

type SignedInState = Awaited<ReturnType<Awaited<ReturnType<Browser['newContext']>>['storageState']>>;
let signedIn: SignedInState;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  await login(await context.newPage());
  signedIn = await context.storageState();
  await context.close();
});

async function signedInPage(browser: Browser, path = '/'): Promise<Page> {
  const context = await browser.newContext({ storageState: signedIn });
  const page = await context.newPage();
  await page.addLocatorHandler(page.getByRole('dialog', { name: 'Continue Listening?' }), async (dialog) => {
    await dialog.getByRole('button', { name: 'Not Now' }).click();
  });
  await page.goto(path);
  return page;
}

async function openDialogWith(page: Page, text: string) {
  await page.getByTestId('add-music').click();
  await page.getByTestId('add-music-link').fill(text);
}

test('a pasted video link is sent to the download queue', async ({ browser }) => {
  const page = await signedInPage(browser);
  const sent = await answerAddRequests(page);

  await openDialogWith(page, VIDEO_LINK);
  await expect(page.getByText('One track. It downloads to your library.')).toBeVisible();
  await page.getByTestId('add-music-submit').click();

  await expect(page.getByTestId('add-music-outcome')).toContainText('Added.');
  await expect(page.getByTestId('add-music-dialog')).toBeHidden();
  expect(sent).toEqual([{ path: '/api/download/', body: { urls: [VIDEO_LINK], auto_start: true } }]);
});

test('a track that is already downloaded is reported as such', async ({ browser }) => {
  const page = await signedInPage(browser);
  await answerAddRequests(page, 201, [{ status: 'completed' }]);

  await openDialogWith(page, VIDEO_LINK);
  await page.getByTestId('add-music-link').press('Enter');

  await expect(page.getByTestId('add-music-outcome')).toContainText('already in your library');
});

test('playlist and channel links subscribe instead of downloading', async ({ browser }) => {
  const page = await signedInPage(browser);
  const sent = await answerAddRequests(page, 201, {});

  for (const link of [PLAYLIST_LINK, CHANNEL_LINK]) {
    await openDialogWith(page, link);
    await expect(page.getByTestId('add-music-submit')).toHaveText('Subscribe');
    await page.getByTestId('add-music-submit').click();
    await expect(page.getByTestId('add-music-dialog')).toBeHidden();
  }

  expect(sent).toEqual([
    { path: '/api/playlist/', body: { url: PLAYLIST_LINK } },
    { path: '/api/channel/', body: { url: CHANNEL_LINK } },
  ]);
});

test('a video opened inside a playlist offers the track or the whole playlist', async ({ browser }) => {
  const page = await signedInPage(browser);
  const sent = await answerAddRequests(page, 201, {});

  await openDialogWith(page, VIDEO_IN_PLAYLIST_LINK);
  await expect(page.getByTestId('add-music-submit')).toHaveText('Download');
  await page.getByTestId('add-music-subscribe-playlist').click();

  await expect(page.getByTestId('add-music-outcome')).toContainText('Subscribed.');
  expect(sent).toEqual([{ path: '/api/playlist/', body: { url: PLAYLIST_LINK } }]);
});

test('words that are not a link cannot be sent', async ({ browser }) => {
  const page = await signedInPage(browser);
  const sent = await answerAddRequests(page);

  await openDialogWith(page, 'my favourite song');

  await expect(page.getByText('This does not look like a link.')).toBeVisible();
  await expect(page.getByTestId('add-music-submit')).toBeDisabled();
  await page.getByTestId('add-music-link').press('Enter');
  expect(sent).toEqual([]);
});

test('a refused link keeps the dialog open and says why', async ({ browser }) => {
  const page = await signedInPage(browser);
  await answerAddRequests(page, 400, { urls: { 0: ['Enter a valid URL.'] } });
  await openDialogWith(page, VIDEO_LINK);
  await page.getByTestId('add-music-submit').click();
  await expect(page.getByRole('alert')).toContainText('This link could not be added.');
  await expect(page.getByTestId('add-music-link')).toHaveValue(VIDEO_LINK);

  await page.unrouteAll();
  await answerAddRequests(page, 403, { detail: QUOTA_MESSAGE });
  await page.getByTestId('add-music-submit').click();
  await expect(page.getByRole('alert')).toContainText(QUOTA_MESSAGE);
});

test('a link shared from another app opens the dialog with it filled in', async ({ browser }) => {
  const sharedText = encodeURIComponent(`Listen to this ${VIDEO_LINK}`);

  const page = await signedInPage(browser, `/share?title=${encodeURIComponent('A Song')}&text=${sharedText}`);

  await expect(page.getByTestId('add-music-link')).toHaveValue(VIDEO_LINK);
  await expect(page).toHaveURL(/\/$/);
});

test('an empty library says how to add the first track', async ({ browser }) => {
  const context = await browser.newContext({ storageState: signedIn });
  const page = await context.newPage();
  await page.route('**/api/audio/list/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], next: null }) }));
  await page.goto('/library');

  await expect(page.getByTestId('library-empty')).toContainText('Your library is empty');
  await page.getByTestId('empty-add-music').click();

  await expect(page.getByTestId('add-music-link')).toBeFocused();
});
