import { expect, test } from '@playwright/test';

test.describe('Executive Overview', () => {
  test('shows the LIVE badge, 10 KPI cards and navigates to every page', async ({ page }) => {
    await page.goto('/#/?lang=en');
    await expect(page.getByTestId('mode-badge')).toHaveText(/LIVE/);
    await expect(page.getByTestId('page-title')).toHaveText('Executive Overview');
    await expect(page.locator('[data-testid^="kpi-card-"]')).toHaveCount(10);
    await expect(page.getByTestId('kpi-card-total_outstanding')).toContainText('JPY');
    await expect(page.getByTestId('banner-partial')).toBeVisible();

    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    const pages: [string, string][] = [
      ['Aging Analysis', 'Aging Analysis'],
      ['Customer Risk', 'Customer Risk'],
      ['Invoice Detail', 'Invoice Detail'],
      ['Collection Action Board', 'Collection Action Board'],
      ['Weekly AI Insight', 'Weekly AI Insight'],
      ['Executive Overview', 'Executive Overview'],
    ];
    for (const [label, title] of pages) {
      await nav.getByRole('link', { name: label }).click();
      await expect(page.getByTestId('page-title')).toHaveText(title);
    }
  });

  test('clicking a KPI card opens the invoices behind it', async ({ page }) => {
    await page.goto('/#/?lang=en');
    await page.getByTestId('kpi-card-overdue_30_plus').click();
    await expect(page.getByTestId('page-title')).toHaveText('Invoice Detail');
    await expect(page).toHaveURL(/kpi=overdue_30_plus/);
    const chip = page.getByTestId('kpi-filter');
    await expect(chip).toContainText('30+ Days Overdue');
    const agings = await page.locator('tbody tr[data-row-id] td:nth-child(7)').allInnerTexts();
    expect(agings.length).toBeGreaterThan(0);
    for (const a of agings) expect(Number(a.replace(/[^0-9-]/g, ''))).toBeGreaterThan(30);
    await page.getByTestId('kpi-filter-clear').click();
    await expect(chip).toHaveCount(0);
  });

  test('offers a table alternative for the aging chart and a reference date selector', async ({ page }) => {
    await page.goto('/#/?lang=en');
    await expect(page.getByTestId('page-title')).toHaveText('Executive Overview');
    const select = page.getByTestId('ref-date-select');
    await expect(select).toBeDisabled(); // published data carries exactly one reference date
    expect(await select.locator('option').count()).toBe(1);
    await page.getByText('Show as table').first().click();
    await expect(page.getByRole('table').filter({ hasText: '90+ days' }).first()).toBeVisible();
  });
});
