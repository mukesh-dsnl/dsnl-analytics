import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { Login } from './pages/Login';

// The analytics pages pull in the charting library, which is heavier than the
// rest of the app put together. Loading it on demand keeps that weight off
// every other route instead of taxing the initial bundle for a page most
// sessions never open.
const CDRDashboardPage = lazy(() =>
  import('./features/cdr-dashboard/pages/CDRDashboardPage').then((m) => ({ default: m.CDRDashboardPage })),
);
const CampaignMetricsPage = lazy(() =>
  import('./features/campaign-metrics/pages/CampaignMetricsPage').then((m) => ({
    default: m.CampaignMetricsPage,
  })),
);

function RouteFallback() {
  return (
    <div className="flex items-center justify-center p-24">
      <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<Layout />}>
              <Route index element={<Navigate to="/analytics/all" replace />} />
              <Route path="analytics">
                <Route index element={<Navigate to="all" replace />} />
                <Route
                  path="all"
                  element={
                    <Suspense fallback={<RouteFallback />}>
                      <CDRDashboardPage service="all" />
                    </Suspense>
                  }
                />
                <Route
                  path="voicedrop"
                  element={
                    <Suspense fallback={<RouteFallback />}>
                      <CDRDashboardPage service="voicedrop" />
                    </Suspense>
                  }
                />
                <Route
                  path="conference"
                  element={
                    <Suspense fallback={<RouteFallback />}>
                      <CDRDashboardPage service="conference" />
                    </Suspense>
                  }
                />
                <Route
                  path="multicall"
                  element={
                    <Suspense fallback={<RouteFallback />}>
                      <CDRDashboardPage service="multicall" />
                    </Suspense>
                  }
                />
              </Route>
              <Route path="campaign-metrics">
                <Route index element={<Navigate to="voicedrop" replace />} />
                <Route
                  path="voicedrop"
                  element={
                    <Suspense fallback={<RouteFallback />}>
                      <CampaignMetricsPage service="voicedrop" />
                    </Suspense>
                  }
                />
                <Route
                  path="conference"
                  element={
                    <Suspense fallback={<RouteFallback />}>
                      <CampaignMetricsPage service="conference" />
                    </Suspense>
                  }
                />
                <Route
                  path="multicall"
                  element={
                    <Suspense fallback={<RouteFallback />}>
                      <CampaignMetricsPage service="multicall" />
                    </Suspense>
                  }
                />
              </Route>
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
