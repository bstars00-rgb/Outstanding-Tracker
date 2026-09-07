import { expect, test } from '@playwright/test';

test.describe('Korean / English UI and dark mode', () => {
  test('?lang=ko renders the Korean overview, the toggle switches back to English', async ({ page }) => {
    await page.goto('/#/?mode=mock&lang=ko');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
    await expect(page.getByTestId('page-title')).toHaveText('경영 요약');
    await expect(page.getByTestId('kpi-card-total_outstanding')).toContainText('총 미수금');
    await expect(page.getByTestId('kpi-card-total_outstanding')).toContainText('JPY');
    await expect(page.getByRole('navigation', { name: '주 메뉴' })).toBeVisible();
    await expect(page.getByTestId('model-lang')).toHaveText('ko');
    await expect(page.getByTestId('lang-toggle')).toBeVisible();

    await page.getByTestId('lang-en').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByTestId('page-title')).toHaveText('Executive Overview');
    await expect(page.getByTestId('kpi-card-total_outstanding')).toContainText('Total Outstanding');
    await expect(page.getByTestId('model-lang')).toHaveText('en');

    // The choice persists across reloads without a query parameter.
    await page.goto('/#/customers?mode=mock');
    await expect(page.getByTestId('page-title')).toHaveText('Customer Risk');
  });

  test('?lang=en shows English even after Korean was persisted', async ({ page }) => {
    await page.goto('/#/?mode=mock&lang=ko');
    await expect(page.getByTestId('page-title')).toHaveText('경영 요약');
    await page.goto('/#/?mode=mock&lang=en');
    await expect(page.getByTestId('page-title')).toHaveText('Executive Overview');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('theme toggle sets data-theme="dark" and persists after reload', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/#/?mode=mock&lang=en');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByTestId('theme-toggle')).toHaveText(/Light/);

    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByTestId('theme-toggle')).toHaveText(/Dark/);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(15, 21, 34)');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => localStorage.getItem('ot.theme'))).toBe('dark');
    await expect(page.getByTestId('mode-badge')).toBeVisible();

    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('customer currency: contract currency column, per-currency breakdown and FX table', async ({ page }) => {
    await page.goto('/#/customers?mode=mock&lang=en');
    const table = page.getByTestId('customers-table');
    await expect(table.getByRole('columnheader', { name: /Contract currency/ })).toBeVisible();
    const krwRow = table.locator('tbody tr[data-row-id]').filter({ hasText: 'Hanbit Tours' }).first();
    await expect(krwRow.getByTestId('contract-currency')).toContainText('KRW');
    await expect(krwRow.locator('td').nth(4)).toContainText('JPY');
    await expect(krwRow.locator('td').nth(4).locator('.cell-sub')).toContainText('KRW');

    await krwRow.getByRole('link', { name: 'Hanbit Tours Co.' }).click();
    await expect(page.getByTestId('page-title')).toHaveText('Hanbit Tours Co.');
    await expect(page.getByTestId('detail-contract-currency')).toContainText('KRW');
    const breakdown = page.getByTestId('detail-currency-breakdown');
    await expect(breakdown).toContainText('Balance by contract currency');
    await expect(breakdown.locator('tbody tr').first()).toContainText('KRW');

    await page.goto('/#/aging?mode=mock&lang=en');
    await page.getByTestId('aging-tab-currency').click();
    await expect(page.getByTestId('aging-table-currency')).toBeVisible();
    const fx = page.getByTestId('aging-fx-table');
    await expect(fx).toContainText('FX rates used');
    await expect(fx.getByRole('columnheader', { name: /JPY/ })).toBeVisible();
    await expect(fx.locator('tbody tr').filter({ hasText: 'KRW' })).toHaveCount(1);

    await page.goto('/#/invoices?mode=mock&lang=en');
    await expect(page.getByTestId('invoices-table').getByRole('columnheader', { name: /Outstanding \(JPY\)/ })).toBeVisible();
  });
});
