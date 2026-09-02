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
// Lazy for the same reason as the pages above, though for the opposite one: it
// is light, but most sessions never open it, so it stays out of the entry chunk.
const AiChatPage = lazy(() =>
  import('./features/ai-chat/pages/AiChatPage').then((m) => ({ default: m.AiChatPage })),
);

/**
 * The three services that have both views. "all" is handled separately: it has
 * no campaign-metrics counterpart, since that module reports per account,
 * carrier and location for one service at a time.
 */
const SERVICES = ['voicedrop', 'conference', 'multicall'] as const;

/** Where "/" and "/analytics" land. */
const DEFAULT_VIEW = '/analytics/all/attempt-metrics';

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
              <Route index element={<Navigate to={DEFAULT_VIEW} replace />} />

              {/* /analytics/<service>/<view> — service first, matching the
                  sidebar, so Back and the nav tree never disagree about where
                  you are. "all" takes the same shape as the rest even though
                  it has only one view: one route pattern, no special case in
                  the nav or the route table, and room for an all-services
                  campaign view later without changing today's URLs. */}
              <Route path="analytics">
                <Route index element={<Navigate to={DEFAULT_VIEW} replace />} />

                <Route
                  path="all/attempt-metrics"
                  element={
                    <Suspense fallback={<RouteFallback />}>
                      <CDRDashboardPage service="all" />
                    </Suspense>
                  }
                />

                {SERVICES.map((service) => (
                  <Route
                    key={`${service}-attempt`}
                    path={`${service}/attempt-metrics`}
                    element={
                      <Suspense fallback={<RouteFallback />}>
                        <CDRDashboardPage service={service} />
                      </Suspense>
                    }
                  />
                ))}

                {SERVICES.map((service) => (
                  <Route
                    key={`${service}-campaign`}
                    path={`${service}/campaign-metrics`}
                    element={
                      <Suspense fallback={<RouteFallback />}>
                        <CampaignMetricsPage service={service} />
                      </Suspense>
                    }
                  />
                ))}

                {/* A bare service is a section, not a page — but the collapsed
                    sidebar rail still navigates to it, so it has to land
                    somewhere rather than on an empty panel. */}
                <Route path="all" element={<Navigate to={DEFAULT_VIEW} replace />} />
                {SERVICES.map((service) => (
                  <Route
                    key={`${service}-index`}
                    path={service}
                    element={<Navigate to={`/analytics/${service}/attempt-metrics`} replace />}
                  />
                ))}
              </Route>

              {/* The assistant is a mode of the app, not a view of a service,
                  so it sits beside /analytics rather than inside it. Keeping it
                  out of the service slot also avoids /analytics/ai colliding
                  with /analytics/all — one letter apart in the same position.
                  The conversation id is in the path so a thread survives a
                  reload and can be linked to. */}
              <Route
                path="assistant"
                element={
                  <Suspense fallback={<RouteFallback />}>
                    <AiChatPage />
                  </Suspense>
                }
              />
              <Route
                path="assistant/:conversationId"
                element={
                  <Suspense fallback={<RouteFallback />}>
                    <AiChatPage />
                  </Suspense>
                }
              />

              {/* Old links, kept working. Bookmarks and browser history are
                  the only things that break on a restructure, and these are
                  cheap enough to leave in place indefinitely. */}
              <Route path="ai-chat" element={<Navigate to="/assistant" replace />} />
              <Route path="campaign-metrics">
                <Route
                  index
                  element={<Navigate to="/analytics/voicedrop/campaign-metrics" replace />}
                />
                {SERVICES.map((service) => (
                  <Route
                    key={`${service}-legacy`}
                    path={service}
                    element={
                      <Navigate to={`/analytics/${service}/campaign-metrics`} replace />
                    }
                  />
                ))}
              </Route>
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
