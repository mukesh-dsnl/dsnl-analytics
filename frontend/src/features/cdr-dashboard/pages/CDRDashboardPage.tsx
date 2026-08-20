import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, BarChart3, Loader2 } from 'lucide-react';
import { filtersForDay } from '../api';
import type { CdrFilters, CdrStatus } from '../api';
import { spanDays } from '../dateRange';
import { useCdrStatus, useDebouncedValue } from '../hooks';
import { CDRDashboard } from '../components/CDRDashboard';
import { CustomFilterBar } from '../components/CustomFilterBar';
import { DateSelector } from '../components/DateSelector';
import { ServiceTabs } from '../components/ServiceTabs';
import type { ServiceTab } from '../components/ServiceTabs';

function Banner({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 text-sm text-red-700 dark:text-red-400">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * The whole CDR analytics feature: one page, one set of filters.
 *
 * There is nothing to upload and no ingest to wait for. The backend reads the
 * daily parquet exports where they sit, and the date range decides which of
 * them it opens — so the range sits with the service tabs, applying to every
 * one of them, and starts on the single day the backend nominates (yesterday)
 * rather than on a range wide enough to be slow.
 */
export function CDRDashboardPage() {
  const { data: status, isPending, error, refetch } = useCdrStatus();

  if (isPending) {
    return (
      <div className="flex items-center justify-center p-24">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <Banner>
          <p className="font-medium">Couldn't reach the CDR service.</p>
          <p className="mt-0.5 break-words">{error.message}</p>
          <button onClick={() => refetch()} className="mt-2 text-xs font-semibold underline">
            Retry
          </button>
        </Banner>
      </div>
    );
  }

  return <Analytics status={status} />;
}

/**
 * Split out so the filter state can be seeded from the lake's own dates.
 * Mounting only once the status is known keeps that a plain initial value
 * instead of an effect that resets the filters after the first render.
 */
function Analytics({ status }: { status: CdrStatus }) {
  const [tab, setTab] = useState<ServiceTab>('all');
  const [filters, setFilters] = useState<CdrFilters>(() =>
    filtersForDay(status.default_date ?? status.cdr.date_max ?? new Date().toISOString().slice(0, 10)),
  );

  // Only the typed fields are debounced, and deliberately so. Holding the
  // dates back too would mean that collapsing a wide range — switching off
  // Custom, or picking a new day — fires a query for the *old* range first and
  // makes the backend read a month of files nobody is waiting for. Dates and
  // tabs are discrete clicks, so they apply at once.
  const { account_id, crn, conf_num, time_from, time_to } = filters;
  const typed = useMemo(
    () => ({ account_id, crn, conf_num, time_from, time_to }),
    [account_id, crn, conf_num, time_from, time_to],
  );
  const debouncedTyped = useDebouncedValue(typed, 400);
  const isSettling = typed !== debouncedTyped;

  // Custom drops the service constraint entirely — its narrowing happens in
  // the filter bar instead.
  const query = useMemo<CdrFilters>(
    () => ({ ...filters, ...debouncedTyped, service: tab === 'custom' ? 'all' : tab }),
    [filters, debouncedTyped, tab],
  );

  /**
   * Leaving Custom collapses the range to a single day, since that is all the
   * other tabs show. The end of the range wins: it is the more recent day, and
   * the one whose data you were most likely reading.
   */
  const selectTab = (next: ServiceTab) => {
    setTab(next);
    if (next !== 'custom') {
      setFilters((prev) =>
        prev.date_from === prev.date_to ? prev : { ...prev, date_from: prev.date_to },
      );
    }
  };

  const span = spanDays(query.date_from, query.date_to);
  const isReversed = query.date_to < query.date_from;
  const isTooWide = span > status.max_range_days;
  const isQueryable = status.available && !isReversed && !isTooWide;

  return (
    <div className="p-8 max-w-[1500px] mx-auto min-h-full">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-500 flex items-center justify-center shrink-0">
          <BarChart3 className="w-5 h-5" />
        </div>
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-white transition-colors duration-300">
          CDR Analytics
        </h1>
      </div>

      <div className="space-y-6">
        {!status.available && (
          <Banner>
            <p className="font-medium">No CDR exports are readable.</p>
            <p className="mt-0.5 break-words">
              {status.cdr.error ?? 'Nothing found in the configured directory.'} Check
              CDR_LAKE_PATH and CODR_LAKE_PATH in the backend .env.
            </p>
          </Banner>
        )}

        {status.available && !status.codr.available && (
          <Banner>
            <p className="font-medium">
              CODR is unreadable — Conference and Multicall are unavailable.
            </p>
            <p className="mt-0.5 break-words">
              Those two are indistinguishable without CODR's MODULE_TYPE; the other tabs are
              unaffected.
            </p>
          </Banner>
        )}

        {/* Service and date share a line. The service tabs each show one day;
            only Custom opens the date up into a range. */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <ServiceTabs value={tab} onChange={selectTab} />
          <DateSelector
            value={filters}
            onChange={setFilters}
            status={status}
            mode={tab === 'custom' ? 'range' : 'single'}
          />
        </div>

        {tab === 'custom' && (
          <CustomFilterBar value={filters} onChange={setFilters} isPending={isSettling} />
        )}

        {isQueryable ? (
          <CDRDashboard filters={query} />
        ) : (
          <div className="px-5 py-12 text-center rounded-md border border-dashed border-zinc-300 dark:border-zinc-700 text-sm text-zinc-500 dark:text-zinc-400">
            {!status.available
              ? 'The dashboard needs a readable CDR export directory.'
              : isReversed
                ? 'The end of the range is before its start.'
                : `${span} days selected — the range can span at most ${status.max_range_days}.`}
          </div>
        )}
      </div>
    </div>
  );
}
