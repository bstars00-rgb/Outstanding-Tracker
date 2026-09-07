import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney } from '@core/money';
import { ACTION_GROUP_LABEL_I18N } from '@core/i18n';
import { ACTION_GROUP_LABEL, type ActionGroup, type ActionItem } from '@core/types';
import { useReadyTracker } from '@app/data/TrackerContext';
import { useI18n } from '@app/i18n/useI18n';
import { PageHeader } from '@app/components/PageHeader';
import { FilterBar, SelectFilter, distinct } from '@app/components/FilterBar';
import { StatusPill, severityTone } from '@app/components/StatusPill';
import { Banner } from '@app/components/Banner';
import { customerLink, invoicesLink } from '@app/lib/links';
import { fmtDate } from '@app/lib/format';

type Status = ActionItem['status'];
const STATUSES: Status[] = ['open', 'in_progress', 'done'];
const GROUPS = Object.keys(ACTION_GROUP_LABEL) as ActionGroup[];
const STORAGE_PREFIX = 'ot.actions.';

function readStatus(id: string, fallback: Status): Status {
  try {
    const v = window.localStorage.getItem(STORAGE_PREFIX + id);
    return v === 'open' || v === 'in_progress' || v === 'done' ? v : fallback;
  } catch {
    return fallback;
  }
}
function writeStatus(id: string, status: Status) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + id, status);
  } catch {
    /* ignore */
  }
}

export function ActionsPage() {
  const { model } = useReadyTracker();
  const { lang, t, te } = useI18n();
  const groupLabel = ACTION_GROUP_LABEL_I18N[lang];
  const ccy = model.reporting_currency;
  const [owner, setOwner] = useState('');
  const [hideDone, setHideDone] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, Status>>(() => Object.fromEntries(model.actions.map((a) => [a.id, readStatus(a.id, a.status)])));

  const owners = distinct(model.actions, (a) => a.owner);
  const items = useMemo(() => model.actions.filter((a) => !owner || a.owner === owner), [model.actions, owner]);
  const statusOf = (a: ActionItem): Status => statuses[a.id] ?? a.status;

  function setStatus(id: string, s: Status) {
    writeStatus(id, s);
    setStatuses((prev) => ({ ...prev, [id]: s }));
  }

  const openCount = items.filter((a) => statusOf(a) !== 'done').length;
  const openAmount = items.filter((a) => statusOf(a) !== 'done').reduce((s, a) => s + a.amount_reporting, 0);

  return (
    <div>
      <PageHeader title={t('actions.title')} subtitle={t('actions.subtitle', { open: openCount, amount: formatMoney(openAmount, ccy), groups: GROUPS.length, date: model.reference_date })} />

      <Banner kind="info">{t('actions.banner')}</Banner>

      <FilterBar>
        <SelectFilter id="a-owner" label={t('filter.owner')} value={owner} onChange={setOwner} options={owners} testId="actions-owner-filter" />
        <div className="filter-field">
          <label htmlFor="a-hide-done">{t('actions.doneItems')}</label>
          <select id="a-hide-done" className="select" value={hideDone ? 'hide' : 'show'} onChange={(e) => setHideDone(e.target.value === 'hide')}>
            <option value="show">{t('actions.show')}</option>
            <option value="hide">{t('actions.hide')}</option>
          </select>
        </div>
      </FilterBar>

      <div className="board">
        {GROUPS.map((g) => {
          const all = items.filter((a) => a.group === g);
          const visible = hideDone ? all.filter((a) => statusOf(a) !== 'done') : all;
          const open = all.filter((a) => statusOf(a) !== 'done');
          const total = open.reduce((s, a) => s + a.amount_reporting, 0);
          return (
            <section className="card board-group" key={g} data-testid={`action-group-${g}`} aria-labelledby={`grp-${g}`}>
              <div className="board-group-head">
                <h2 className="card-title" id={`grp-${g}`} style={{ marginBottom: 0 }} title={ACTION_GROUP_LABEL[g]}>
                  {groupLabel[g] ?? ACTION_GROUP_LABEL[g]}
                </h2>
                <span className="small muted tnum">
                  {t('actions.openCount', { open: open.length })}
                  {all.length !== open.length ? ` / ${all.length}` : ''} · {formatMoney(total, ccy, { compact: true })}
                </span>
              </div>
              {visible.length === 0 ? (
                <div className="caught-up">{t('actions.caughtUp', { owner: owner ? t('actions.forOwner', { owner }) : '' })}</div>
              ) : (
                visible
                  .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || b.amount_reporting - a.amount_reporting)
                  .map((a) => {
                    const st = statusOf(a);
                    return (
                      <article className={`action-card ${st === 'done' ? 'done' : ''}`} key={a.id} data-testid="action-card">
                        <div className="row">
                          <Link to={customerLink(a.customer_id)}>
                            <strong>{a.customer_name}</strong>
                          </Link>
                          <StatusPill tone={severityTone(a.severity)} title={a.severity}>
                            {te('severity', a.severity)}
                          </StatusPill>
                        </div>
                        <div className="row small muted">
                          <span>{t('actions.owner', { owner: a.owner })}</span>
                          <span className="tnum">{t('actions.due', { date: fmtDate(a.due_date) })}</span>
                        </div>
                        <div className="row">
                          <span className="tnum">
                            <strong>{formatMoney(a.amount_reporting, ccy)}</strong>
                          </span>
                          {a.invoice_id && (
                            <Link className="small" to={invoicesLink({ customer: a.customer_id, q: model.invoices.find((i) => i.invoice_id === a.invoice_id)?.invoice_number ?? a.invoice_id })}>
                              {t('actions.invoiceLink')}
                            </Link>
                          )}
                        </div>
                        <p>{a.recommended_action}</p>
                        <div className="row">
                          <label className="small muted" htmlFor={`st-${a.id}`}>
                            {t('actions.status')}
                          </label>
                          <select
                            id={`st-${a.id}`}
                            className="select"
                            value={st}
                            onChange={(e) => setStatus(a.id, e.target.value as Status)}
                            data-testid="action-status"
                            aria-label={t('actions.statusAria', { customer: a.customer_name, group: groupLabel[g] ?? g })}
                          >
                            {STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {te('actionStatus', s)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </article>
                    );
                  })
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
