import { expect, test } from '@playwright/test';

test.describe('Mobile layout', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile project only');

  async function assertNoHorizontalOverflow(page: import('@playwright/test').Page) {
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(scrollWidth, `document scrollWidth ${scrollWidth} must not exceed viewport ${innerWidth}`).toBeLessThanOrEqual(innerWidth);
  }

  test('overview has no horizontal overflow and KPI cards stack', async ({ page }) => {
    await page.goto('/#/?mode=mock');
    await expect(page.getByTestId('kpi-card-total_outstanding')).toBeVisible();
    await assertNoHorizontalOverflow(page);
    const first = await page.getByTestId('kpi-card-total_outstanding').boundingBox();
    const second = await page.getByTestId('kpi-card-overdue_outstanding').boundingBox();
    expect(first && second && second.y > first.y + first.height - 1).toBeTruthy();
    // bottom tab bar navigation is visible
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  });

  test('customers page has no horizontal overflow (table scrolls in its container)', async ({ page }) => {
    await page.goto('/#/customers?mode=mock');
    await expect(page.getByTestId('customers-table')).toBeVisible();
    await assertNoHorizontalOverflow(page);
    const scrolls = await page.getByTestId('customers-table').evaluate((t) => {
      const wrap = t.parentElement!;
      return wrap.scrollWidth > wrap.clientWidth && getComputedStyle(wrap).overflowX === 'auto';
    });
    expect(scrolls).toBeTruthy();
  });
});
