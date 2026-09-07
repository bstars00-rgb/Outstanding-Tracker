import { expect, test } from '@playwright/test';

test.describe('Collection Action Board', () => {
  test('shows all nine groups and persists a status change across reloads', async ({ page }) => {
    await page.goto('/#/actions?mode=mock');
    await expect(page.getByTestId('page-title')).toHaveText('Collection Action Board');
    await expect(page.locator('[data-testid^="action-group-"]')).toHaveCount(9);

    const group = page.getByTestId('action-group-CONTACT_TODAY');
    const select = group.getByTestId('action-status').first();
    await expect(select).toHaveValue('open');
    const card = group.getByTestId('action-card').first();
    const customer = (await card.getByRole('link').first().textContent())?.trim();

    await select.selectOption('in_progress');
    await expect(select).toHaveValue('in_progress');

    await page.reload();
    await expect(page.getByTestId('page-title')).toHaveText('Collection Action Board');
    const after = page.getByTestId('action-group-CONTACT_TODAY').getByTestId('action-card').filter({ hasText: customer! }).first().getByTestId('action-status');
    await expect(after).toHaveValue('in_progress');

    const stored = await page.evaluate(() => Object.keys(window.localStorage).filter((k) => k.startsWith('ot.actions.')));
    expect(stored.length).toBeGreaterThan(0);
  });

  test('filtering by owner shows "All caught up" for empty groups', async ({ page }) => {
    await page.goto('/#/actions?mode=mock');
    await page.getByTestId('actions-owner-filter').selectOption({ index: 1 });
    await expect(page.getByText(/All caught up/).first()).toBeVisible();
  });
});
