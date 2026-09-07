import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { formatInTimeZone } from '@core/dates';
import { useTracker } from '@app/data/TrackerContext';
import { gateEnabled, lockGate } from '@app/gate/PasswordGate';
import { useI18n } from '@app/i18n/useI18n';
import type { StringKey } from '@app/i18n/strings';
import { IconActions, IconAging, IconCheck, IconCustomers, IconInsights, IconInvoices, IconOverview, IconWarning } from './Icons';
import { LangToggle } from './LangToggle';
import { ThemeToggle } from './ThemeToggle';

const NAV: { to: string; label: StringKey; short: StringKey; Icon: typeof IconOverview }[] = [
  { to: '/', label: 'nav.overview', short: 'nav.overview.short', Icon: IconOverview },
  { to: '/aging', label: 'nav.aging', short: 'nav.aging.short', Icon: IconAging },
  { to: '/customers', label: 'nav.customers', short: 'nav.customers.short', Icon: IconCustomers },
  { to: '/invoices', label: 'nav.invoices', short: 'nav.invoices.short', Icon: IconInvoices },
  { to: '/actions', label: 'nav.actions', short: 'nav.actions.short', Icon: IconActions },
  { to: '/insights', label: 'nav.insights', short: 'nav.insights.short', Icon: IconInsights },
];

const SOURCE_KEY: Record<string, StringKey> = {
  mock: 'source.mock',
  'ellis-mcp': 'source.ellis-mcp',
  'ellis-bookings-derived': 'source.ellis-bookings-derived',
  file: 'source.file',
};

export function Layout({ children }: { children: ReactNode }) {
  const data = useTracker();
  const { t } = useI18n();
  const model = data.model;
  const isMock = model ? model.is_mock : data.mode === 'mock';
  const asOf = model ? formatInTimeZone(model.as_of, 'Asia/Ho_Chi_Minh') : '—';
  const dates = data.availableDates.length ? [...data.availableDates].reverse() : [data.referenceDate];
  const sourceLabel = model ? (SOURCE_KEY[model.source] ? t(SOURCE_KEY[model.source]) : model.source) : data.mode === 'mock' ? t('source.mock') : t('source.published');
  const otherMode = data.mode === 'mock' ? 'live' : 'mock';

  return (
    <div className="app">
      <nav className="sidebar" aria-label={t('nav.aria')}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            OT
          </span>
          <span>{t('app.name')}</span>
        </div>
        {NAV.map(({ to, label, short, Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} aria-label={t(label)}>
            <Icon />
            <span title={t(label)}>{t(short)}</span>
          </NavLink>
        ))}
        <div className="sidebar-foot">{t('sidebar.foot')}</div>
      </nav>

      <div className="main">
        <header className="topbar">
          <span className={`mode-badge ${isMock ? 'mock' : 'live'}`} data-testid="mode-badge" title={isMock ? t('badge.mock.title') : t('badge.live.title')}>
            {isMock ? <IconWarning width={13} height={13} /> : <IconCheck width={13} height={13} />}
            {isMock ? t('badge.mock') : t('badge.live')}
          </span>

          <span className="topbar-item">
            <label htmlFor="ref-date">{t('topbar.refDate')}</label>
            <select
              id="ref-date"
              className="select"
              data-testid="ref-date-select"
              value={data.referenceDate}
              onChange={(e) => data.setReferenceDate(e.target.value)}
              disabled={data.mode !== 'mock' || data.status === 'loading'}
              title={data.mode === 'mock' ? t('topbar.refDate.mockTitle') : t('topbar.refDate.liveTitle')}
            >
              {dates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </span>

          <span className="topbar-item">
            {t('topbar.currency')} <strong>{model?.reporting_currency ?? '—'}</strong>
          </span>
          <span className="topbar-item">
            {t('topbar.asOf')} <strong>{asOf}</strong>
          </span>
          <span className="topbar-item">
            {t('topbar.source')} <strong>{sourceLabel}</strong>
          </span>
          <span className="topbar-spacer" />
          <LangToggle />
          <ThemeToggle />
          <button type="button" className="btn small" onClick={() => data.setMode(otherMode)} aria-label={t('topbar.switchToAria', { mode: t(`mode.${otherMode}`) })}>
            {t('topbar.switchTo', { mode: t(`mode.${otherMode}`) })}
          </button>
          <button type="button" className="btn small" onClick={data.refresh} aria-label={t('topbar.refreshAria')}>
            {t('topbar.refresh')}
          </button>
          {gateEnabled() && (
            <button type="button" className="btn small" onClick={lockGate} aria-label={t('topbar.lockAria')} data-testid="gate-lock">
              {t('topbar.lock')}
            </button>
          )}
        </header>

        <main className="content" id="main">
          {children}
        </main>

        <footer className="footer" data-testid="footer">
          {t('footer.source')}: {sourceLabel} · {t('footer.lastRefresh')} {model?.as_of ?? '—'} · {t('footer.reportingCurrency')} {model?.reporting_currency ?? '—'} · {t('footer.comparedWith')}{' '}
          {model?.previous_snapshot_date ?? t('footer.noPrior')}
          {model && (
            <>
              {' '}
              · {t('footer.modelLang')} <span data-testid="model-lang">{model.lang}</span>
            </>
          )}{' '}
          · {t('footer.autoGenerated')}
        </footer>
      </div>
    </div>
  );
}
