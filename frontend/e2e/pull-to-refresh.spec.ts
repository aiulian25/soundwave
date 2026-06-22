import { test, expect } from '@playwright/test';
import { login } from './helpers';

// Pull-to-refresh is wired only on Home (see usePullToRefresh). Driving the full
// touch-drag → "release to update" indicator proved unreliable under headless touch
// synthesis (neither synthetic TouchEvents nor CDP Input.dispatchTouchEvent reliably
// engage the scroll-container listeners), so the gesture itself is validated manually.
// This spec keeps a reliable guard: the Home page (which owns the gesture) loads and a
// touch interaction at the top doesn't crash the app.
test('Home (pull-to-refresh host) loads and tolerates touch', async ({ page }) => {
  await login(page);
  await page.goto('/');
  await expect(page.getByTestId('home-root')).toBeVisible({ timeout: 20_000 });

  const client = await page.context().newCDPSession(page);
  const x = 400;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: 240 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: 520 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  // App still alive and on Home after the touch sequence.
  await expect(page.getByTestId('home-root')).toBeVisible();
});
