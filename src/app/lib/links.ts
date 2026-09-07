export interface InvoiceFilterParams {
  bucket?: string | null;
  country?: string | null;
  owner?: string | null;
  customer?: string | null;
  currency?: string | null;
  status?: string | null;
  q?: string | null;
}

/** Route (path + search) for the invoice list with the given filters. Use with <Link to=...>. */
export function invoicesLink(p: InvoiceFilterParams): string {
  const sp = new URLSearchParams();
  (Object.keys(p) as (keyof InvoiceFilterParams)[]).forEach((k) => {
    const v = p[k];
    if (v) sp.set(k, v);
  });
  const qs = sp.toString();
  return `/invoices${qs ? `?${qs}` : ''}`;
}

export function customerLink(customerId: string): string {
  return `/customers/${encodeURIComponent(customerId)}`;
}

/** Customer list filtered to a managing entity (`control_company`; `unassigned` for customers without one). */
export function customersByEntityLink(entityKey: string): string {
  return `/customers?entity=${encodeURIComponent(entityKey)}`;
}
