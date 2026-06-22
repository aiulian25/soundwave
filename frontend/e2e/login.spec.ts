import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('a user can log in', async ({ page }) => {
  await login(page);
  // The login form is gone and the app shell is shown.
  await expect(page.getByTestId('login-submit')).toBeHidden();
  // Sidebar version block confirms we're inside the app.
  await expect(page.getByText(/SoundWave/i).first()).toBeVisible();
});
