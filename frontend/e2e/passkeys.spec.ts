import { test, expect } from '@playwright/test';
import { E2E_PASSWORD, login } from './helpers';

const PASSKEY_NAME = 'E2E virtual key';

test('a passkey is added in settings, signs in without a password, and can be removed', async ({ page, context }) => {
  const browser = await context.newCDPSession(page);
  await browser.send('WebAuthn.enable');
  await browser.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });

  await login(page);
  await page.goto('/settings');
  await page.getByTestId('passkey-add').click();
  await page.getByTestId('passkey-password').fill('not-the-password');
  await page.getByTestId('passkey-add-submit').click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();

  await page.getByTestId('passkey-password').fill(E2E_PASSWORD);
  await page.getByTestId('passkey-name').fill(PASSKEY_NAME);
  await page.getByTestId('passkey-add-submit').click();
  const row = page.getByTestId('passkey-row').filter({ hasText: PASSKEY_NAME });
  await expect(row).toBeVisible();

  await context.clearCookies();
  await page.goto('/');
  await page.getByTestId('login-passkey').click();
  await expect(page.getByTestId('login-submit')).toBeHidden({ timeout: 20_000 });

  await page.goto('/settings');
  await row.getByRole('button').click();
  await page.getByTestId('passkey-remove-confirm').click();
  await expect(row).toBeHidden();
});
