import { expect, test } from '@playwright/test';

test.describe('Loading / Empty / Error / Partial states', () => {
  test('shows the error state with retry when the source fails', async ({ page }) => {
    await page.goto('/#/?simulate=error&lang=en');
    await expect(page.getByTestId('state-error')).toBeVisible();
    await expect(page.getByTestId('state-error')).toContainText(/Simulated/);
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  test('shows the empty state when the dataset has no invoices', async ({ page }) => {
    await page.goto('/#/customers?simulate=empty&lang=en');
    await expect(page.getByTestId('state-empty')).toBeVisible();
    await expect(page.getByTestId('state-empty')).toContainText('No invoices');
  });

  test('shows a loading skeleton before data is ready', async ({ page }) => {
    await page.goto('/#/?simulate=slow&lang=en');
    await expect(page.getByTestId('state-loading')).toBeVisible();
    await expect(page.getByTestId('kpi-card-total_outstanding')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('state-loading')).toHaveCount(0);
  });

  test('shows the partial-data banner for the fixture dataset (intentionally incomplete)', async ({ page }) => {
    await page.goto('/#/aging?lang=en');
    await expect(page.getByTestId('banner-partial')).toBeVisible();
    await expect(page.getByTestId('banner-partial')).toContainText('Partial data');
    await expect(page.getByTestId('page-title')).toHaveText('Aging Analysis');
  });

});
