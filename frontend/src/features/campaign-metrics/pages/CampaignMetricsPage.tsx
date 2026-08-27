import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Users, Radio, MapPin } from 'lucide-react';
import clsx from 'clsx';

import { campaignApi } from '../api';
import type { AccountMetricsRow, CampaignFilter, CampaignService } from '../api';
import { useCdrStatus, useCampaignDate } from '../hooks';
import { useDebouncedValue } from '../../cdr-dashboard/hooks';
import { useHeaderSlot } from '../../../components/HeaderSlot';
import { HeaderSearch } from '../components/HeaderSearch';
import { useSortableRows } from '../useSortableRows';
import { downloadCsv } from '../exportCsv';
import type { CdrStatus } from '../../cdr-dashboard/api';
import { AccountWiseTable } from '../components/AccountWiseTable';
import { SimpleMetricsTable } from '../components/SimpleMetricsTable';
import type { SimpleRow, SimpleSortKey } from '../components/SimpleMetricsTable';
import { MetricsToolbar } from '../components/MetricsToolbar';
import type { ToolbarTab } from '../components/MetricsToolbar';

interface CampaignMetricsPageProps {
  service: CampaignService;
}

type View = 'account' | 'provider' | 'location';

const VIEWS: ToolbarTab<View>[] = [
  { id: 'account', label: 'Account wise', icon: Users },
  { id: 'provider', label: 'Service Provider wise', icon: Radio },
  { id: 'location', label: 'Location wise', icon: MapPin },
];

const VIEW_META: Record<View, { column: string; icon: typeof Radio }> = {
  account: { column: 'Account', icon: Users },
  provider: { column: 'Service Provider', icon: Radio },
  location: { column: 'Location', icon: MapPin },
};

/**
 * What the search box says it will match.
 *
 * On the Account view that is whatever the backend actually matches — account
 * id and CRN everywhere, plus the chairperson PIN where CODR is joined, which
 * is Conference and Multicall only. The other two views search their own single
 * column, in the client.
 */
function searchPlaceholder(view: View, service: CampaignService): string {
  if (view === 'account') {
    return service === 'voicedrop'
      ? 'Search by account or CRN…'
      : 'Search by account, CRN or CPIN…';
  }
  return view === 'provider' ? 'Search service provider…' : 'Search location…';
}

function Banner({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 text-sm text-red-700 dark:text-red-400">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * One Campaign Metrics service (Voicedrop / Conference / Multicall).
 *
 * Unlike the CDR analytics dashboard, this reads a single day rather than a
 * range — the date lives in its own header control (HeaderCampaignDate) and
 * store, so navigating between Campaign Metrics' three services keeps the
 * selected day.
 */
export function CampaignMetricsPage({ service }: CampaignMetricsPageProps) {
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

  return <Metrics service={service} status={status} />;
}

function Metrics({ service, status }: { service: CampaignService; status: CdrStatus }) {
  const { date } = useCampaignDate(status);
  const [view, setView] = useState<View>('account');
  const [search, setSearch] = useState('');
  const headerSlot = useHeaderSlot();

  // Same reasoning as switching view below: the term belongs to the service it
  // was typed against — an account or CPIN from Conference matches nothing on
  // Voicedrop — so changing service empties the box rather than showing an
  // empty table with no visible cause. The view tab and the selected date
  // stay: neither is service-specific.
  const [searchFor, setSearchFor] = useState(service);
  if (searchFor !== service) {
    setSearchFor(service);
    setSearch('');
  }

  const filters: CampaignFilter = { date, service };
  const enabled = status.available;

  // The account search runs server-side (CRN and CPIN aren't in these rows), so
  // it is part of the query key — and debounced, so typing doesn't fire a read
  // of the day's parquet per character.
  const debouncedSearch = useDebouncedValue(search.trim(), 400);
  const isSearchPending = view === 'account' && search.trim() !== debouncedSearch;

  const accountQuery = useQuery({
    queryKey: ['campaign', 'account', filters.date, filters.service, debouncedSearch],
    queryFn: () => campaignApi.accountWise(filters, debouncedSearch),
    enabled: enabled && view === 'account',
    placeholderData: (previous) => previous,
  });
  const providerQuery = useQuery({
    queryKey: ['campaign', 'provider', filters.date, filters.service],
    queryFn: () => campaignApi.serviceProviderWise(filters),
    enabled: enabled && view === 'provider',
  });
  const locationQuery = useQuery({
    queryKey: ['campaign', 'location', filters.date, filters.service],
    queryFn: () => campaignApi.locationWise(filters),
    enabled: enabled && view === 'location',
  });

  const active =
    view === 'account' ? accountQuery : view === 'provider' ? providerQuery : locationQuery;

  // Search and sort both live here rather than inside the tables, so Export can
  // hand back exactly what the table is showing — every page of it, in the
  // order it is shown.
  const term = search.trim().toLowerCase();

  // Account rows arrive already filtered by the backend; only the two
  // single-column views filter here.
  const accountRows = accountQuery.data?.rows;

  const simpleRows = useMemo((): SimpleRow[] | undefined => {
    const rows =
      view === 'provider'
        ? providerQuery.data?.rows.map((r) => ({ ...r, label: r.service_provider }))
        : view === 'location'
          ? locationQuery.data?.rows.map((r) => ({ ...r, label: r.location }))
          : undefined;
    if (!rows || !term) return rows;
    return rows.filter((r) => r.label.toLowerCase().includes(term));
  }, [view, providerQuery.data, locationQuery.data, term]);

  const accountSort = useSortableRows<AccountMetricsRow, keyof AccountMetricsRow>(accountRows, {
    key: 'total_size',
    direction: 'desc',
  });
  const simpleSort = useSortableRows<SimpleRow, SimpleSortKey>(simpleRows, {
    key: 'total_size',
    direction: 'desc',
  });

  const meta = VIEW_META[view];

  const handleExport = () => {
    const stamp = `${service}-${view}-${date}`;
    if (view === 'account') {
      downloadCsv(
        `campaign-${stamp}.csv`,
        ['Account', 'Total Size', 'Connected Size', 'Not Connected Size', 'Connected %', 'Total Minutes'],
        (accountSort.rows ?? []).map((r) => [
          r.account,
          r.total_size,
          r.connected_size,
          r.not_connected_size,
          r.connected_percentage,
          r.total_minutes,
        ]),
      );
      return;
    }
    downloadCsv(
      `campaign-${stamp}.csv`,
      [meta.column, 'Total Size', 'Connected Size', 'Not Connected Size', 'Connected %'],
      (simpleSort.rows ?? []).map((r) => [
        r.label,
        r.total_size,
        r.connected_size,
        r.not_connected_size,
        r.connected_percentage,
      ]),
    );
  };

  const visibleCount =
    view === 'account' ? (accountSort.rows?.length ?? 0) : (simpleSort.rows?.length ?? 0);

  return (
    // A full-height flex column rather than a growing page: the table below
    // takes the remaining space and scrolls inside itself, so the tabs, the
    // table's own header and the pager all stay put while the rows move.
    <div className="h-full p-8 max-w-[1500px] mx-auto">
      <div className="h-full flex flex-col gap-5 min-h-0">
        {!status.available && (
          <Banner>
            <p className="font-medium">No CDR exports are readable.</p>
            <p className="mt-0.5 break-words">
              {status.cdr.error ?? 'Nothing found in the configured directory.'} Check
              CDR_LAKE_PATH and CODR_LAKE_PATH in the backend .env.
            </p>
          </Banner>
        )}

        {status.available &&
          !status.codr.available &&
          (service === 'conference' || service === 'multicall') && (
            <Banner>
              <p className="font-medium">
                CODR is unreadable — {service === 'conference' ? 'Conference' : 'Multicall'} is
                unavailable.
              </p>
              <p className="mt-0.5 break-words">
                {service === 'conference' ? 'Conference' : 'Multicall'} is indistinguishable without
                CODR's MODULE_TYPE.
              </p>
            </Banner>
          )}

        {/* The search sits in the app header beside the date control — see
            components/HeaderSlot. It stays owned here because what it matches
            depends on the active view and service. */}
        {headerSlot &&
          createPortal(
            <HeaderSearch
              value={search}
              onChange={setSearch}
              placeholder={searchPlaceholder(view, service)}
              isPending={isSearchPending}
            />,
            headerSlot,
          )}

        <div className="shrink-0">
          <MetricsToolbar
            tabs={VIEWS}
            active={view}
            onTab={(next) => {
              setView(next);
              // The term belongs to the column it was typed against; carrying
              // "109775" into Location wise would silently show an empty table.
              setSearch('');
            }}
            onExport={handleExport}
            canExport={visibleCount > 0}
          />
        </div>

        {/* min-h-0 is what allows this to be shorter than its content, which is
            what hands the overflow to the table's own scroll region instead of
            the page. */}
        <div className="flex-1 min-h-0 flex flex-col">
          {!status.available ? (
            <div className="px-5 py-12 text-center rounded-md border border-dashed border-zinc-300 dark:border-zinc-700 text-sm text-zinc-500 dark:text-zinc-400">
              Campaign Metrics needs a readable CDR export directory.
            </div>
          ) : view === 'account' ? (
            <AccountWiseTable
              filters={filters}
              rows={accountSort.rows}
              isLoading={accountQuery.isPending}
              error={accountQuery.error}
              sort={accountSort.sort}
              onSort={accountSort.toggle}
              showCpin={service !== 'voicedrop'}
            />
          ) : (
            <SimpleMetricsTable
              columnLabel={meta.column}
              icon={meta.icon}
              rows={simpleSort.rows}
              isLoading={active.isPending}
              error={active.error}
              sort={simpleSort.sort}
              onSort={simpleSort.toggle}
            />
          )}

          {search.trim() && visibleCount === 0 && !active.isPending && !active.error && (
            <p className={clsx('mt-4 text-center text-sm text-zinc-500 dark:text-zinc-400')}>
              Nothing matches “{search.trim()}”.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
