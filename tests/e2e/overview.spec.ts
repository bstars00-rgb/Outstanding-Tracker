import { expect, test } from '@playwright/test';

test.describe('Executive Overview', () => {
  test('shows the MOCK badge, 10 KPI cards and navigates to every page', async ({ page }) => {
    await page.goto('/#/?mode=mock&lang=en');
    await expect(page.getByTestId('mode-badge')).toHaveText(/MOCK DATA/);
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

  test('offers a table alternative for the aging chart and a reference date selector', async ({ page }) => {
    await page.goto('/#/?mode=mock&lang=en');
    await expect(page.getByTestId('page-title')).toHaveText('Executive Overview');
    const select = page.getByTestId('ref-date-select');
    await expect(select).toBeEnabled();
    const options = await select.locator('option').count();
    expect(options).toBe(12);
    await page.getByText('Show as table').first().click();
    await expect(page.getByRole('table').filter({ hasText: '90+ days' }).first()).toBeVisible();
  });
});
