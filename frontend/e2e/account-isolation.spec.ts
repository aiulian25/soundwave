import { test, expect, Page } from '@playwright/test';
import { E2E_SECOND_USERNAME, E2E_USERNAME, login } from './helpers';

const IMPORTED_TITLE = 'a-private-import';
const LEGACY_TITLE = 'Unclaimed Legacy Track';
const ACCOUNT_API = '/api/user/account/';
const SENSITIVE_API = '/api/user/api-keys/';
const LEGACY_DB = 'SoundWaveLocalAudio';
const LEGACY_STORE = 'audioFiles';

function silentWav(): Buffer {
  const dataSize = 800;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(8000, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, Buffer.alloc(dataSize, 128)]);
}

async function importFile(page: Page) {
  await page.goto('/local-files');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Select Files' }).click();
  await (await chooser).setFiles({ name: `${IMPORTED_TITLE}.wav`, mimeType: 'audio/wav', buffer: silentWav() });
  await expect(page.getByText(IMPORTED_TITLE).first()).toBeVisible({ timeout: 20_000 });
}

/** Text of a response in Cache Storage, or null when no cache holds it. */
const cachedBody = (page: Page, path: string) =>
  page.evaluate(async (url) => {
    // ignoreVary: otherwise a differing request header would read as "not cached" and let
    // the absence checks below pass for the wrong reason.
    const cached = await caches.match(url, { ignoreVary: true });
    return cached ? cached.text() : null;
  }, path);

/** Fetch through the controlling service worker, so the response lands in its cache. */
async function fetchThroughWorker(page: Page, path: string) {
  await page.evaluate(async (url) => {
    await navigator.serviceWorker.ready;
    await fetch(url, { credentials: 'include' });
  }, path);
}

async function reloadUnderWorker(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

const seedLegacyImport = (page: Page) =>
  page.evaluate(
    ([name, store, title]) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(store, { keyPath: 'id' });
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const transaction = request.result.transaction([store], 'readwrite');
          transaction.objectStore(store).put({
            id: 'legacy-1', title, artist: 'Nobody', album: '', year: null, genre: '', duration: 1,
            fileName: 'legacy.wav', fileSize: 1, mimeType: 'audio/wav', addedDate: new Date(), playCount: 0,
          });
          transaction.oncomplete = () => {
            request.result.close();
            resolve();
          };
        };
      }),
    [LEGACY_DB, LEGACY_STORE, LEGACY_TITLE],
  );

const logoutButton = (page: Page) => page.getByTestId('topbar-logout');

// One flow on purpose: logins are rate limited to 10 a minute across the whole suite.
test('accounts sharing a browser cannot see each other, and logout always finishes', async ({
  page,
  context,
  browser,
}) => {
  await test.step('A imports a file and fills the caches', async () => {
    await login(page, E2E_USERNAME);
    await reloadUnderWorker(page);
    await importFile(page);
    await fetchThroughWorker(page, ACCOUNT_API);
    await fetchThroughWorker(page, SENSITIVE_API);
    await expect.poll(() => cachedBody(page, ACCOUNT_API)).toContain(E2E_USERNAME);
    expect(await cachedBody(page, SENSITIVE_API)).toBeNull();
  });
  const accountACookies = await context.cookies();

  await test.step('A session expires without a logout, then B signs in', async () => {
    await context.clearCookies();
    await login(page, E2E_SECOND_USERNAME);
    await expect.poll(async () => (await cachedBody(page, ACCOUNT_API)) ?? '').not.toContain(`"${E2E_USERNAME}"`);
    await page.goto('/local-files');
    await expect(page.getByRole('button', { name: 'Select Files' })).toBeVisible();
    await expect(page.getByText(IMPORTED_TITLE)).toHaveCount(0);
  });
  const accountBCookies = await context.cookies();

  await test.step('old imports are only added after someone explicitly claims them', async () => {
    await seedLegacyImport(page);
    await page.reload();
    await expect(page.getByTestId('local-files-unclaimed')).toBeVisible();
    await expect(page.getByText(LEGACY_TITLE)).toHaveCount(0);
    await page.getByTestId('local-files-claim').click();
    await expect(page.getByText(LEGACY_TITLE).first()).toBeVisible();
    await page.reload();
    await expect(page.getByText(LEGACY_TITLE).first()).toBeVisible();
    await expect(page.getByTestId('local-files-unclaimed')).toHaveCount(0);
  });

  await test.step('returning to A brings back only A imports', async () => {
    await context.clearCookies();
    await context.addCookies(accountACookies);
    await page.goto('/local-files');
    await expect(page.getByText(IMPORTED_TITLE).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(LEGACY_TITLE)).toHaveCount(0);
  });

  await test.step('logout finishes with no service worker at all', async () => {
    const storageState = await context.storageState();
    const blockedContext = await browser.newContext({ serviceWorkers: 'block', storageState });
    const blockedPage = await blockedContext.newPage();
    await blockedPage.goto('/');
    await logoutButton(blockedPage).click();
    await expect(blockedPage.getByTestId('login-submit')).toBeVisible({ timeout: 5_000 });
    await blockedContext.close();
  });

  await test.step('logging out in one tab signs the other tab out', async () => {
    await context.clearCookies();
    await context.addCookies(accountBCookies);
    await page.goto('/');
    await expect(logoutButton(page)).toBeVisible();
    const otherTab = await context.newPage();
    await otherTab.goto('/');
    await expect(logoutButton(otherTab)).toBeVisible();
    await logoutButton(page).click();
    await expect(page.getByTestId('login-submit')).toBeVisible({ timeout: 10_000 });
    await expect(otherTab.getByTestId('login-submit')).toBeVisible({ timeout: 15_000 });
    expect(await cachedBody(page, ACCOUNT_API)).toBeNull();
  });
});
