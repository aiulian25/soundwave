import { test, expect, Browser, Page } from '@playwright/test';
import { login, SW_PINNED_AUDIO_CACHE } from './helpers';

// Getting around should take no thought: the main places one tap away on a phone, one button
// for one thing, and nothing lost by a stray tap. Sign-in is rate limited, so the file signs in
// once and every test reuses that session.
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

type SignedInState = Awaited<ReturnType<Awaited<ReturnType<Browser['newContext']>>['storageState']>>;
let signedIn: SignedInState;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  await login(await context.newPage());
  signedIn = await context.storageState();
  await context.close();
});

async function signedInPage(browser: Browser, viewport: { width: number; height: number }, path = '/'): Promise<Page> {
  const context = await browser.newContext({ storageState: signedIn, viewport });
  const page = await context.newPage();
  await page.addLocatorHandler(page.getByRole('dialog', { name: 'Continue Listening?' }), async (dialog) => {
    await dialog.getByRole('button', { name: 'Not Now' }).click();
  });
  await page.goto(path);
  await expect(page.getByTestId('add-music')).toBeVisible({ timeout: 20_000 });
  return page;
}

test('on a phone the four main places are one tap away', async ({ browser }) => {
  const page = await signedInPage(browser, PHONE);
  const bottomBar = page.getByTestId('bottom-nav');

  await expect(bottomBar.getByRole('button')).toHaveText(['Home', 'Search', 'Library', 'Playlists']);
  await bottomBar.getByRole('button', { name: 'Library' }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();

  await bottomBar.getByRole('button', { name: 'Playlists' }).click();
  await expect(page).toHaveURL(/\/playlists$/);
  const pageScrollsSideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(pageScrollsSideways).toBe(false);
});

test('on a wide screen the sidebar does that job and the bottom bar is gone', async ({ browser }) => {
  const page = await signedInPage(browser, DESKTOP);

  await expect(page.getByTestId('bottom-nav')).toBeHidden();
  for (const group of ['Listen', 'Sources', 'More']) {
    await expect(page.getByRole('list', { name: group })).toBeVisible();
  }
  await expect(page.getByRole('list', { name: 'Listen' }).getByRole('button')).toHaveText([
    'Home', 'Search', 'Library', 'Favorites', 'Playlists', 'Smart Playlists',
  ]);
});

test('the four listening-statistics pages share one sidebar entry and a row of tabs', async ({ browser }) => {
  const page = await signedInPage(browser, DESKTOP);
  const statsEntry = page.getByRole('list', { name: 'More' }).getByRole('button', { name: 'Stats' });
  for (const former of ['History', 'Analytics', 'Achievements', 'Yearly Wrapped']) {
    await expect(page.getByRole('list', { name: 'More' }).getByRole('button', { name: former })).toHaveCount(0);
  }

  await statsEntry.click();
  const tabs = page.getByTestId('stats-tabs').getByRole('tab');
  await expect(tabs).toHaveText(['Analytics', 'History', 'Achievements', 'Yearly Wrapped']);
  await expect(page).toHaveURL(/\/analytics$/);

  await tabs.filter({ hasText: 'History' }).click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(tabs.filter({ hasText: 'History' })).toHaveAttribute('aria-selected', 'true');
  await expect(statsEntry).toHaveClass(/Mui-selected/);
});

test('the top bar has one button for adding, one for activity and one for logging out', async ({ browser }) => {
  const page = await signedInPage(browser, PHONE);

  const actionButtons = page.locator('header').getByRole('button').filter({ hasNot: page.locator('[data-testid="MenuIcon"]') });

  await expect(actionButtons).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Download activity' })).toHaveCount(1);
});

test('logging out asks first when it would remove music saved for offline listening', async ({ browser }) => {
  const page = await signedInPage(browser, DESKTOP);
  await page.evaluate(async (cacheName) => {
    const cache = await caches.open(cacheName);
    await cache.put('/api/audio/offline-one/download/', new Response('saved', { status: 200 }));
  }, SW_PINNED_AUDIO_CACHE);

  await page.getByTestId('topbar-logout').click();
  const question = page.getByTestId('confirm-dialog');
  await expect(question).toContainText('1 track saved for offline listening will be removed from this device.');
  await question.getByRole('button', { name: 'Cancel' }).click();

  await expect(question).toBeHidden();
  await expect(page.getByTestId('add-music')).toBeVisible();
  const stillSaved = await page.evaluate(async (cacheName) => (await (await caches.open(cacheName)).keys()).length, SW_PINNED_AUDIO_CACHE);
  expect(stillSaved).toBe(1);
});
