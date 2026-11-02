import { test, expect, Page, Route } from '@playwright/test';

// The API is stubbed, so this exercises the browser side alone and uses no real login:
// logins are rate limited across the whole suite. Workers are blocked so every request
// reaches page.route.
const FIRST_QUERY = 'alpha';
const SECOND_QUERY = 'beta';
const STUB_ACCOUNT = { id: 1, username: 'stub', email: 'stub@example.test', password_change_required: false };
const TOTAL_MATCHES = 120;
const PAGE_SIZE = 50;

const audioRow = (query: string, index: number) => ({
  id: index + 1, youtube_id: `${query}${index}`, title: `${query} track ${index}`, channel_name: 'x', file_path: 'a.m4a',
});

function audioPage(query: string, page: number) {
  const start = (page - 1) * PAGE_SIZE;
  const rows = Array.from({ length: Math.min(PAGE_SIZE, TOTAL_MATCHES - start) }, (_, index) => audioRow(query, start + index));
  return { data: rows, count: TOTAL_MATCHES, page, next: start + PAGE_SIZE < TOTAL_MATCHES ? page + 1 : null };
}

interface Stubs {
  audioRequests: Array<{ q: string | null; page: string | null }>;
  held: Route[];
  holding: boolean;
  failing: boolean;
}

async function stubApi(page: Page): Promise<Stubs> {
  const stubs: Stubs = { audioRequests: [], held: [], holding: false, failing: false };
  // By path, not a glob: `**/api/**` would also catch the app's own /src/api/client.ts.
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.pathname === '/api/user/account/') return json(STUB_ACCOUNT);
    if (url.pathname === '/api/user/config/') return json({ extra_settings: {}, playback_sync_enabled: false });
    if (url.pathname === '/api/audio/list/') {
      stubs.audioRequests.push({ q: url.searchParams.get('q'), page: url.searchParams.get('page') });
      if (stubs.failing) return route.fulfill({ status: 500, body: '{}' });
      if (stubs.holding) {
        stubs.held.push(route);
        return undefined;
      }
      return json(audioPage(url.searchParams.get('q') ?? '', Number(url.searchParams.get('page'))));
    }
    if (url.pathname === '/api/channel/') return json({ data: [], count: 0, next: null });
    if (url.pathname === '/api/playlist/') return json({ data: [] });
    return json({ data: [] });
  });
  return stubs;
}

async function openSearch(browser: import('@playwright/test').Browser) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const aborted: string[] = [];
  page.on('requestfailed', (request) => aborted.push(request.url()));
  const stubs = await stubApi(page);
  await page.goto('/search');
  const searchBox = page.getByRole('textbox').first();
  await expect(searchBox).toBeVisible({ timeout: 20_000 });
  return { context, page, stubs, aborted, searchBox };
}

test('opening search loads nothing, and a search asks for one page of matches', async ({ browser }) => {
  const { context, page, stubs, searchBox } = await openSearch(browser);
  await page.waitForTimeout(800);
  expect(stubs.audioRequests).toEqual([]);

  await searchBox.fill(FIRST_QUERY);

  await expect(page.getByText(`${FIRST_QUERY} track 0`).first()).toBeVisible();
  expect(stubs.audioRequests).toEqual([{ q: FIRST_QUERY, page: '1' }]);

  await context.close();
});

test('the latest search wins, and a late answer to the old one changes nothing', async ({ browser }) => {
  const { context, page, stubs, aborted, searchBox } = await openSearch(browser);

  stubs.holding = true;
  await searchBox.fill(FIRST_QUERY);
  await expect.poll(() => stubs.held.length).toBe(1);

  stubs.holding = false;
  await searchBox.fill(SECOND_QUERY);

  await expect(page.getByText(`${SECOND_QUERY} track 0`).first()).toBeVisible();
  await expect.poll(() => aborted.filter((url) => url.includes('/api/audio/list/')).length).toBe(1);

  await stubs.held[0]
    .fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(audioPage(FIRST_QUERY, 1)) })
    .catch(() => undefined);
  await expect(page.getByText(`${FIRST_QUERY} track 0`)).toHaveCount(0);

  await context.close();
});

test('more results load on request, continuing the same search', async ({ browser }) => {
  const { context, page, stubs, searchBox } = await openSearch(browser);
  await searchBox.fill(FIRST_QUERY);
  await expect(page.getByText(`${FIRST_QUERY} track 0`).first()).toBeVisible();

  await page.getByRole('tab', { name: /Songs/ }).click();
  await page.getByRole('button', { name: 'Load more' }).click();

  await expect(page.getByText(`${FIRST_QUERY} track 50`)).toBeVisible();
  expect(stubs.audioRequests).toEqual([{ q: FIRST_QUERY, page: '1' }, { q: FIRST_QUERY, page: '2' }]);

  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(page.getByText(`${FIRST_QUERY} track 119`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);

  await context.close();
});

test('a failed search says so instead of looking like no results', async ({ browser }) => {
  const { context, page, stubs, searchBox } = await openSearch(browser);
  stubs.failing = true;

  await searchBox.fill(FIRST_QUERY);

  await expect(page.getByRole('alert')).toContainText('Search failed');
  await expect(page.getByText('No results found')).toBeHidden();

  await context.close();
});
