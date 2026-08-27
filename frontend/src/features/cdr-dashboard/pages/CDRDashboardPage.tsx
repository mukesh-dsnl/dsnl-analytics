import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useHeaderSlot } from '../../../components/HeaderSlot';
import { filtersForDay } from '../api';
import type { CdrFilters, CdrService, CdrStatus } from '../api';
import { spanDays } from '../dateRange';
import { useCdrStatus, useDateRange, useDebouncedValue } from '../hooks';
import { CDRDashboard } from '../components/CDRDashboard';
import { ServiceFilterBar } from '../components/ServiceFilterBar';
import type { DetailField } from '../components/ServiceFilterBar';

interface CDRDashboardPageProps {
  service: CdrService;
}

/**
 * Which narrowing fields each service tab offers, beyond the date range
 * (always shown) and the service itself (fixed by the route).
 *
 * Conference and Multicall share a field set — CPIN (CODR.CHAIR_PIN) only
 * means anything once CODR is in the join, which both of them force. All has
 * no identity scheme of its own, so it gets no fields at all.
 */
const SERVICE_FIELDS: Record<CdrService, DetailField[]> = {
  all: [],
  voicedrop: ['account_id', 'crn', 'time_from', 'time_to'],
  conference: ['account_id', 'crn', 'conf_num', 'cpin', 'time_from', 'time_to'],
  multicall: ['account_id', 'crn', 'conf_num', 'cpin', 'time_from', 'time_to'],
};

function Banner({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 text-sm text-red-700 dark:text-red-400">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * One CDR analytics service (All / Voicedrop / Conference / Multicall).
 *
 * There is nothing to upload and no ingest to wait for. The backend reads the
 * daily parquet exports where they sit, and the date range decides which of
 * them it opens — so the range applies to every field below it and starts on
 * the single day the backend nominates (yesterday) rather than a range wide
 * enough to be slow.
 */
export function CDRDashboardPage({ service }: CDRDashboardPageProps) {
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

  return <Analytics service={service} status={status} />;
}

/**
 * Split out so the filter state can be seeded from the lake's own dates.
 * Mounting only once the status is known keeps that a plain initial value
 * instead of an effect that resets the filters after the first render.
 */
function Analytics({ service, status }: { service: CdrService; status: CdrStatus }) {
  // The date range lives in the header now, so it comes from the shared store
  // rather than from this page's own state — which is also what keeps it
  // steady while navigating between the service pages.
  const { from, to } = useDateRange(status);
  // The filters render into the app header, beside the date control — see
  // components/HeaderSlot. They stay owned by this page (the field set differs
  // per service) and merely appear up there.
  const headerSlot = useHeaderSlot();

  // Everything except the dates. Seeded with `from` only so the shape is
  // complete; the dates the query actually uses are spliced in below.
  const [filters, setFilters] = useState<CdrFilters>(() => filtersForDay(from, service));

  // Switching service empties the fields. They are all per-service identifiers
  // — a CRN or a CPIN read against Voicedrop matches nothing on Conference —
  // and the field set itself changes, so anything typed into a field the next
  // service doesn't offer would keep narrowing the query while invisible. The
  // date range is deliberately untouched: it lives in the shared store above,
  // which is what keeps the selected days steady across the whole module.
  //
  // Adjusted during render rather than in an effect: React re-runs this
  // component with the new state before committing, so the filter bar never
  // paints one frame holding the previous service's values.
  const [filtersFor, setFiltersFor] = useState(service);
  if (filtersFor !== service) {
    setFiltersFor(service);
    setFilters(filtersForDay(from, service));
  }

  const fields = SERVICE_FIELDS[service];

  // Only the typed fields are debounced, and deliberately so. Holding the
  // dates back too would mean that widening the range fires a query for the
  // *old* range first and makes the backend read a month of files nobody is
  // waiting for. Dates are discrete clicks, so they apply at once.
  const { account_id, crn, conf_num, cpin, time_from, time_to } = filters;
  const typed = useMemo(
    () => ({ account_id, crn, conf_num, cpin, time_from, time_to }),
    [account_id, crn, conf_num, cpin, time_from, time_to],
  );
  const debouncedTyped = useDebouncedValue(typed, 400);
  const isSettling = typed !== debouncedTyped;

  const query = useMemo<CdrFilters>(
    () => ({ ...filters, ...debouncedTyped, service, date_from: from, date_to: to }),
    [filters, debouncedTyped, service, from, to],
  );

  const span = spanDays(query.date_from, query.date_to);
  const isReversed = query.date_to < query.date_from;
  const isTooWide = span > status.max_range_days;
  const isQueryable = status.available && !isReversed && !isTooWide;

  return (
    <div className="p-8 max-w-[1500px] mx-auto min-h-full">
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

        {status.available && !status.codr.available && (service === 'conference' || service === 'multicall') && (
          <Banner>
            <p className="font-medium">
              CODR is unreadable — {service === 'conference' ? 'Conference' : 'Multicall'} is unavailable.
            </p>
            <p className="mt-0.5 break-words">
              {service === 'conference' ? 'Conference' : 'Multicall'} is indistinguishable without CODR's
              MODULE_TYPE.
            </p>
          </Banner>
        )}

        {headerSlot &&
          createPortal(
            <ServiceFilterBar
              fields={fields}
              value={filters}
              onChange={setFilters}
              isPending={isSettling}
            />,
            headerSlot,
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
