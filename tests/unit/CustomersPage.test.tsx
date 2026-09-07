import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';

afterEach(cleanup);
import { buildMockModel, type MockBuild } from '@app/data/mock-model';
import { TrackerContext, readyContextValue } from '@app/data/TrackerContext';
import { CustomersPage } from '@app/pages/CustomersPage';
import { renderWithProviders } from './test-utils';

let built: MockBuild;

beforeAll(async () => {
  built = await buildMockModel('2026-09-05');
});

function renderPage(lang: 'en' | 'ko' = 'en') {
  return renderWithProviders(
    <TrackerContext.Provider value={readyContextValue(built.model, built.insight)}>
      <CustomersPage />
    </TrackerContext.Provider>,
    { route: '/customers', lang },
  );
}

function bodyRows() {
  const table = screen.getByTestId('customers-table');
  return within(table)
    .getAllByRole('row')
    .filter((r) => r.closest('tbody') && r.getAttribute('data-row-id'));
}

describe('CustomersPage', () => {
  it('renders every customer and reduces rows when filtering by risk grade', () => {
    renderPage();
    const total = built.model.customers.length;
    expect(total).toBeGreaterThan(5);
    expect(bodyRows()).toHaveLength(total);

    fireEvent.change(screen.getByLabelText('Risk grade'), { target: { value: 'High' } });
    const highCount = built.model.customers.filter((c) => c.risk.grade === 'High').length;
    expect(highCount).toBeGreaterThan(0);
    const rows = bodyRows();
    expect(rows).toHaveLength(highCount);
    expect(rows.length).toBeLessThan(total);
    expect(rows[0]).toHaveTextContent('Mekong Holidays JSC');
    expect(screen.getByText(new RegExp(`Showing ${highCount} of ${total} customers`))).toBeInTheDocument();
  });

  it('sorts by overdue descending when the sort select changes', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'overdue' } });
    const expected = [...built.model.customers].sort((a, b) => b.overdue_reporting - a.overdue_reporting);
    const rows = bodyRows();
    expect(rows[0].getAttribute('data-row-id')).toBe(expected[0].customer_id);
    expect(rows[1].getAttribute('data-row-id')).toBe(expected[1].customer_id);
    expect(rows[rows.length - 1].getAttribute('data-row-id')).toBe(expected[expected.length - 1].customer_id);
  });

  it('has the required column headers in order', () => {
    renderPage();
    const headers = within(screen.getByTestId('customers-table'))
      .getAllByRole('columnheader')
      .map((h) => h.textContent?.replace(/[▲▼↕]/g, '').trim());
    expect(headers).toEqual([
      'Customer',
      'Country',
      'Owner',
      'Contract currency',
      'Total outstanding',
      'Overdue',
      'Max aging days',
      '30+ overdue',
      'Credit utilization %',
      'WoW change (overdue)',
      'Last payment',
      'Next promise',
      'Promise broken',
      'Disputed',
      'Risk score',
      'Risk grade',
      'Recommended action',
    ]);
  });

  it('shows reporting-currency amounts with the original contract-currency amount underneath', () => {
    renderPage();
    const ccy = built.model.reporting_currency;
    expect(ccy).toBe('JPY');
    const foreign = built.model.customers.find((c) => c.contract_currency !== ccy && c.totals_by_currency.length === 1 && c.total_outstanding_reporting > 0)!;
    expect(foreign).toBeDefined();
    const row = bodyRows().find((r) => r.getAttribute('data-row-id') === foreign.customer_id)!;
    const cells = within(row).getAllByRole('cell');
    expect(cells[3]).toHaveTextContent(foreign.contract_currency);
    const totalCell = cells[4];
    expect(totalCell).toHaveTextContent(`${ccy} `);
    const sub = totalCell.querySelector('.cell-sub');
    expect(sub).not.toBeNull();
    expect(sub!.textContent).toContain(foreign.totals_by_currency[0].currency);

    const multi = built.model.customers.find((c) => c.totals_by_currency.length > 1);
    if (multi) {
      const mrow = bodyRows().find((r) => r.getAttribute('data-row-id') === multi.customer_id)!;
      const subs = within(mrow).getAllByRole('cell')[4].querySelectorAll('.cell-sub');
      expect(subs.length).toBe(multi.totals_by_currency.length);
    }
  });

  it('renders Korean headers and grade labels while keeping the English grade in a title attribute', () => {
    renderPage('ko');
    const table = screen.getByTestId('customers-table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent?.replace(/[▲▼↕]/g, '').trim());
    expect(headers).toContain('고객사');
    expect(headers).toContain('계약 통화');
    expect(headers).toContain('총 미수금');
    const high = table.querySelector('.risk-badge.risk-High')!;
    expect(high).not.toBeNull();
    expect(high.textContent).toContain('높음');
    expect(high.getAttribute('title')).toMatch(/^High/);
  });
});
