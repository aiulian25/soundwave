import { test, expect, Browser, Page } from '@playwright/test';
import { login } from './helpers';

// An expired YouTube sign-in should be visible before a queue of downloads fails one by one.
// The state comes from the server; these tests set it to see what the app does with each answer.
// Sign-in is rate limited, so the file signs in once and every test reuses that session.
type SignedInState = Awaited<ReturnType<Awaited<ReturnType<Browser['newContext']>>['storageState']>>;
let signedIn: SignedInState;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  await login(await context.newPage());
  signedIn = await context.storageState();
  await context.close();
});

async function openWithCookieState(browser: Browser, path: string, answer: { state: string | null }): Promise<Page> {
  const context = await browser.newContext({ storageState: signedIn });
  const page = await context.newPage();
  await page.addLocatorHandler(page.getByRole('dialog', { name: 'Continue Listening?' }), async (dialog) => {
    await dialog.getByRole('button', { name: 'Not Now' }).click();
  });
  await page.route('**/api/download/cookie-health/', (route) =>
    answer.state === null
      ? route.fallback()
      : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: answer.state }) }));
  await page.goto(path);
  return page;
}

const notice = (page: Page) => page.getByTestId('cookie-health');
const openActivity = (page: Page) => page.getByRole('button', { name: 'Download activity' }).click();

test('the activity panel says once that new cookies are needed, and stops after a download succeeds', async ({ browser }) => {
  const answer = { state: 'needs_new_cookies' };
  const page = await openWithCookieState(browser, '/', answer);

  await openActivity(page);
  await expect(notice(page)).toHaveCount(1);
  await expect(notice(page)).toContainText('YouTube sign-in: needs new cookies');
  await expect(notice(page)).toContainText('Replace cookies.txt on the server with a fresh export');

  answer.state = 'working';
  await page.getByRole('button', { name: 'Refresh' }).click();

  await expect(notice(page)).toHaveCount(0);
});

test('the activity panel stays quiet while sign-in works or is not known', async ({ browser }) => {
  for (const state of ['working', 'unknown']) {
    const page = await openWithCookieState(browser, '/', { state });
    await openActivity(page);

    await expect(page.getByText('No download activity').or(page.getByText('Completed')).first()).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
    await page.context().close();
  }
});

test('a cookies file the server cannot use is explained differently', async ({ browser }) => {
  const page = await openWithCookieState(browser, '/', { state: 'file_not_accessible' });

  await openActivity(page);

  await expect(notice(page)).toContainText('cookies.txt cannot be used');
  await expect(notice(page)).toContainText('chmod 600');
});

test('settings always shows the state of the YouTube sign-in', async ({ browser }) => {
  const working = await openWithCookieState(browser, '/settings', { state: 'working' });
  await expect(notice(working)).toContainText('YouTube sign-in: working');
  await expect(notice(working)).toHaveAttribute('data-state', 'working');

  const expired = await openWithCookieState(browser, '/settings', { state: 'needs_new_cookies' });
  await expect(notice(expired)).toContainText('YouTube sign-in: needs new cookies');
});

test('the real server answers for an account that has downloaded nothing yet', async ({ browser }) => {
  const page = await openWithCookieState(browser, '/settings', { state: null });

  await expect(notice(page)).toContainText('YouTube sign-in:');
  await expect(notice(page)).toHaveAttribute('data-state', /^(unknown|working)$/);
});
