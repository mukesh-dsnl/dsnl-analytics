import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { useHeaderSlot } from '../../../components/HeaderSlot';
import { HeaderSearch } from '../../campaign-metrics/components/HeaderSearch';
import { SingleDateSelector } from '../../campaign-metrics/components/SingleDateSelector';
import { HoverTooltipProvider } from '../../cdr-dashboard/components/attempt-analytics/HoverTooltip';
import { compact, fmt } from '../../cdr-dashboard/components/attempt-analytics/design';
import { AccountSelect, Centered, Problem } from '../../summary/components/PageParts';
import { Toggle } from '../../summary/components/ui';
import { dayLabel } from '../../summary/format';
import { conferenceSummaryApi } from '../api';
import { AccountView } from '../components/AccountView';
import { AccountDirectory } from '../../summary/components/AccountDirectory';
import { AllAccountsView } from '../components/AllAccountsView';
import { DayView } from '../components/DayView';

type View = 'all' | 'account' | 'day';

const VIEWS: { id: View; label: string }[] = [
  { id: 'all', label: 'All accounts' },
  { id: 'account', label: 'Account' },
  { id: 'day', label: 'Day' },
];

const PROBLEM = "Couldn't read conference_summary.";

/**
 * Conference › Summary, from q100_dump.conference_summary (one row per
 * conference per day) and conference_daily_summary on 192.168.0.117.
 *
 * Three tabs, one URL, as the Voicedrop summary:
 *   (none)                    every account together
 *   ?account=1152             one account's history
 *   ?view=day&date=…&q=…      one day's conferences and the daily summary
 * Clicking a day on a chart opens its Campaigns in Campaign Metrics.
 */
export function ConferenceSummaryPage() {
  const [params, setParams] = useSearchParams();
  const accountId = Number(params.get('account')) || null;
  const requested = params.get('view');
  const view: View = accountId ? 'account' : requested === 'account' || requested === 'day' ? requested : 'all';
  const headerSlot = useHeaderSlot();

  const status = useQuery({ queryKey: ['conference-summary', 'status'], queryFn: conferenceSummaryApi.status });
  const overview = useQuery({
    queryKey: ['conference-summary', 'overview'],
    queryFn: conferenceSummaryApi.overview,
    staleTime: 5 * 60_000,
    enabled: view !== 'day',
  });

  const date = params.get('date') ?? status.data?.last_date ?? '';
  const search = params.get('q') ?? '';
  // A clicked day opens that day's Campaigns in Conference › Campaign Metrics,
  // as Voicedrop's do (the Day tab is still a click away above).
  const navigate = useNavigate();
  const openDay = (iso: string, account?: number) =>
    navigate(`/analytics/conference/campaign-metrics?view=campaigns&date=${iso}${account ? `&search=${account}` : ''}`);
  const openAccount = (id: number) => setParams({ account: String(id) });

  const header =
    headerSlot &&
    createPortal(
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <Toggle
          label="View"
          value={view}
          onChange={(next) => setParams(next === 'all' ? {} : { view: next, ...(next === 'day' && date ? { date } : {}) })}
          options={VIEWS}
        />
        {view === 'account' && overview.data && (
          <AccountSelect
            value={accountId}
            onChange={(id) => (id ? openAccount(id) : setParams({ view: 'account' }))}
            options={overview.data.accounts.map((a) => ({
              id: a.account_id,
              label: `${a.account_id}${a.name ? ` — ${a.name}` : ''} · ${compact(a.attended_minutes)} min${a.days_idle >= 15 ? ` · quiet ${a.days_idle}d` : ''}`,
            }))}
          />
        )}
        {view === 'day' && status.data?.last_date && (
          <>
            <HeaderSearch
              value={search}
              onChange={(q) => setParams({ view: 'day', date, ...(q ? { q } : {}) }, { replace: true })}
              placeholder="Search by account, CRN, Conf Num, PIN, DID or name…"
            />
            <div className="shrink-0">
              <SingleDateSelector
                date={date}
                onChange={(next) => setParams({ view: 'day', date: next, ...(search ? { q: search } : {}) })}
                min={status.data.first_date}
                max={status.data.last_date}
              />
            </div>
          </>
        )}
        {view !== 'day' && status.data?.last_date && (
          <span className="ml-auto hidden shrink-0 text-xs text-zinc-500 sm:inline dark:text-zinc-400">
            Data to {dayLabel(status.data.last_date)}
          </span>
        )}
      </div>,
      headerSlot,
    );

  const gate = view === 'day' ? status : overview;
  return (
    <HoverTooltipProvider>
      {header}
      <div className="vd-design mx-auto max-w-[1500px] p-8">
        {gate.isPending || status.isPending ? (
          <Centered>
            <Loader2 className="h-8 w-8 animate-spin text-[#50a6d5]" />
          </Centered>
        ) : status.error ? (
          <Problem title={PROBLEM} message={status.error.message} onRetry={() => status.refetch()} />
        ) : !status.data.last_date ? (
          <Centered>conference_summary has no rows yet.</Centered>
        ) : view === 'day' ? (
          <DayView
            status={status.data}
            date={date}
            onDate={(next) => setParams({ view: 'day', date: next, ...(search ? { q: search } : {}) })}
            search={search}
          />
        ) : overview.error ? (
          <Problem title={PROBLEM} message={overview.error.message} onRetry={() => overview.refetch()} />
        ) : !overview.data ? null : view === 'all' ? (
          <AllAccountsView data={overview.data} onDay={(iso) => openDay(iso)} onAccount={openAccount} />
        ) : accountId ? (
          <AccountView key={accountId} accountId={accountId} onDay={(iso) => openDay(iso, accountId)} />
        ) : (
          <AccountDirectory
            rows={overview.data.accounts.map((a) => ({
              account_id: a.account_id,
              name: a.name,
              total: a.attended_minutes,
              detail: `${fmt(a.conferences)} conferences`,
              last_date: a.last_date,
              days_idle: a.days_idle,
            }))}
            totalLabel="Attended minutes"
            query={params.get('q') ?? ''}
            onQuery={(q) => setParams(q ? { view: 'account', q } : { view: 'account' })}
            onAccount={openAccount}
          />
        )}
      </div>
    </HoverTooltipProvider>
  );
}
