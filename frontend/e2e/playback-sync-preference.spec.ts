import { test, expect, Page } from '@playwright/test';

// The API is stubbed, so this exercises the browser side alone and spends none of the
// suite's login rate limit. Workers are blocked so every request reaches page.route.
const STUB_ACCOUNT = { id: 1, username: 'stub', email: 'stub@example.test', password_change_required: false };
const STUB_SESSION = {
  youtube_id: 'stubA',
  position: 30,
  duration: 100,
  queue_youtube_ids: ['stubB', 'stubA'],
  queue_index: 1,
  device_name: 'Elsewhere',
  seconds_since_update: 60,
  audio_details: { id: 1, youtube_id: 'stubA', title: 'Stub Track', channel_name: 'C', artist: 'C', duration: 100 },
};

async function stubApi(page: Page, playbackSyncEnabled: boolean) {
  const syncRequests: string[] = [];
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.pathname.startsWith('/api/playback-sync/')) {
      syncRequests.push(`${route.request().method()} ${url.pathname}`);
      return json({ has_session: true, session: STUB_SESSION });
    }
    if (url.pathname === '/api/user/account/') return json(STUB_ACCOUNT);
    if (url.pathname === '/api/user/config/') {
      return json({ extra_settings: {}, playback_sync_enabled: playbackSyncEnabled });
    }
    return json({ data: [], next: null });
  });
  return syncRequests;
}

for (const [label, enabled] of [['disabled', false], ['enabled', true]] as const) {
  test(`loading the app with sync ${label}`, async ({ browser }) => {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    const syncRequests = await stubApi(page, enabled);

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.reload();
    await page.waitForLoadState('networkidle');

    const dialogTitle = page.getByText('Continue Listening?');
    if (enabled) {
      await expect(dialogTitle).toBeVisible();
      expect(syncRequests.length).toBeGreaterThan(0);
    } else {
      await expect(dialogTitle).toHaveCount(0);
      expect(syncRequests).toEqual([]);
    }
    await context.close();
  });
}
