import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { formatInTimeZone } from '@core/dates';
import { useTracker } from '@app/data/TrackerContext';
import { IconActions, IconAging, IconCheck, IconCustomers, IconInsights, IconInvoices, IconOverview, IconWarning } from './Icons';

const NAV = [
  { to: '/', label: 'Executive Overview', short: 'Overview', Icon: IconOverview },
  { to: '/aging', label: 'Aging Analysis', short: 'Aging', Icon: IconAging },
  { to: '/customers', label: 'Customer Risk', short: 'Customers', Icon: IconCustomers },
  { to: '/invoices', label: 'Invoice Detail', short: 'Invoices', Icon: IconInvoices },
  { to: '/actions', label: 'Collection Action Board', short: 'Actions', Icon: IconActions },
  { to: '/insights', label: 'Weekly AI Insight', short: 'Insight', Icon: IconInsights },
];

const SOURCE_LABEL: Record<string, string> = {
  mock: 'Mock generator (fictional data)',
  'ellis-mcp': 'Ellis MCP',
  'ellis-bookings-derived': 'Ellis bookings (derived)',
  file: 'File import',
};

export function Layout({ children }: { children: ReactNode }) {
  const data = useTracker();
  const model = data.model;
  const isMock = model ? model.is_mock : data.mode === 'mock';
  const asOf = model ? formatInTimeZone(model.as_of, 'Asia/Ho_Chi_Minh') : '—';
  const dates = data.availableDates.length ? [...data.availableDates].reverse() : [data.referenceDate];

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            OT
          </span>
          <span>Outstanding Tracker</span>
        </div>
        {NAV.map(({ to, label, short, Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} aria-label={label}>
            <Icon />
            <span title={label}>{short}</span>
          </NavLink>
        ))}
        <div className="sidebar-foot">Receivables prototype v0.1</div>
      </nav>

      <div className="main">
        <header className="topbar">
          <span className={`mode-badge ${isMock ? 'mock' : 'live'}`} data-testid="mode-badge" title={isMock ? 'Figures come from the deterministic mock generator, not from Ellis.' : 'Figures come from the published weekly pipeline output.'}>
            {isMock ? <IconWarning width={13} height={13} /> : <IconCheck width={13} height={13} />}
            {isMock ? 'MOCK DATA' : 'LIVE'}
          </span>

          <span className="topbar-item">
            <label htmlFor="ref-date">Reference date</label>
            <select
              id="ref-date"
              className="select"
              data-testid="ref-date-select"
              value={data.referenceDate}
              onChange={(e) => data.setReferenceDate(e.target.value)}
              disabled={data.mode !== 'mock' || data.status === 'loading'}
              title={data.mode === 'mock' ? 'Weekly snapshot dates available in the mock source' : 'Live mode shows the latest published week'}
            >
              {dates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </span>

          <span className="topbar-item">
            Currency <strong>{model?.reporting_currency ?? '—'}</strong>
          </span>
          <span className="topbar-item">
            Data as of <strong>{asOf}</strong>
          </span>
          <span className="topbar-item">
            Source <strong>{model ? SOURCE_LABEL[model.source] ?? model.source : data.mode === 'mock' ? SOURCE_LABEL.mock : 'Published pipeline output'}</strong>
          </span>
          <span className="topbar-spacer" />
          <button type="button" className="btn small" onClick={() => data.setMode(data.mode === 'mock' ? 'live' : 'mock')} aria-label={`Switch to ${data.mode === 'mock' ? 'live' : 'mock'} data mode`}>
            Switch to {data.mode === 'mock' ? 'live' : 'mock'}
          </button>
          <button type="button" className="btn small" onClick={data.refresh} aria-label="Refresh data">
            Refresh
          </button>
        </header>

        <main className="content" id="main">
          {children}
        </main>

        <footer className="footer">
          Source: {model ? SOURCE_LABEL[model.source] ?? model.source : data.mode} · Last refresh {model?.as_of ?? '—'} · Reporting currency {model?.reporting_currency ?? '—'} · Compared with{' '}
          {model?.previous_snapshot_date ?? 'no prior snapshot'}
        </footer>
      </div>
    </div>
  );
}
