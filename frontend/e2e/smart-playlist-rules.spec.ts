import { test, expect, Page } from '@playwright/test';

// The API is stubbed, so this exercises the browser side alone and uses no real login:
// logins are rate limited across the whole suite. Workers are blocked so every request
// reaches page.route.
const STUB_ACCOUNT = { id: 1, username: 'stub', email: 'stub@example.test', password_change_required: false };
const PLAYLIST_ID = 7;
const SEED = 4242;
const CHOICES = {
  fields: [{ value: 'year', label: 'Year' }],
  operators: [{ value: 'greater_than', label: 'Greater than' }],
  order_by_options: [{ value: 'random', label: 'Random' }],
  field_types: { year: 'numeric' },
  operator_groups: { numeric: ['greater_than'] },
};
const RULE = { id: 1, field: 'year', operator: 'greater_than', value: '1990', value_2: '', order: 0 };
const summary = (invalidRuleIds: number[]) => ({
  id: PLAYLIST_ID, name: 'Stub smart', description: '', icon: 'auto_awesome', color: '#7C3AED', is_system: false, invalid_rule_ids: invalidRuleIds,
});
const track = (id: number) => ({ id, youtube_id: `stub${id}`, title: `Track ${id}`, channel_name: 'x', duration: 60, file_path: 'a.m4a' });

async function stubApi(page: Page, invalidRuleIds: number[] = []) {
  const seedsByPage = new Map<number, string | null>();
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.pathname === '/api/user/account/') return json(STUB_ACCOUNT);
    if (url.pathname === '/api/user/config/') return json({ extra_settings: {} });
    if (url.pathname === '/api/playlist/smart/choices/') return json(CHOICES);
    if (url.pathname === `/api/playlist/smart/${PLAYLIST_ID}/tracks/`) {
      const pageNumber = Number(url.searchParams.get('page'));
      seedsByPage.set(pageNumber, url.searchParams.get('seed'));
      return json({
        data: [track(pageNumber)],
        playlist: summary(invalidRuleIds),
        next: pageNumber < 3 ? pageNumber + 1 : null,
        seed: SEED,
      });
    }
    if (url.pathname === `/api/playlist/smart/${PLAYLIST_ID}/`) {
      if (route.request().method() === 'PUT') return json({ rules: { 0: { value: ['whole_number_required'] } } }, 400);
      return json({ ...summary(invalidRuleIds), match_mode: 'all', order_by: 'random', limit: null, rules: [RULE] });
    }
    return json({ data: [] });
  });
  return { seedsByPage };
}

async function openPlaylist(browser: import('@playwright/test').Browser, invalidRuleIds: number[] = []) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const stub = await stubApi(page, invalidRuleIds);
  await page.goto(`/smart-playlist/${PLAYLIST_ID}`);
  return { context, page, ...stub };
}

test('every page of a random playlist is walked with the seed the server chose', async ({ browser }) => {
  const { context, page, seedsByPage } = await openPlaylist(browser);

  await expect(page.getByText('Track 3')).toBeVisible();
  await expect(page.getByText('Track 1')).toBeVisible();
  expect(seedsByPage.get(1)).toBeNull();
  expect(seedsByPage.get(2)).toBe(String(SEED));
  expect(seedsByPage.get(3)).toBe(String(SEED));

  await context.close();
});

test('a rejected save shows the error on the rule and keeps the edit', async ({ browser }) => {
  const { context, page } = await openPlaylist(browser);

  await page.getByRole('button', { name: 'Edit Rules' }).first().click();
  const value = page.getByLabel('Value');
  await value.fill('not a year');
  await page.getByRole('button', { name: 'Save Rules' }).click();

  await expect(page.getByText('Enter a whole number')).toBeVisible();
  await expect(value).toHaveValue('not a year');

  await context.close();
});

test('a stored rule that needs repair is flagged', async ({ browser }) => {
  const { context, page } = await openPlaylist(browser, [RULE.id]);

  await expect(page.getByText('needs fixing', { exact: false })).toBeVisible();

  await context.close();
});
