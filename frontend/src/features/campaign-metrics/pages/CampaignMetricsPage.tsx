import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Users, Radio, MapPin } from 'lucide-react';
import clsx from 'clsx';

import { campaignApi } from '../api';
import type { AccountMetricsRow, CampaignFilter, CampaignService } from '../api';
import { useCdrStatus, useCampaignDate } from '../hooks';
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

const VIEW_META: Record<View, { column: string; placeholder: string; icon: typeof Radio }> = {
  account: { column: 'Account', placeholder: 'Search account…', icon: Users },
  provider: { column: 'Service Provider', placeholder: 'Search provider…', icon: Radio },
  location: { column: 'Location', placeholder: 'Search location…', icon: MapPin },
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

  const filters: CampaignFilter = { date, service };
  const queryKey = ['campaign', view, filters.date, filters.service] as const;
  const enabled = status.available;

  const accountQuery = useQuery({
    queryKey,
    queryFn: () => campaignApi.accountWise(filters),
    enabled: enabled && view === 'account',
  });
  const providerQuery = useQuery({
    queryKey,
    queryFn: () => campaignApi.serviceProviderWise(filters),
    enabled: enabled && view === 'provider',
  });
  const locationQuery = useQuery({
    queryKey,
    queryFn: () => campaignApi.locationWise(filters),
    enabled: enabled && view === 'location',
  });

  const active =
    view === 'account' ? accountQuery : view === 'provider' ? providerQuery : locationQuery;

  // Search and sort both live here rather than inside the tables, so Export can
  // hand back exactly what the table is showing — every page of it, in the
  // order it is shown.
  const term = search.trim().toLowerCase();

  const accountRows = useMemo(() => {
    const rows = accountQuery.data?.rows;
    if (!rows || !term) return rows;
    return rows.filter((r) => r.account.toLowerCase().includes(term));
  }, [accountQuery.data, term]);

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
    <div className="p-8 max-w-[1500px] mx-auto min-h-full">
      <div className="space-y-5">
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

        <MetricsToolbar
          tabs={VIEWS}
          active={view}
          onTab={(next) => {
            setView(next);
            // The term belongs to the column it was typed against; carrying
            // "109775" into Location wise would silently show an empty table.
            setSearch('');
          }}
          search={search}
          onSearch={setSearch}
          searchPlaceholder={meta.placeholder}
          onExport={handleExport}
          canExport={visibleCount > 0}
        />

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

        {term && visibleCount === 0 && !active.isPending && !active.error && (
          <p className={clsx('text-center text-sm text-zinc-500 dark:text-zinc-400')}>
            Nothing matches “{search.trim()}”.
          </p>
        )}
      </div>
    </div>
  );
}
