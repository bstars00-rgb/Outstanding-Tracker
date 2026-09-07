import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { TrackerProvider } from '@app/data/TrackerContext';
import { Layout } from '@app/components/Layout';
import { DataGate } from '@app/components/States';
import { OverviewPage } from '@app/pages/OverviewPage';
import { AgingPage } from '@app/pages/AgingPage';
import { CustomersPage } from '@app/pages/CustomersPage';
import { CustomerDetailPage } from '@app/pages/CustomerDetailPage';
import { InvoicesPage } from '@app/pages/InvoicesPage';
import { ActionsPage } from '@app/pages/ActionsPage';
import { InsightsPage } from '@app/pages/InsightsPage';

const gated = (el: JSX.Element) => <DataGate>{el}</DataGate>;

export default function App() {
  return (
    <HashRouter>
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
