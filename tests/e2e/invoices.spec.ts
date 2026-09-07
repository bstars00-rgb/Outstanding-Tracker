import { expect, test } from '@playwright/test';

test.describe('Invoice Detail', () => {
  test('a bucket link on the aging page filters the invoice table', async ({ page }) => {
    await page.goto('/#/aging?mode=mock');
    await expect(page.getByTestId('page-title')).toHaveText('Aging Analysis');

    const countryTable = page.getByTestId('aging-table-country');
    await expect(countryTable).toBeVisible();
    // First bucket link in the country table: a specific (country, bucket) drill-down.
    const link = countryTable.locator('tbody td.link-cell a').first();
    const href = (await link.getAttribute('href')) ?? '';
    expect(href).toMatch(/#\/invoices\?/);
    const qs = new URLSearchParams(href.split('?')[1]);
    const bucket = qs.get('bucket');
    const country = qs.get('country');
    expect(bucket).toBeTruthy();
    expect(country).toBeTruthy();

    await link.click();
    await expect(page.getByTestId('page-title')).toHaveText('Invoice Detail');
    await expect(page.getByTestId('invoices-bucket-filter')).toHaveValue(bucket!);
    await expect(page.getByTestId('invoices-country-filter')).toHaveValue(country!);

    const rows = page.getByTestId('invoices-table').locator('tbody tr[data-row-id]');
    const n = await rows.count();
    expect(n).toBeGreaterThan(0);
    await expect(page.getByTestId('invoices-count')).toContainText(`Showing ${n} of`);
    const buckets = await rows.locator('[data-bucket]').evaluateAll((els) => els.map((e) => e.getAttribute('data-bucket')));
    expect(buckets.length).toBe(n);
    expect(new Set(buckets)).toEqual(new Set([bucket]));

    // Reset shows more invoices again.
    await page.getByRole('button', { name: 'Reset filters' }).click();
    expect(await rows.count()).toBeGreaterThan(n);
  });

  test('expanding a row reveals payment history and activities', async ({ page }) => {
    await page.goto('/#/invoices?mode=mock');
    const table = page.getByTestId('invoices-table');
    await expect(table.locator('tbody tr[data-row-id]').first()).toBeVisible();
    await table.getByRole('button', { name: 'Expand row details' }).first().click();
    await expect(table.getByText(/Payment history/)).toBeVisible();
    await expect(table.getByText(/Collection activities/)).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/guest name/i);
  });
});
