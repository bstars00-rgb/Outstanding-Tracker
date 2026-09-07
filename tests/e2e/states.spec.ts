import { expect, test } from '@playwright/test';

test.describe('Loading / Empty / Error / Partial states', () => {
  test('shows the error state with retry when the source fails', async ({ page }) => {
    await page.goto('/#/?mode=mock&simulate=error');
    await expect(page.getByTestId('state-error')).toBeVisible();
    await expect(page.getByTestId('state-error')).toContainText(/Simulated/);
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  test('shows the empty state when the dataset has no invoices', async ({ page }) => {
    await page.goto('/#/customers?mode=mock&simulate=empty');
    await expect(page.getByTestId('state-empty')).toBeVisible();
    await expect(page.getByTestId('state-empty')).toContainText('No invoices');
  });

  test('shows a loading skeleton before data is ready', async ({ page }) => {
    await page.goto('/#/?mode=mock&simulate=slow');
    await expect(page.getByTestId('state-loading')).toBeVisible();
    await expect(page.getByTestId('kpi-card-total_outstanding')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('state-loading')).toHaveCount(0);
  });

  test('shows the partial-data banner for the mock dataset (intentionally incomplete)', async ({ page }) => {
    await page.goto('/#/aging?mode=mock');
    await expect(page.getByTestId('banner-partial')).toBeVisible();
    await expect(page.getByTestId('banner-partial')).toContainText('Partial data');
    await expect(page.getByTestId('page-title')).toHaveText('Aging Analysis');
  });

  test('live mode without published data explains how to publish and can switch back to mock', async ({ page }) => {
    await page.goto('/#/?mode=live');
    await expect(page.getByTestId('state-error')).toBeVisible();
    await expect(page.getByTestId('state-error')).toContainText('Live data not published yet');
    await page.getByTestId('state-error').getByRole('button', { name: 'Switch to mock data' }).click();
    await expect(page.getByTestId('mode-badge')).toHaveText(/MOCK DATA/);
    await expect(page.getByTestId('kpi-card-total_outstanding')).toBeVisible();
  });
});
