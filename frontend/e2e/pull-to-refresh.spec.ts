import { test, expect } from '@playwright/test';
import { login } from './helpers';

// Pull-to-refresh is wired only on Home. We drive a real downward touch-drag from near
// the top of the scrollable content via CDP (so the hook's listeners fire naturally) and
// assert the "release to update" indicator. We stop before touchend so the actual reload
// (forceUpdate) doesn't fire — the indicator proves the gesture is bound and scoped to Home.
test('pull-to-refresh shows the update indicator on Home', async ({ page }) => {
  await login(page);
  await page.goto('/');
  await expect(page.getByTestId('home-root')).toBeVisible({ timeout: 20_000 });

  const client = await page.context().newCDPSession(page);
  const x = 400;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: 240 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: 340 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: 520 }] });

  // English is the default locale in CI.
  await expect(page.getByText('Release to update')).toBeVisible({ timeout: 5_000 });

  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
});
