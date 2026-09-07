import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { formatMoney } from '@core/money';
import { ACTION_GROUP_LABEL_I18N } from '@core/i18n';
import { ACTION_GROUP_LABEL, DEFAULT_REFLECTION_CHAIN, type ActionGroup, type ActionItem, type ReflectionItem } from '@core/types';
import { useReadyTracker } from '@app/data/TrackerContext';
import { useI18n } from '@app/i18n/useI18n';
import { PageHeader } from '@app/components/PageHeader';
import { FilterBar, SelectFilter, distinct } from '@app/components/FilterBar';
import { StatusPill, severityTone, type PillTone } from '@app/components/StatusPill';
import { DataTable, type Column } from '@app/components/DataTable';
import { Money } from '@app/components/Money';
import { IconCheck, IconWarning } from '@app/components/Icons';
import { Banner } from '@app/components/Banner';
import { customerLink, invoicesLink } from '@app/lib/links';
import { fmtDate } from '@app/lib/format';

type Status = ActionItem['status'];
const STATUSES: Status[] = ['open', 'in_progress', 'done'];
const GROUPS = Object.keys(ACTION_GROUP_LABEL) as ActionGroup[];
const STORAGE_PREFIX = 'ot.actions.';

type Stage = ReflectionItem['stage'];
const STAGES: Stage[] = ['RECORDED', 'VERIFIED', 'RECONCILED'];
const STAGE_TONE: Record<Stage, PillTone> = { RECORDED: 'warning', VERIFIED: 'neutral', RECONCILED: 'good' };

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
  const location = useLocation();
  const [owner, setOwner] = useState('');
  const [stage, setStage] = useState('');
  const [hideDone, setHideDone] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, Status>>(() => Object.fromEntries(model.actions.map((a) => [a.id, readStatus(a.id, a.status)])));

  const owners = distinct(model.actions, (a) => a.owner);
  const items = useMemo(() => model.actions.filter((a) => !owner || a.owner === owner), [model.actions, owner]);
  const statusOf = (a: ActionItem): Status => statuses[a.id] ?? a.status;

  function setStatus(id: string, s: Status) {
    writeStatus(id, s);
    setStatuses((prev) => ({ ...prev, [id]: s }));
  }

  // #reflection deep link (Overview card): scroll to the chain section once the page has rendered.
  useEffect(() => {
    if (location.hash === '#reflection') document.getElementById('reflection')?.scrollIntoView({ block: 'start' });
  }, [location.hash]);

  const queue = model.reflection_queue;
  const reflectionRows = useMemo(() => queue.filter((r) => !stage || r.stage === stage), [queue, stage]);
  const stageCount = (st: Stage) => queue.filter((r) => r.stage === st).length;
  const overSlaCount = queue.filter((r) => r.overdue_sla).length;
  const chain = DEFAULT_REFLECTION_CHAIN;
  const chainStep = (label: string, step: { owner: string; sla_days: number }) => t('reflection.stageOwnerSla', { stage: label, owner: step.owner, days: step.sla_days });

  const reflectionColumns: Column<ReflectionItem>[] = [
    { key: 'date', header: t('col.paymentDate'), render: (r) => <span className="tnum">{r.payment_date}</span> },
    { key: 'customer', header: t('col.customer'), render: (r) => <Link to={customerLink(r.customer_id)}>{r.customer_name}</Link> },
    { key: 'entity', header: t('col.entity'), render: (r) => r.control_company ?? <span className="muted">{t('common.unassignedEntity')}</span> },
    { key: 'amount', header: t('col.amount'), align: 'right', render: (r) => <Money amount={r.amount_reporting} currency={ccy} original={{ amount: r.amount, currency: r.currency }} /> },
    {
      key: 'stage',
      header: t('col.stage'),
      render: (r) => (
        <StatusPill tone={STAGE_TONE[r.stage]} icon={false} title={r.stage} testId="reflection-stage">
          {te('reflectionStage', r.stage)}
        </StatusPill>
      ),
    },
    { key: 'owner', header: t('col.nextOwner'), render: (r) => r.next_owner || <span className="muted">—</span> },
    { key: 'days', header: t('col.daysInStage'), align: 'right', render: (r) => <span className="tnum">{r.days_in_stage}</span> },
    { key: 'sla', header: t('col.sla'), align: 'right', render: (r) => (r.stage === 'RECONCILED' ? <span className="muted">—</span> : <span className="tnum">{r.sla_days}</span>) },
    {
      key: 'over',
      header: t('col.overSla'),
      render: (r) =>
        r.overdue_sla ? (
          <StatusPill tone="critical" icon={false} testId="reflection-over-sla">
            <IconWarning width={12} height={12} /> {t('reflection.overSla')}
          </StatusPill>
        ) : r.stage === 'RECONCILED' ? (
          <span className="muted">—</span>
        ) : (
          <StatusPill tone="good" icon={false}>
            <IconCheck width={12} height={12} /> {t('reflection.withinSla')}
          </StatusPill>
        ),
    },
  ];

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

      <section className="card section" id="reflection" aria-labelledby="reflection-h" data-testid="reflection-section">
        <h2 className="card-title" id="reflection-h">
          {t('reflection.title')}
        </h2>
        <p className="chart-desc">
          {t('reflection.explain', {
            record: chainStep(t('reflection.stageRecord'), chain.record),
            verify: chainStep(t('reflection.stageVerify'), chain.verify),
            reconcile: chainStep(t('reflection.stageReconcile'), chain.reconcile),
          })}
        </p>
        <FilterBar
          summary={
            <>
              {t('reflection.summary', { total: queue.length, recorded: stageCount('RECORDED'), verified: stageCount('VERIFIED'), reconciled: stageCount('RECONCILED') })} ·{' '}
              <span style={overSlaCount > 0 ? { color: 'var(--critical-text)', fontWeight: 600 } : undefined} data-testid="reflection-over-sla-count">
                {t('reflection.overSlaCount', { n: overSlaCount })}
              </span>
            </>
          }
        >
          <SelectFilter id="r-stage" label={t('filter.stage')} value={stage} onChange={setStage} options={STAGES.map((st) => ({ value: st, label: te('reflectionStage', st) }))} testId="reflection-stage-filter" />
        </FilterBar>
        <DataTable columns={reflectionColumns} rows={reflectionRows} rowKey={(r) => r.payment_id} compact caption={t('reflection.caption')} emptyMessage={t('reflection.empty')} testId="reflection-table" />
      </section>
    </div>
  );
}
