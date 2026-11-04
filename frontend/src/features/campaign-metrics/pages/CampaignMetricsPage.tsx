import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Users, Radio, MapPin, Megaphone } from 'lucide-react';
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
import { CampaignsTable } from '../components/CampaignsTable';
import { CAMPAIGN_COLUMNS, withConnectedShare } from '../campaignRows';
import { conferenceSummaryApi } from '../../conference-summary/api';
import { RecordsTable } from '../../conference-summary/components/RecordsTable';
import type { ConferenceRow, ConferenceSortKey } from '../../conference-summary/components/RecordsTable';
import type { CampaignSortKey, CampaignTableRow } from '../campaignRows';
import type { ToolbarTab } from '../components/MetricsToolbar';

interface CampaignMetricsPageProps {
  service: CampaignService;
}

type View = 'account' | 'campaigns' | 'provider' | 'location';

const VIEWS: ToolbarTab<View>[] = [
  { id: 'account', label: 'Account wise', icon: Users },
  { id: 'provider', label: 'Service Provider wise', icon: Radio },
  { id: 'location', label: 'Location wise', icon: MapPin },
];

// Campaigns reads voicedrop_summary, which only Voicedrop has — so the tab is
// offered on Voicedrop alone, next to Account wise.
const VOICEDROP_VIEWS: ToolbarTab<View>[] = [
  VIEWS[0],
  { id: 'campaigns', label: 'Campaigns', icon: Megaphone },
  ...VIEWS.slice(1),
];

// Conference's Campaigns are its rooms, from conference_summary.
const CONFERENCE_VIEWS: ToolbarTab<View>[] = VOICEDROP_VIEWS;

/** The services with a Campaigns tab: their summary tables hold one row per campaign. */
const hasCampaigns = (service: CampaignService) => service === 'voicedrop' || service === 'conference';

const VIEW_META: Record<View, { column: string; icon: typeof Radio }> = {
  account: { column: 'Account', icon: Users },
  campaigns: { column: 'Campaign', icon: Megaphone },
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
  if (view === 'campaigns') {
    return service === 'conference' ? 'Search by account, CRN, Conf Num, PIN, DID or name…' : 'Search by CRN, account, client or name…';
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
  const { date, setDate } = useCampaignDate(status);
  // A Summary page links here as ?view=campaigns&date=…&search=<account>.
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>(() => {
    const asked = params.get('view');
    if (asked === 'campaigns') return hasCampaigns(service) ? 'campaigns' : 'account';
    return asked === 'provider' || asked === 'location' ? asked : 'account';
  });
  const [search, setSearch] = useState(() => params.get('search') ?? '');
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
    // Campaigns exists on Voicedrop and Conference; leaving them lands on Account wise.
    if (view === 'campaigns' && !hasCampaigns(service)) setView('account');
  }

  // The view, the day and the search live in the URL (?view=&date=&search=),
  // so any table here can be linked to, and a link from a Summary page opens
  // straight on its day. A date arriving in the URL is applied to the date
  // control first; until it has been, the URL is left as it arrived.
  const arrivedDate = useRef(params.get('date'));
  useEffect(() => {
    const asked = arrivedDate.current;
    if (asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked !== date) setDate(asked);
    else arrivedDate.current = null;
    // On arrival only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (arrivedDate.current && date !== arrivedDate.current) return;
    arrivedDate.current = null;
    const next = new URLSearchParams();
    if (view !== 'account') next.set('view', view);
    if (date) next.set('date', date);
    if (search.trim()) next.set('search', search.trim());
    if (next.toString() !== window.location.search.replace(/^\?/, '')) setParams(next, { replace: true });
    // setParams is stable enough here; the URL follows these three only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, date, search]);

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

  const campaignsQuery = useQuery({
    queryKey: ['campaign', 'campaigns', filters.date],
    queryFn: () => campaignApi.campaigns(filters),
    enabled: view === 'campaigns' && service === 'voicedrop',
  });
  const conferenceQuery = useQuery({
    queryKey: ['conference-summary', 'records', filters.date],
    queryFn: () => conferenceSummaryApi.records(filters.date),
    enabled: view === 'campaigns' && service === 'conference',
  });

  const active =
    view === 'account'
      ? accountQuery
      : view === 'campaigns'
        ? service === 'conference'
          ? conferenceQuery
          : campaignsQuery
        : view === 'provider'
          ? providerQuery
          : locationQuery;

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

  // Campaign rows are one day's tens of campaigns, filtered here.
  const campaignRows = useMemo((): CampaignTableRow[] | undefined => {
    const rows = campaignsQuery.data?.rows.map(withConnectedShare);
    if (!rows || !term) return rows;
    return rows.filter((r) =>
      [r.crn, r.account_id, r.client_id, r.name ?? '', r.booking_reference ?? '']
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [campaignsQuery.data, term]);
  // Conference rooms for the day, filtered the same way, across their own columns.
  const conferenceRows = useMemo((): ConferenceRow[] | undefined => {
    const rows = conferenceQuery.data?.rows.map((r) => ({
      ...r,
      conference_name: r.conference_name ?? '',
      account_name: r.account_name ?? '',
      start_time: r.start_time ?? '',
      connect_rate: r.ringed ? Math.round((r.connected / r.ringed) * 1000) / 10 : 0,
    }));
    if (!rows || !term) return rows;
    return rows.filter((r) =>
      [r.account_id, r.account_name, r.crn, r.conf_num, r.conference_name, r.pin ?? '', ...r.dids].some((v) =>
        String(v).toLowerCase().includes(term),
      ),
    );
  }, [conferenceQuery.data, term]);
  const conferenceSort = useSortableRows<ConferenceRow, ConferenceSortKey>(conferenceRows, {
    key: 'start_time',
    direction: 'asc',
  });

  const campaignSort = useSortableRows<CampaignTableRow, CampaignSortKey>(campaignRows, {
    key: 'start_time',
    direction: 'asc',
  });

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
    if (view === 'campaigns' && service === 'conference') {
      downloadCsv(
        `campaign-${stamp}.csv`,
        [
          'Account ID', 'Account Name', 'Call Date', 'CRN', 'Conf Num', 'Start Time', 'End Time', 'Conference Name',
          'PIN', 'DID', 'Total Ringed Calls', 'Total Connected Calls', 'Total Call Duration (Mins)',
          'Total Attended Duration (Mins)', 'Peak Port Used',
        ],
        (conferenceSort.rows ?? []).map((r) => [
          r.account_id, r.account_name, r.date, r.crn, r.conf_num, r.start_time, r.end_time, r.conference_name,
          r.pin, r.dids.join(', '), r.ringed, r.connected, r.call_minutes, r.attended_minutes, r.peak_port,
        ]),
      );
      return;
    }
    if (view === 'campaigns') {
      downloadCsv(
        `campaign-${stamp}.csv`,
        ['Date', ...CAMPAIGN_COLUMNS.map((c) => c.label)],
        (campaignSort.rows ?? []).map((r) => [
          r.date,
          ...CAMPAIGN_COLUMNS.map((c) => r[c.key]),
        ]),
      );
      return;
    }
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
    view === 'account'
      ? (accountSort.rows?.length ?? 0)
      : view === 'campaigns'
        ? service === 'conference'
          ? (conferenceSort.rows?.length ?? 0)
          : (campaignSort.rows?.length ?? 0)
        : (simpleSort.rows?.length ?? 0);

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
            tabs={service === 'voicedrop' ? VOICEDROP_VIEWS : service === 'conference' ? CONFERENCE_VIEWS : VIEWS}
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
          ) : view === 'campaigns' && service === 'conference' ? (
            <RecordsTable
              rows={conferenceSort.rows}
              isLoading={conferenceQuery.isPending}
              error={conferenceQuery.error}
              sort={conferenceSort.sort}
              onSort={conferenceSort.toggle}
            />
          ) : view === 'campaigns' ? (
            <CampaignsTable
              rows={campaignSort.rows}
              isLoading={campaignsQuery.isPending}
              error={campaignsQuery.error}
              sort={campaignSort.sort}
              onSort={campaignSort.toggle}
            />
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
