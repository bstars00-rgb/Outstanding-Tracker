import { expect, test } from '@playwright/test';

test.describe('Customer Risk', () => {
  test('filters by risk grade High, opens the detail and explains the score', async ({ page }) => {
    await page.goto('/#/customers?mode=mock&lang=en');
    await expect(page.getByTestId('page-title')).toHaveText('Customer Risk');
    const table = page.getByTestId('customers-table');
    const allRows = table.locator('tbody tr[data-row-id]');
    await expect(allRows.first()).toBeVisible();
    const total = await allRows.count();
    expect(total).toBeGreaterThan(5);

    await page.getByTestId('customers-grade-filter').selectOption('High');
    await expect(allRows).toHaveCount(1);
    await expect(allRows.first()).toContainText('Mekong Holidays JSC');

    await allRows.first().getByRole('link', { name: 'Mekong Holidays JSC' }).click();
    await expect(page.getByTestId('page-title')).toHaveText('Mekong Holidays JSC');
    const factors = page.getByTestId('risk-factor-row');
    expect(await factors.count()).toBeGreaterThanOrEqual(8);
    await expect(page.getByText(/Why this score/)).toBeVisible();
  });

  test('searching by name narrows the table', async ({ page }) => {
    await page.goto('/#/customers?mode=mock&lang=en');
    const rows = page.getByTestId('customers-table').locator('tbody tr[data-row-id]');
    await expect(rows.first()).toBeVisible();
    await page.getByLabel('Customer name').fill('Mekong');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Mekong Holidays JSC');
  });
});
