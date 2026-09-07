import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AGING_BUCKET_LABEL, AGING_BUCKETS, type AgingBucket, type CustomerRisk, type RiskGrade } from '@core/types';
import { useReadyTracker } from '@app/data/TrackerContext';
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

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'risk', label: 'Risk score' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'aging', label: 'Max aging days' },
  { value: 'wow', label: 'WoW deterioration' },
  { value: 'util', label: 'Credit utilization' },
];

interface Filters {
  country: string;
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
  const ccy = model.reporting_currency;
  const navigate = useNavigate();
  const [sp] = useSearchParams();

  const [f, setF] = useState<Filters>({
    country: sp.get('country') ?? '',
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
  const regions = distinct(customers, (c) => c.region);
  const owners = distinct(customers, (c) => c.account_owner_name || 'Unassigned');
  const currencies = distinct(customers, (c) => c.contract_currency);

  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return customers.filter((c) => {
      if (f.country && c.country !== f.country) return false;
      if (f.region && c.region !== f.region) return false;
      if (f.owner && (c.account_owner_name || 'Unassigned') !== f.owner) return false;
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
  }, [customers, f]);

  const columns: Column<CustomerRisk>[] = [
    {
      key: 'name',
      header: 'Customer',
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
    { key: 'country', header: 'Country', sortValue: (c) => c.country, render: (c) => c.country },
    { key: 'owner', header: 'Owner', sortValue: (c) => c.account_owner_name || 'Unassigned', render: (c) => c.account_owner_name || <span className="muted">Unassigned</span> },
    { key: 'total', header: 'Total outstanding', align: 'right', sortValue: (c) => c.total_outstanding_reporting, render: (c) => <Money amount={c.total_outstanding_reporting} currency={ccy} /> },
    { key: 'overdue', header: 'Overdue', align: 'right', sortValue: (c) => c.overdue_reporting, render: (c) => <Money amount={c.overdue_reporting} currency={ccy} /> },
    { key: 'aging', header: 'Max aging days', align: 'right', sortValue: (c) => c.max_aging_days, render: (c) => (c.max_aging_days > 0 ? c.max_aging_days : <span className="muted">0</span>) },
    { key: 'over30', header: '30+ overdue', align: 'right', sortValue: (c) => c.overdue_30_plus_reporting, render: (c) => <Money amount={c.overdue_30_plus_reporting} currency={ccy} /> },
    {
      key: 'util',
      header: 'Credit utilization %',
      align: 'right',
      title: 'Total outstanding / credit limit (converted to reporting currency)',
      sortValue: (c) => c.credit_utilization,
      render: (c) =>
        c.credit_utilization === null ? (
          <span className="muted" title="No credit limit on file">
            n/a
          </span>
        ) : (
          <span style={c.credit_limit_exceeded ? { color: 'var(--critical-text)', fontWeight: 600 } : undefined}>{fmtRatio(c.credit_utilization, 0)}</span>
        ),
    },
    { key: 'wow', header: 'WoW change (overdue)', align: 'right', sortValue: (c) => c.wow_overdue_change_reporting, render: (c) => <Money amount={c.wow_overdue_change_reporting} currency={ccy} signed tone /> },
    { key: 'lastpay', header: 'Last payment', sortValue: (c) => c.last_payment_date, render: (c) => <span className="tnum">{fmtDate(c.last_payment_date)}</span> },
    {
      key: 'promise',
      header: 'Next promise',
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
      header: 'Promise broken',
      sortValue: (c) => (c.promise_broken ? 1 : 0),
      render: (c) =>
        c.promise_broken ? (
          <StatusPill tone="critical" icon={false} title={`Broken promise amount ${c.broken_promise_amount_reporting} ${ccy}`}>
            <IconWarning width={12} height={12} /> Yes
          </StatusPill>
        ) : (
          <StatusPill tone="neutral" icon={false}>
            <IconCheck width={12} height={12} /> No
          </StatusPill>
        ),
    },
    { key: 'disputed', header: 'Disputed', align: 'right', sortValue: (c) => c.disputed_reporting, render: (c) => (c.disputed_reporting > 0 ? <Money amount={c.disputed_reporting} currency={ccy} /> : <span className="muted">—</span>) },
    { key: 'risk', header: 'Risk score', align: 'right', sortValue: (c) => c.risk.score, render: (c) => <strong className="tnum">{c.risk.score}</strong> },
    { key: 'grade', header: 'Risk grade', sortValue: (c) => GRADES.indexOf(c.risk.grade), render: (c) => <RiskBadge risk={c.risk} showScore={false} /> },
    { key: 'action', header: 'Recommended action', render: (c) => <span style={{ display: 'inline-block', minWidth: 220, whiteSpace: 'normal' }}>{c.recommended_action}</span> },
  ];

  function onSortSelect(v: string) {
    setSortKey(v);
    setSortDir('desc');
  }

  const reset = () => setF({ country: '', region: '', owner: '', currency: '', q: '', bucket: '', grade: '', dispute: '', broken: '' });

  return (
    <div>
      <PageHeader title="Customer Risk" subtitle="Every customer with open balance, scored 0-100 on eight explainable factors. Click a row for the score breakdown, invoices and activity history." />

      <FilterBar onReset={reset} summary={<>Showing {rows.length} of {customers.length} customers · sorted by {SORT_OPTIONS.find((o) => o.value === sortKey)?.label ?? sortKey} ({sortDir})</>}>
        <TextFilter id="f-q" label="Customer name" value={f.q} onChange={set('q')} placeholder="Search…" testId="customers-search" />
        <SelectFilter id="f-country" label="Country" value={f.country} onChange={set('country')} options={countries} />
        <SelectFilter id="f-region" label="Region" value={f.region} onChange={set('region')} options={regions} />
        <SelectFilter id="f-owner" label="Owner" value={f.owner} onChange={set('owner')} options={owners} />
        <SelectFilter id="f-currency" label="Currency" value={f.currency} onChange={set('currency')} options={currencies} />
        <SelectFilter id="f-bucket" label="Aging bucket" value={f.bucket} onChange={set('bucket')} options={AGING_BUCKETS.map((b) => ({ value: b, label: AGING_BUCKET_LABEL[b] }))} allLabel="Any" />
        <SelectFilter id="f-grade" label="Risk grade" value={f.grade} onChange={set('grade')} options={GRADES} testId="customers-grade-filter" />
        <SelectFilter id="f-dispute" label="Dispute" value={f.dispute} onChange={set('dispute')} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} allLabel="Any" />
        <SelectFilter id="f-broken" label="Promise broken" value={f.broken} onChange={set('broken')} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} allLabel="Any" />
        <SelectFilter id="f-sort" label="Sort by" value={sortKey} onChange={onSortSelect} options={SORT_OPTIONS} allLabel={null} testId="customers-sort" />
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
        caption="Customer risk table"
        emptyMessage="No customers match the current filters."
      />
    </div>
  );
}
