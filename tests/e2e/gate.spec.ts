import { expect, test } from '@playwright/test';

/**
 * Runs only when the build under test was produced with VITE_GATE_HASH set and the matching
 * password is provided via E2E_GATE_PASSWORD (CI job "gate"). Skipped otherwise.
 */
const password = process.env.E2E_GATE_PASSWORD;

test.describe('Password gate', () => {
  test.skip(!password, 'E2E_GATE_PASSWORD not set: gate build not under test');

  test('blocks the app until the correct password is entered, remembers the session, and can lock again', async ({ page }) => {
    await page.goto('/#/?mode=mock');
    await expect(page.getByTestId('gate-locked')).toBeVisible();
    await expect(page.getByTestId('mode-badge')).toHaveCount(0);

    await page.getByLabel('Password').fill('definitely-wrong');
    await page.getByRole('button', { name: 'Enter' }).click();
    await expect(page.getByRole('alert')).toContainText('Incorrect password');

    await page.getByLabel('Password').fill(password!);
    await page.getByRole('button', { name: 'Enter' }).click();
    await expect(page.getByTestId('mode-badge')).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('mode-badge')).toBeVisible(); // sessionStorage keeps the tab unlocked

    await page.getByTestId('gate-lock').click();
    await expect(page.getByTestId('gate-locked')).toBeVisible();
  });
});
