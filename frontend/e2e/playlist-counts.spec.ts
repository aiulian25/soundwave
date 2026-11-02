import { test, expect, Page } from '@playwright/test';

// The API is stubbed, so this exercises the browser side alone and uses no real login:
// logins are rate limited across the whole suite. Workers are blocked so every request
// reaches page.route.
const STUB_ACCOUNT = { id: 1, username: 'stub', email: 'stub@example.test', password_change_required: false };
const PLAYLIST_ID = 'PLstubcounts';
const PLAYLIST = {
  id: 1,
  playlist_id: PLAYLIST_ID,
  title: 'Counted playlist',
  description: '',
  channel_name: 'Someone',
  thumbnail_url: '',
  subscribed: true,
  playlist_type: 'youtube',
  // Local memberships. The labelled total must come from remote_total instead.
  item_count: 40,
  remote_total: 100,
  local_available: 40,
  downloaded_count: 40,
  remote_unavailable_count: 3,
  pending: 7,
  failed: 2,
  progress_percent: 41,
  last_refresh: null,
  sync_status: 'stale',
  status_display: 'Stale',
  error_message: '',
  active: true,
  items: [],
};

async function stubApi(page: Page) {
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.pathname === '/api/user/account/') return json(STUB_ACCOUNT);
    if (url.pathname === '/api/user/config/') return json({ extra_settings: {} });
    if (url.pathname === '/api/playlist/') return json({ data: [PLAYLIST], next: null });
    if (url.pathname === `/api/playlist/${PLAYLIST_ID}/`) return json(PLAYLIST);
    return json({ data: [] });
  });
}

async function openSignedIn(browser: import('@playwright/test').Browser, path: string) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  await stubApi(page);
  await page.goto(path);
  return { context, page };
}

test('the playlist page labels remote, local and outstanding counts separately', async ({ browser }) => {
  const { context, page } = await openSignedIn(browser, `/playlists/${PLAYLIST_ID}`);

  const statValue = (label: string) => page.getByText(label, { exact: true }).locator('xpath=following-sibling::*[1]');
  await expect(statValue('Total Tracks')).toHaveText('100');
  await expect(statValue('Downloaded')).toHaveText('40');
  await expect(statValue('Pending')).toHaveText('7');
  await expect(statValue('Failed')).toHaveText('2');
  await expect(statValue('Unavailable on YouTube')).toHaveText('3');
  await expect(page.getByRole('progressbar').first()).toHaveAttribute('aria-valuenow', '41');

  await context.close();
});

test('the playlist card shows local tracks out of the remote total', async ({ browser }) => {
  const { context, page } = await openSignedIn(browser, '/playlists');

  await expect(page.getByText('40/100')).toBeVisible();

  await context.close();
});
