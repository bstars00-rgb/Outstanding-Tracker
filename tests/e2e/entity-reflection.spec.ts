import { expect, test } from '@playwright/test';

test.describe('Managing entity and ELLIS reflection chain', () => {
  test('overview shows the entity card (Seoul + Singapore) and the reflection status card', async ({ page }) => {
    await page.goto('/#/?mode=mock&lang=en');
    await expect(page.getByTestId('page-title')).toHaveText('Executive Overview');
    const entity = page.getByTestId('entity-card');
    await expect(entity).toBeVisible();
    await expect(entity).toContainText('By managing entity');
    await expect(entity).toContainText('OMH Seoul');
    await expect(entity).toContainText('OMH Singapore');
    await expect(entity.getByRole('link', { name: 'OMH Singapore' })).toHaveAttribute('href', /#\/customers\?entity=OMH%20Singapore/);

    const reflection = page.getByTestId('reflection-card');
    await expect(reflection).toBeVisible();
    await expect(reflection).toContainText('ELLIS reflection status');
    await expect(reflection.getByTestId('reflection-tile-unverified')).toBeVisible();
    await expect(reflection.getByTestId('reflection-tile-unreconciled')).toBeVisible();
    await expect(reflection.getByRole('link', { name: /Reflection chain/ })).toHaveAttribute('href', /#\/actions#reflection/);
  });

  test('?entity=OMH Singapore shows only Singapore customers', async ({ page }) => {
    await page.goto('/#/customers?entity=OMH%20Singapore&mode=mock&lang=en');
    await expect(page.getByTestId('page-title')).toHaveText('Customer Risk');
    await expect(page.getByTestId('customers-entity-filter')).toHaveValue('OMH Singapore');
    const rows = page.getByTestId('customers-table').locator('tbody tr[data-row-id]');
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    // Entity column sits right after Country (3rd column).
    const cells = page.getByTestId('customers-table').locator('tbody tr[data-row-id] td:nth-child(3)');
    await expect(cells).toHaveCount(count);
    for (const text of await cells.allTextContents()) expect(text.trim()).toBe('OMH Singapore');
    await expect(page.getByTestId('customer-entity').filter({ hasText: 'OMH Seoul' })).toHaveCount(0);

    await rows.first().getByRole('link').first().click();
    await expect(page.getByTestId('detail-entity')).toContainText('OMH Singapore');
  });

  test('aging page has a By Entity tab linking to the customer list', async ({ page }) => {
    await page.goto('/#/aging?mode=mock&lang=en');
    await page.getByTestId('aging-tab-entity').click();
    const table = page.getByTestId('aging-table-entity');
    await expect(table).toBeVisible();
    await expect(table.getByRole('link', { name: 'OMH Seoul' })).toHaveAttribute('href', /#\/customers\?entity=OMH%20Seoul/);
  });

  test('actions page renders the ELLIS_REFLECTION group and the reflection chain with over-SLA rows', async ({ page }) => {
    await page.goto('/#/actions?mode=mock&lang=en');
    await expect(page.getByTestId('page-title')).toHaveText('Collection Action Board');
    await expect(page.getByTestId('action-group-ELLIS_REFLECTION')).toBeVisible();
    await expect(page.getByTestId('action-group-ELLIS_REFLECTION')).toContainText('ELLIS reflection check');

    const section = page.getByTestId('reflection-section');
    await expect(section).toContainText('ELLIS reflection chain');
    await expect(section).toContainText('Rina (Josh)');
    await expect(section).toContainText('Sangho');
    await expect(section).toContainText('Jackie');
    const table = page.getByTestId('reflection-table');
    await expect(table).toBeVisible();
    const over = table.getByTestId('reflection-over-sla');
    expect(await over.count()).toBeGreaterThanOrEqual(1);
    await expect(over.first()).toContainText('Over SLA');

    await page.getByTestId('reflection-stage-filter').selectOption('RECONCILED');
    const stages = table.getByTestId('reflection-stage');
    expect(await stages.count()).toBeGreaterThan(0);
    for (const text of await stages.allTextContents()) expect(text.trim()).toBe('Reconciled');
    await expect(table.getByTestId('reflection-over-sla')).toHaveCount(0);
  });

  test('Korean labels for the entity card and reflection chain', async ({ page }) => {
    await page.goto('/#/?mode=mock&lang=ko');
    await expect(page.getByTestId('entity-card')).toContainText('법인별 현황');
    await expect(page.getByTestId('reflection-card')).toContainText('ELLIS 반영 상태');
    await page.goto('/#/actions?mode=mock&lang=ko');
    await expect(page.getByTestId('reflection-section')).toContainText('ELLIS 반영 확인 체인');
    await expect(page.getByTestId('reflection-table').getByTestId('reflection-over-sla').first()).toContainText('SLA 초과');
  });
});
