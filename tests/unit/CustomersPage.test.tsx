import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

afterEach(cleanup);
import { MemoryRouter } from 'react-router-dom';
import { buildMockModel, type MockBuild } from '@app/data/mock-model';
import { TrackerContext, readyContextValue } from '@app/data/TrackerContext';
import { CustomersPage } from '@app/pages/CustomersPage';

let built: MockBuild;

beforeAll(async () => {
  built = await buildMockModel('2026-09-05');
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/customers']}>
      <TrackerContext.Provider value={readyContextValue(built.model, built.insight)}>
        <CustomersPage />
      </TrackerContext.Provider>
    </MemoryRouter>,
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
});
