import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { TrackerProvider } from '@app/data/TrackerContext';
import { Layout } from '@app/components/Layout';
import { DataGate } from '@app/components/States';
import { isLang, useI18n } from '@app/i18n/useI18n';
import { OverviewPage } from '@app/pages/OverviewPage';
import { AgingPage } from '@app/pages/AgingPage';
import { CustomersPage } from '@app/pages/CustomersPage';
import { CustomerDetailPage } from '@app/pages/CustomerDetailPage';
import { InvoicesPage } from '@app/pages/InvoicesPage';
import { ActionsPage } from '@app/pages/ActionsPage';
import { InsightsPage } from '@app/pages/InsightsPage';

const gated = (el: JSX.Element) => <DataGate>{el}</DataGate>;

/** A later `?lang=` in the hash query (e.g. a pasted link) wins over the persisted choice. */
function LangQuerySync() {
  const [sp] = useSearchParams();
  const q = sp.get('lang');
  const { lang, setLang } = useI18n();
  useEffect(() => {
    if (isLang(q) && q !== lang) setLang(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  return null;
}

export default function App() {
  return (
    <HashRouter>
      <LangQuerySync />
      <TrackerProvider>
        <Layout>
          <Routes>
            <Route path="/" element={gated(<OverviewPage />)} />
            <Route path="/aging" element={gated(<AgingPage />)} />
            <Route path="/customers" element={gated(<CustomersPage />)} />
            <Route path="/customers/:id" element={gated(<CustomerDetailPage />)} />
            <Route path="/invoices" element={gated(<InvoicesPage />)} />
            <Route path="/actions" element={gated(<ActionsPage />)} />
            <Route path="/insights" element={gated(<InsightsPage />)} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </TrackerProvider>
    </HashRouter>
  );
}
