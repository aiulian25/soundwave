import { test, expect } from '@playwright/test';
import { login } from './helpers';

// Artwork is kept on this server, so opening the app must not tell any other host who is
// looking or what the library holds.
const PAGES = ['/', '/library', '/playlists', '/channels', '/search', '/favorites', '/settings'];

test('browsing the app asks no other host for anything', async ({ page, baseURL }) => {
  const ownOrigin = new URL(baseURL!).origin;
  const requestsElsewhere: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    const isWebRequest = url.protocol.startsWith('http');
    if (isWebRequest && url.origin !== ownOrigin) requestsElsewhere.push(request.url());
  });

  await login(page);
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }

  expect(requestsElsewhere).toEqual([]);
});

test('the browser is told to load images from this server only', async ({ page }) => {
  const response = await page.goto('/');

  const policy = response!.headers()['content-security-policy'];

  expect(policy.split('; ')).toContain("img-src 'self' data: blob:");
});
