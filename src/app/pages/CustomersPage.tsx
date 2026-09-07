import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AGING_BUCKET_LABEL_I18N, RISK_GRADE_LABEL_I18N } from '@core/i18n';
import { AGING_BUCKETS, type AgingBucket, type CustomerRisk, type RiskGrade } from '@core/types';
import { useReadyTracker } from '@app/data/TrackerContext';
import { useI18n } from '@app/i18n/useI18n';
import type { StringKey } from '@app/i18n/strings';
import { PageHeader } from '@app/components/PageHeader';
import { DataTable, type Column, type SortDir } from '@app/components/DataTable';
import { FilterBar, SelectFilter, TextFilter, distinct } from '@app/components/FilterBar';
import { Money } from '@app/components/Money';
import { RiskBadge } from '@app/components/RiskBadge';
import { StatusPill } from '@app/components/StatusPill';
import { IconCheck, IconWarning } from '@app/components/Icons';
import { customerLink } from '@app/lib/links';
import { fmtDate, fmtRatio } from '@app/lib/format';

const GRADES: RiskGrade[] = ['Low', 'Watch', 'Medium', 'High', 'Critical'];

const SORT_OPTIONS: { value: string; label: StringKey }[] = [
  { value: 'risk', label: 'sort.risk' },
  { value: 'overdue', label: 'sort.overdue' },
  { value: 'aging', label: 'sort.aging' },
  { value: 'wow', label: 'sort.wow' },
  { value: 'util', label: 'sort.util' },
];

const UNASSIGNED_ENTITY = 'unassigned';

interface Filters {
  country: string;
  entity: string;
  region: string;
  owner: string;
  currency: string;
  q: string;
  bucket: string;
  grade: string;
  dispute: string;
  broken: string;
}

export function CustomersPage() {
  const { model } = useReadyTracker();
  const { lang, t } = useI18n();
  const ccy = model.reporting_currency;
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const unassigned = t('common.unassigned');

  const [f, setF] = useState<Filters>({
    country: sp.get('country') ?? '',
    entity: sp.get('entity') ?? '',
    region: sp.get('region') ?? '',
    owner: sp.get('owner') ?? '',
    currency: sp.get('currency') ?? '',
    q: sp.get('q') ?? '',
    bucket: sp.get('bucket') ?? '',
    grade: sp.get('grade') ?? '',
    dispute: '',
    broken: '',
  });
  const [sortKey, setSortKey] = useState<string>('risk');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const set = (k: keyof Filters) => (v: string) => setF((prev) => ({ ...prev, [k]: v }));

  const customers = model.customers;
  const countries = distinct(customers, (c) => c.country);
  const unassignedEntity = t('common.unassignedEntity');
  const entityOf = (c: CustomerRisk) => c.control_company ?? UNASSIGNED_ENTITY;
  const entities = [...distinct(customers, (c) => c.control_company), ...(customers.some((c) => !c.control_company) ? [{ value: UNASSIGNED_ENTITY, label: unassignedEntity }] : [])];
  const regions = distinct(customers, (c) => c.region);
  const owners = distinct(customers, (c) => c.account_owner_name || unassigned);
  const currencies = distinct(customers, (c) => c.contract_currency);

  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return customers.filter((c) => {
      if (f.country && c.country !== f.country) return false;
      if (f.entity && entityOf(c) !== f.entity) return false;
      if (f.region && c.region !== f.region) return false;
      if (f.owner && (c.account_owner_name || unassigned) !== f.owner) return false;
      if (f.currency && c.contract_currency !== f.currency) return false;
      if (q && !c.customer_name.toLowerCase().includes(q) && !c.customer_id.toLowerCase().includes(q)) return false;
      if (f.bucket && !(c.bucket_totals[f.bucket as AgingBucket] > 0)) return false;
      if (f.grade && c.risk.grade !== f.grade) return false;
      if (f.dispute === 'yes' && c.disputed_reporting <= 0) return false;
      if (f.dispute === 'no' && c.disputed_reporting > 0) return false;
      if (f.broken === 'yes' && !c.promise_broken) return false;
      if (f.broken === 'no' && c.promise_broken) return false;
      return true;
    });
  }, [customers, f, unassigned]);

  const originalsOf = (c: CustomerRisk, pick: 'total' | 'overdue') => c.totals_by_currency.map((x) => ({ amount: x[pick], currency: x.currency }));

  const columns: Column<CustomerRisk>[] = [
    {
      key: 'name',
      header: t('col.customer'),
      sortValue: (c) => c.customer_name,
      render: (c) => (
        <>
          <Link to={customerLink(c.customer_id)} onClick={(e) => e.stopPropagation()}>
            {c.customer_name}
          </Link>
          <span className="cell-sub">{c.region}</span>
        </>
      ),
    },
    { key: 'country', header: t('col.country'), sortValue: (c) => c.country, render: (c) => c.country },
    { key: 'entity', header: t('col.entity'), sortValue: (c) => c.control_company ?? '', render: (c) => (c.control_company ? <span data-testid="customer-entity">{c.control_company}</span> : <span className="muted" data-testid="customer-entity">{unassignedEntity}</span>) },
    { key: 'owner', header: t('col.owner'), sortValue: (c) => c.account_owner_name || unassigned, render: (c) => c.account_owner_name || <span className="muted">{unassigned}</span> },
    {
      key: 'ccy',
      header: t('col.contractCurrency'),
      sortValue: (c) => c.contract_currency,
      render: (c) => {
        const others = c.totals_by_currency.map((x) => x.currency).filter((x) => x !== c.contract_currency);
        return (
          <span className="tnum" data-testid="contract-currency">
            {c.contract_currency}
            {others.length > 0 && <span className="cell-sub">{t('customers.multiCurrency', { list: [c.contract_currency, ...others].join(', ') })}</span>}
          </span>
        );
      },
    },
    {
      key: 'total',
      header: t('col.totalOutstanding'),
      align: 'right',
      sortValue: (c) => c.total_outstanding_reporting,
      render: (c) => <Money amount={c.total_outstanding_reporting} currency={ccy} originals={originalsOf(c, 'total')} />,
    },
    { key: 'overdue', header: t('col.overdue'), align: 'right', sortValue: (c) => c.overdue_reporting, render: (c) => <Money amount={c.overdue_reporting} currency={ccy} originals={originalsOf(c, 'overdue')} /> },
    { key: 'aging', header: t('col.maxAging'), align: 'right', sortValue: (c) => c.max_aging_days, render: (c) => (c.max_aging_days > 0 ? c.max_aging_days : <span className="muted">0</span>) },
    { key: 'over30', header: t('col.over30'), align: 'right', sortValue: (c) => c.overdue_30_plus_reporting, render: (c) => <Money amount={c.overdue_30_plus_reporting} currency={ccy} /> },
    {
      key: 'util',
      header: t('col.creditUtil'),
      align: 'right',
      title: t('col.creditUtilTitle'),
      sortValue: (c) => c.credit_utilization,
      render: (c) =>
        c.credit_utilization === null ? (
          <span className="muted" title={t('customers.noCreditLimit')}>
            {t('common.na')}
          </span>
        ) : (
          <span style={c.credit_limit_exceeded ? { color: 'var(--critical-text)', fontWeight: 600 } : undefined}>{fmtRatio(c.credit_utilization, 0)}</span>
        ),
    },
    { key: 'wow', header: t('col.wowOverdue'), align: 'right', sortValue: (c) => c.wow_overdue_change_reporting, render: (c) => <Money amount={c.wow_overdue_change_reporting} currency={ccy} signed tone /> },
    { key: 'lastpay', header: t('col.lastPayment'), sortValue: (c) => c.last_payment_date, render: (c) => <span className="tnum">{fmtDate(c.last_payment_date)}</span> },
    {
      key: 'promise',
      header: t('col.nextPromise'),
      sortValue: (c) => c.next_promise_date,
      render: (c) => (
        <span className="tnum">
          {fmtDate(c.next_promise_date)}
          {c.next_promise_amount_reporting !== null && <span className="cell-sub">{<Money amount={c.next_promise_amount_reporting} currency={ccy} />}</span>}
        </span>
      ),
    },
    {
      key: 'broken',
      header: t('col.promiseBroken'),
      sortValue: (c) => (c.promise_broken ? 1 : 0),
      render: (c) =>
        c.promise_broken ? (
          <StatusPill tone="critical" icon={false} title={t('customers.brokenAmount', { amount: `${c.broken_promise_amount_reporting} ${ccy}` })}>
            <IconWarning width={12} height={12} /> {t('common.yes')}
          </StatusPill>
        ) : (
          <StatusPill tone="neutral" icon={false}>
            <IconCheck width={12} height={12} /> {t('common.no')}
          </StatusPill>
        ),
    },
    { key: 'disputed', header: t('col.disputed'), align: 'right', sortValue: (c) => c.disputed_reporting, render: (c) => (c.disputed_reporting > 0 ? <Money amount={c.disputed_reporting} currency={ccy} /> : <span className="muted">—</span>) },
    { key: 'risk', header: t('col.riskScore'), align: 'right', sortValue: (c) => c.risk.score, render: (c) => <strong className="tnum">{c.risk.score}</strong> },
    { key: 'grade', header: t('col.riskGrade'), sortValue: (c) => GRADES.indexOf(c.risk.grade), render: (c) => <RiskBadge risk={c.risk} showScore={false} /> },
    { key: 'action', header: t('col.recommendedAction'), render: (c) => <span style={{ display: 'inline-block', minWidth: 220, whiteSpace: 'normal' }}>{c.recommended_action}</span> },
  ];

  function onSortSelect(v: string) {
    setSortKey(v);
    setSortDir('desc');
  }

  const reset = () => setF({ country: '', entity: '', region: '', owner: '', currency: '', q: '', bucket: '', grade: '', dispute: '', broken: '' });
  const sortLabel = SORT_OPTIONS.find((o) => o.value === sortKey);
  const yesNoOptions = [
    { value: 'yes', label: t('common.yes') },
    { value: 'no', label: t('common.no') },
  ];

  return (
    <div>
      <PageHeader title={t('customers.title')} subtitle={t('customers.subtitle')} />

      <FilterBar onReset={reset} summary={t('customers.summary', { shown: rows.length, total: customers.length, sort: sortLabel ? t(sortLabel.label) : sortKey, dir: sortDir })}>
        <TextFilter id="f-q" label={t('filter.customerName')} value={f.q} onChange={set('q')} testId="customers-search" />
        <SelectFilter id="f-country" label={t('filter.country')} value={f.country} onChange={set('country')} options={countries} />
        <SelectFilter id="f-entity" label={t('filter.entity')} value={f.entity} onChange={set('entity')} options={entities} testId="customers-entity-filter" />
        <SelectFilter id="f-region" label={t('filter.region')} value={f.region} onChange={set('region')} options={regions} />
        <SelectFilter id="f-owner" label={t('filter.owner')} value={f.owner} onChange={set('owner')} options={owners} />
        <SelectFilter id="f-currency" label={t('filter.contractCurrency')} value={f.currency} onChange={set('currency')} options={currencies} />
        <SelectFilter id="f-bucket" label={t('filter.agingBucket')} value={f.bucket} onChange={set('bucket')} options={AGING_BUCKETS.map((b) => ({ value: b, label: AGING_BUCKET_LABEL_I18N[lang][b] }))} allLabel={t('common.any')} />
        <SelectFilter id="f-grade" label={t('filter.riskGrade')} value={f.grade} onChange={set('grade')} options={GRADES.map((g) => ({ value: g, label: RISK_GRADE_LABEL_I18N[lang][g] }))} testId="customers-grade-filter" />
        <SelectFilter id="f-dispute" label={t('filter.dispute')} value={f.dispute} onChange={set('dispute')} options={yesNoOptions} allLabel={t('common.any')} />
        <SelectFilter id="f-broken" label={t('filter.promiseBroken')} value={f.broken} onChange={set('broken')} options={yesNoOptions} allLabel={t('common.any')} />
        <SelectFilter id="f-sort" label={t('filter.sortBy')} value={sortKey} onChange={onSortSelect} options={SORT_OPTIONS.map((o) => ({ value: o.value, label: t(o.label) }))} allLabel={null} testId="customers-sort" />
      </FilterBar>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(c) => c.customer_id}
        sortKey={sortKey}
        sortDir={sortDir}
        onSortChange={(k, d) => {
          setSortKey(k);
          setSortDir(d);
        }}
        onRowClick={(c) => navigate(customerLink(c.customer_id))}
        rowHref={(c) => customerLink(c.customer_id)}
        testId="customers-table"
        caption={t('customers.caption')}
        emptyMessage={t('customers.empty')}
      />
    </div>
  );
}
