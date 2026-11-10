import { test, expect, Page } from '@playwright/test';

// The API is stubbed, so this exercises the dialogs alone and uses no real login.
const STUB_ACCOUNT = { id: 1, username: 'stub', email: 'stub@example.test', password_change_required: false };
const PLAYLIST_ID = 'PLexport';
const ITEM = {
  id: 1, position: 0, added_date: '2026-01-01T00:00:00Z',
  audio: { id: 1, youtube_id: 'stubExport', title: 'Export track', channel_name: 'x', duration: 60, file_path: 'a.mp3' },
};
const PLAYLIST = {
  id: 2, playlist_id: PLAYLIST_ID, title: 'Exportable', description: '', channel_name: 'x', thumbnail_url: '',
  subscribed: true, playlist_type: 'youtube', item_count: 1, remote_total: 1, downloaded_count: 1, progress_percent: 100,
  last_refresh: null, sync_status: 'success', status_display: 'Success', error_message: '', active: true, items: [ITEM],
};

async function openExportDialog(browser: import('@playwright/test').Browser, answer: Parameters<import('@playwright/test').Route['fulfill']>[0]) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page: Page = await context.newPage();
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.pathname === '/api/user/account/') return json(STUB_ACCOUNT);
    if (url.pathname === '/api/user/config/') return json({ extra_settings: {}, playback_sync_enabled: false });
    if (url.pathname === `/api/playlist/${PLAYLIST_ID}/export/`) return route.fulfill(answer);
    if (url.pathname === `/api/playlist/${PLAYLIST_ID}/`) return json(PLAYLIST);
    if (url.pathname === `/api/playlist/${PLAYLIST_ID}/items/`) return json({ data: PLAYLIST.items, next: null });
    return json({ data: [] });
  });
  await page.goto(`/playlists/${PLAYLIST_ID}`);
  await page.locator('button:has(svg[data-testid="FolderZipIcon"])').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  return { context, dialog };
}

const zipAnswer = (headers: Record<string, string>) => ({
  status: 200,
  contentType: 'application/zip',
  headers: { 'Content-Disposition': 'attachment; filename="x.zip"', ...headers },
  body: 'PK',
});

test('a partial ZIP says what is missing and keeps the dialog open', async ({ browser }) => {
  const { context, dialog } = await openExportDialog(browser, zipAnswer({ 'X-Export-Omitted': '2', 'X-Export-Warned': '1' }));

  await dialog.getByRole('button', { name: /export/i }).last().click();

  await expect(dialog.getByRole('alert')).toContainText('2 tracks could not be included');
  await expect(dialog.getByRole('alert')).toContainText('export-summary.json');

  await context.close();
});

test('a complete ZIP just finishes', async ({ browser }) => {
  const { context, dialog } = await openExportDialog(browser, zipAnswer({ 'X-Export-Omitted': '0', 'X-Export-Warned': '0' }));

  await dialog.getByRole('button', { name: /export/i }).last().click();

  await expect(dialog).toBeHidden();

  await context.close();
});

test('a refusal shows the server\'s reason', async ({ browser }) => {
  const { context, dialog } = await openExportDialog(browser, {
    status: 429,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'An export is already in progress.' }),
  });

  await dialog.getByRole('button', { name: /export/i }).last().click();

  await expect(dialog.getByRole('alert')).toHaveText('An export is already in progress.');

  await context.close();
});

test('a track export says what is missing', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page: Page = await context.newPage();
  await page.route((url) => url.pathname.startsWith('/media/'), (route) => route.abort());
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.pathname === '/api/user/account/') return json(STUB_ACCOUNT);
    if (url.pathname === '/api/user/config/') return json({ extra_settings: {}, playback_sync_enabled: false });
    if (url.pathname === '/api/audio/list/') return json({ data: [ITEM.audio], next: null });
    if (url.pathname === `/api/audio/${ITEM.audio.youtube_id}/export/`) {
      if (route.request().method() === 'GET') {
        return json({
          youtube_id: ITEM.audio.youtube_id, title: ITEM.audio.title, artist: 'x', album: '', current_format: 'flac',
          available_formats: ['mp3', 'flac'], has_lyrics: false, has_synced_lyrics: false, has_artwork: false,
          artwork_sources: [], metadata: {},
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'audio/mpeg',
        headers: { 'Content-Disposition': 'attachment; filename="x.mp3"', 'X-Export-Warnings': 'artwork_unavailable' },
        body: 'audio',
      });
    }
    return json({ data: [] });
  });

  await page.goto('/library');
  await page.getByText(ITEM.audio.title).first().click();
  await page.locator('button:has(svg[data-testid="MoreVertIcon"])').last().click();
  await page.getByRole('menuitem', { name: 'Export' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('re-encodes the track')).toBeVisible({ timeout: 20_000 });

  await dialog.getByRole('button', { name: /Export as/ }).click();

  await expect(dialog.getByRole('alert')).toContainText('without artwork');

  await context.close();
});

test('a large export runs in the background, reports progress and can be collected', async ({ browser }) => {
  const jobId = '11111111-1111-4111-8111-111111111111';
  const answers = [
    { status: 'running', tracks_done: 1, tracks_total: 3, summary: {}, error: '' },
    { status: 'ready', tracks_done: 3, tracks_total: 3, summary: { omitted: [{ title: 'x', reason: 'y' }], warnings: [] }, error: '' },
  ];
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page: Page = await context.newPage();
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.pathname === '/api/user/account/') return json(STUB_ACCOUNT);
    if (url.pathname === '/api/user/config/') return json({ extra_settings: {}, playback_sync_enabled: false });
    if (url.pathname === `/api/playlist/${PLAYLIST_ID}/export/`) return json({ job_id: jobId, status: 'queued' }, 202);
    if (url.pathname === '/api/export-jobs/') return json({ data: [] });
    if (url.pathname === `/api/export-jobs/${jobId}/`) return json({ id: jobId, ...(answers.length > 1 ? answers.shift() : answers[0]) });
    if (url.pathname === `/api/playlist/${PLAYLIST_ID}/`) return json(PLAYLIST);
    if (url.pathname === `/api/playlist/${PLAYLIST_ID}/items/`) return json({ data: PLAYLIST.items, next: null });
    return json({ data: [] });
  });
  await page.goto(`/playlists/${PLAYLIST_ID}`);
  await page.locator('button:has(svg[data-testid="FolderZipIcon"])').first().click();
  const dialog = page.getByRole('dialog');

  await dialog.getByRole('button', { name: /export/i }).last().click();

  await expect(dialog.getByText('1 of 3 tracks')).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByRole('button', { name: 'Cancel export' })).toBeVisible();

  const download = dialog.getByRole('link', { name: 'Download ZIP' });
  await expect(download).toHaveAttribute('href', `/api/export-jobs/${jobId}/download/`, { timeout: 10_000 });
  await expect(dialog.getByRole('alert')).toContainText('1 tracks could not be included');

  await context.close();
});

test('canceling a background export asks the server and clears it, and reopening finds a running one', async ({ browser }) => {
  const jobId = '22222222-2222-4222-8222-222222222222';
  const running = { id: jobId, status: 'running', tracks_done: 2, tracks_total: 5, summary: {}, error: '' };
  let deletes = 0;
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page: Page = await context.newPage();
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.pathname === '/api/user/account/') return json(STUB_ACCOUNT);
    if (url.pathname === '/api/user/config/') return json({ extra_settings: {}, playback_sync_enabled: false });
    if (url.pathname === '/api/export-jobs/') return json({ data: deletes ? [] : [running] });
    if (url.pathname === `/api/export-jobs/${jobId}/`) {
      if (route.request().method() === 'DELETE') {
        deletes += 1;
        return route.fulfill({ status: 204 });
      }
      return json(running);
    }
    if (url.pathname === `/api/playlist/${PLAYLIST_ID}/`) return json(PLAYLIST);
    if (url.pathname === `/api/playlist/${PLAYLIST_ID}/items/`) return json({ data: PLAYLIST.items, next: null });
    return json({ data: [] });
  });
  await page.goto(`/playlists/${PLAYLIST_ID}`);
  await page.locator('button:has(svg[data-testid="FolderZipIcon"])').first().click();
  const dialog = page.getByRole('dialog');

  await expect(dialog.getByText('2 of 5 tracks')).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button', { name: 'Cancel export' }).click();

  await expect.poll(() => deletes).toBe(1);
  await expect(dialog.getByRole('button', { name: 'Cancel export' })).toHaveCount(0);

  await context.close();
});
