import { test, expect } from '@playwright/test';
import { login } from './helpers';

// Pull-to-refresh is wired only on Home. We synthesize a downward touch-drag from the
// top and assert the "release to update" indicator appears. We stop before touchend so
// the actual page reload (forceUpdate) doesn't fire — the indicator proves the gesture
// is correctly bound and scoped to Home.
test('pull-to-refresh shows the update indicator on Home', async ({ page }) => {
  await login(page);
  await page.goto('/');
  await expect(page.getByTestId('home-root')).toBeVisible({ timeout: 20_000 });

  await page.evaluate(() => {
    const root = document.querySelector('[data-testid="home-root"]') as HTMLElement;
    let scroller: HTMLElement | null = root?.parentElement ?? null;
    while (scroller) {
      const oy = getComputedStyle(scroller).overflowY;
      if (oy === 'auto' || oy === 'scroll') break;
      scroller = scroller.parentElement;
    }
    const target: EventTarget = scroller ?? document.body;
    const el = (scroller ?? document.body) as HTMLElement;

    const fire = (type: string, y: number) => {
      const touch = new Touch({ identifier: 1, target: el, clientX: 120, clientY: y });
      const ended = type === 'touchend';
      el.dispatchEvent(
        new TouchEvent(type, {
          cancelable: true,
          bubbles: true,
          touches: ended ? [] : [touch],
          changedTouches: [touch],
          targetTouches: ended ? [] : [touch],
        }),
      );
    };

    // Drag far enough that distance * resistance(0.5) clears the ~70px threshold.
    fire('touchstart', 10);
    fire('touchmove', 90);
    fire('touchmove', 260); // ~125px after resistance → "release to update"
    void target;
  });

  // English is the default locale in CI.
  await expect(page.getByText('Release to update')).toBeVisible({ timeout: 5_000 });
});
