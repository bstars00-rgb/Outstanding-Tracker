import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

afterEach(cleanup);
import type { KpiValue } from '@core/types';
import { KpiCard } from '@app/components/KpiCard';
import { renderWithProviders } from './test-utils';

const kpi: KpiValue = {
  key: 'overdue_outstanding',
  label: 'Overdue Outstanding',
  value: 462900.59,
  unit: 'currency',
  previous: 356683.59,
  change: 106217,
  change_pct: 0.2978,
  status: 'critical',
  interpretation: 'Overdue grew sharply this week.',
  definition: 'Sum of outstanding amounts on invoices past their due date, in reporting currency.',
};

describe('KpiCard', () => {
  it('renders value, WoW change and a text status label', () => {
    renderWithProviders(<KpiCard kpi={kpi} currency="USD" />);
    const card = screen.getByTestId('kpi-card-overdue_outstanding');
    expect(card).toHaveTextContent('Overdue Outstanding');
    expect(card).toHaveTextContent('USD 462,900.59');
    expect(card).toHaveTextContent('+USD 106,217.00');
    expect(card).toHaveTextContent('+29.8%');
    expect(card).toHaveTextContent('Critical');
    expect(card).toHaveTextContent('Overdue grew sharply this week.');
    expect(card).toHaveAttribute('title', kpi.definition);
  });

  it('formats ratio KPIs as percent with pp change and shows the definition on demand', () => {
    const ratio: KpiValue = { ...kpi, key: 'overdue_ratio', label: 'Overdue Ratio', unit: 'ratio', value: 0.2926, previous: 0.2938, change: -0.0012, change_pct: null, status: 'warning' };
    renderWithProviders(<KpiCard kpi={ratio} currency="USD" />);
    const card = screen.getByTestId('kpi-card-overdue_ratio');
    expect(card).toHaveTextContent('29.3%');
    expect(card).toHaveTextContent('-0.1 pp');
    expect(card).toHaveTextContent('Warning');
    const btn = screen.getByRole('button', { name: /definition of overdue ratio/i });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(card).toHaveTextContent('Definition:');
  });

  it('shows a no-comparison message when there is no previous week', () => {
    const fresh: KpiValue = { ...kpi, previous: null, change: null, change_pct: null, status: 'neutral' };
    renderWithProviders(<KpiCard kpi={fresh} currency="USD" />);
    expect(screen.getByTestId('kpi-card-overdue_outstanding')).toHaveTextContent('No prior week for comparison');
    expect(screen.getByTestId('kpi-card-overdue_outstanding')).toHaveTextContent('Neutral');
  });

  it('localises the status label and chrome in Korean while keeping numbers unchanged', () => {
    renderWithProviders(<KpiCard kpi={kpi} currency="JPY" />, { lang: 'ko' });
    const card = screen.getByTestId('kpi-card-overdue_outstanding');
    expect(card).toHaveTextContent('위험');
    expect(card).toHaveTextContent('전주 대비');
    expect(card).toHaveTextContent('JPY 462,901');
  });
});
