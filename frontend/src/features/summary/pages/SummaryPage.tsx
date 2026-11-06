import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Clock, FileSpreadsheet, ReceiptText, UserRoundSearch } from 'lucide-react';

import { useHeaderSlot } from '../../../components/HeaderSlot';
import { LoadingBlock } from '../../../components/Loading';
import { useCampaignDateStore } from '../../../store';
import { HoverTooltipProvider } from '../../cdr-dashboard/components/attempt-analytics/HoverTooltip';
import { Card } from '../../cdr-dashboard/components/attempt-analytics/AttemptCharts';
import { fmt } from '../../cdr-dashboard/components/attempt-analytics/design';
import { summaryApi } from '../api';
import type { Overview } from '../api';
import { dayLabel, monthLabel, spanLabel } from '../format';
import { VOICEDROP_COLUMNS, downloadStatement } from '../statement';
import type { VoicedropStatementLine } from '../statement';
import { ActivityCalendar } from '../components/ActivityCalendar';
import { WeekHourHeatmap } from '../components/WeekHourHeatmap';
import { BusiestDays, Movers, SleepingAccounts } from '../components/AccountLists';
import { DailyVolume } from '../components/DailyVolume';
import { DailyStatement } from '../components/DailyStatement';
import { SectionTabs } from '../components/SectionTabs';
import { StatementTable } from '../components/StatementTable';
import { Toggle } from '../components/ui';
import { Centered, DownloadButton, Problem } from '../components/PageParts';
import {
  CALENDAR_METRICS,
  HOUR_LABELS,
  HOUR_METRICS,
  VOICEDROP_DAILY_COLUMNS,
  voicedropDayTip,
  withRate,
} from '../voicedrop';
import type { CalendarMetric, HourMetric } from '../voicedrop';

type SummaryTab = 'daily' | 'hours' | 'monthly' | 'statement' | 'watch';

const SUMMARY_TABS: { id: SummaryTab; label: string; icon: typeof Clock }[] = [
  { id: 'daily', label: 'Daily Activity', icon: CalendarDays },
  { id: 'hours', label: 'Busiest Hours', icon: Clock },
  { id: 'monthly', label: 'Monthly Statement', icon: ReceiptText },
  { id: 'statement', label: 'Daily Statement', icon: FileSpreadsheet },
  { id: 'watch', label: 'Accounts to Watch', icon: UserRoundSearch },
];

const summaryTab = (value: string | null): SummaryTab =>
  SUMMARY_TABS.some((t) => t.id === value) ? (value as SummaryTab) : 'daily';

const NONE = { isLoading: false, error: null };

/**
 * Voicedrop › Summary: every account together, from voicedrop_summary, in
 * five sections under one strip (?tab=). One account's history is the
 * Accounts page; links to either open there. Clicking a day opens its
 * campaigns in Voicedrop › Campaign Metrics.
 */
export function SummaryPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const headerSlot = useHeaderSlot();
  const tab = summaryTab(params.get('tab'));
  const setCampaignDate = useCampaignDateStore((s) => s.setDate);

  const overview = useQuery({ queryKey: ['summary', 'overview'], queryFn: summaryApi.overview, staleTime: 5 * 60_000 });

  // One account's history moved to the Accounts page; old links follow it.
  if (params.get('account') || params.get('scope') === 'account') {
    const next = new URLSearchParams(location.search);
    next.delete('scope');
    const rest = next.toString();
    return <Navigate to={`/analytics/voicedrop/accounts${rest ? `?${rest}` : ''}`} replace />;
  }

  const openDay = (iso: string) => {
    setCampaignDate(iso);
    navigate(`/analytics/voicedrop/campaign-metrics?view=campaigns&date=${iso}`);
  };
  const openAccount = (id: number, tab?: 'monthly') => navigate(`/analytics/voicedrop/accounts?account=${id}${tab ? `&tab=${tab}` : ''}`);

  const header =
    headerSlot &&
    createPortal(
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
        <h1 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">Voicedrop Summary</h1>
        {overview.data?.as_of && (
          <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">Data to {dayLabel(overview.data.as_of)}</span>
        )}
      </div>,
      headerSlot,
    );

  return (
    <HoverTooltipProvider>
      {header}
      <div className="vd-design mx-auto max-w-[1500px] p-8">
        <SectionTabs tabs={SUMMARY_TABS} active={tab} onTab={(next) => setParams(next === 'daily' ? {} : { tab: next }, { replace: true })} />
        {overview.isPending ? (
          <LoadingBlock />
        ) : overview.error ? (
          <Problem title="Couldn't read voicedrop_summary." message={overview.error.message} onRetry={() => overview.refetch()} />
        ) : !overview.data.as_of ? (
          <Centered>voicedrop_summary has no rows yet.</Centered>
        ) : (
          <Sections data={overview.data} tab={tab} onDay={openDay} onAccount={openAccount} />
        )}
      </div>
    </HoverTooltipProvider>
  );
}

function Sections({
  data,
  tab,
  onDay,
  onAccount,
}: {
  data: Overview;
  tab: SummaryTab;
  onDay: (iso: string) => void;
  onAccount: (id: number, tab?: 'monthly') => void;
}) {
  const [calendarMetric, setCalendarMetric] = useState<CalendarMetric>('dialed');
  const [hourMetric, setHourMetric] = useState<HourMetric>('dialed');
  const [idleDays, setIdleDays] = useState<'15' | '30'>('15');
  const { movers } = data;
  const names = new Map(data.accounts.map((a) => [a.account_id, a.name]));
  const sameDays = spanLabel(movers.previous_from, movers.previous_to);

  if (tab === 'daily') {
    return (
      <div className="grid grid-cols-12 gap-4">
        <Card {...NONE} span={12} title="Daily volume" subtitle="Dial out and connected, all accounts — every day, the latest in view">
          <DailyVolume
            days={data.daily.map((d) => ({ date: d.date, total: d.dialout, connected: d.connected }))}
            asOf={data.as_of!}
            totalLabel="dialed"
            onDay={onDay}
          />
        </Card>
        <Card
          {...NONE}
          span={12}
          title="Activity calendar"
          subtitle="Every day of the last 12 months, all accounts together — click a day to open its campaigns"
          extra={<Toggle label="Colour by" options={CALENDAR_METRICS} value={calendarMetric} onChange={setCalendarMetric} />}
        >
          <div className="flex flex-col gap-6 lg:flex-row">
            <div className="min-w-0 flex-1">
              <ActivityCalendar
                days={data.daily}
                asOf={data.as_of!}
                firstDate={data.first_date!}
                valueOf={(d) => d[calendarMetric]}
                renderTip={voicedropDayTip(calendarMetric)}
                emptyLabel="No campaigns."
                onDay={onDay}
              />
            </div>
            <div className="lg:w-64 lg:shrink-0 lg:border-l lg:border-[#eef2f7] lg:pl-6 dark:lg:border-white/[0.06]">
              <BusiestDays
                days={data.daily}
                valueOf={(d) => d.dialed}
                describe={(d) => `${fmt(d.dialed)} dialed · ${d.campaigns} campaigns · ${d.accounts} accounts`}
                onDay={onDay}
              />
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (tab === 'hours') {
    return (
      <div className="grid grid-cols-12 gap-4">
        <Card
          {...NONE}
          span={12}
          title="Busiest hours"
          subtitle="Campaigns by weekday and start hour, all accounts since the table began — the share of the week is on the right"
          extra={<Toggle label="Colour by" options={HOUR_METRICS} value={hourMetric} onChange={setHourMetric} />}
        >
          <WeekHourHeatmap cells={data.weekday_hour} metric={hourMetric} metrics={HOUR_LABELS} />
        </Card>
      </div>
    );
  }

  if (tab === 'monthly') return <MonthlyStatement months={data.months} asOf={data.as_of!} onAccount={onAccount} />;

  if (tab === 'statement') {
    return (
      <DailyStatement
        days={data.daily.map(withRate)}
        months={data.months}
        asOf={data.as_of!}
        columns={VOICEDROP_DAILY_COLUMNS}
        service="voicedrop"
        onDay={onDay}
      />
    );
  }

  return (
    <div className="grid grid-cols-12 gap-4">
      <Card
        {...NONE}
        span={6}
        title="Sleeping accounts"
        subtitle={`Ran campaigns before, none in the last ${idleDays} days — biggest senders first`}
        extra={
          <Toggle
            label="Quiet for"
            value={idleDays}
            onChange={setIdleDays}
            options={[
              { id: '15', label: '15 days' },
              { id: '30', label: '30 days' },
            ]}
          />
        }
      >
        <SleepingAccounts
          accounts={data.accounts.map((a) => ({ ...a, recent: a.dialed_last_90_active }))}
          idleDays={Number(idleDays)}
          unit="dialed"
          onAccount={onAccount}
        />
      </Card>
      <Card
        {...NONE}
        span={6}
        title="Rising and falling"
        subtitle={`Numbers dialed, ${spanLabel(movers.current_from, movers.current_to)} against ${sameDays}`}
      >
        <Movers
          movers={movers.accounts.map((m) => ({ ...m, name: names.get(m.account_id), current: m.current_dialed, previous: m.previous_dialed }))}
          unit="dialed"
          onAccount={onAccount}
        />
      </Card>
    </div>
  );
}

/** Per account, per month, for billing — one month at a time, or every month. A row opens that account's statement. */
function MonthlyStatement({ months, asOf, onAccount }: { months: string[]; asOf: string; onAccount: (id: number, tab?: 'monthly') => void }) {
  // The last complete month by default: what billing asks for.
  const current = asOf.slice(0, 7);
  const [month, setMonth] = useState<string>(() => [...months].reverse().find((m) => m < current) ?? current);
  const query = useQuery({
    queryKey: ['summary', 'statement', month],
    queryFn: () => summaryApi.statement(month === 'all' ? null : month),
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
  });
  const lines: VoicedropStatementLine[] = query.data?.rows ?? [];
  if (query.isPending) return <LoadingBlock height={360} />;
  return (
    <div className="relative grid grid-cols-12 gap-4">
      <Card
        span={12}
        isLoading={false}
        error={query.error}
        isEmpty={!lines.length}
        title="Monthly statement"
        subtitle="Per account: campaigns, dialed, connected and connected minutes — ready for billing or the client"
        extra={
          <div className="flex items-center gap-2">
            <select
              aria-label="Month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="field-focus h-8 rounded-lg border border-zinc-200 bg-white px-2 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            >
              {[...months].reverse().map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                  {m === current ? ` (to ${dayLabel(asOf)})` : ''}
                </option>
              ))}
              <option value="all">All months</option>
            </select>
            <DownloadButton onClick={() => downloadStatement(`voicedrop-statement-${month}.csv`, lines, VOICEDROP_COLUMNS)} />
          </div>
        }
      >
        <div className={query.isFetching ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
          <StatementTable
            lines={lines}
            columns={VOICEDROP_COLUMNS}
            showMonth={month === 'all'}
            showAccount
            onRow={(line) => onAccount(line.account_id, 'monthly')}
            rowTitle={(line) => `Open account ${line.account_id}'s monthly statement`}
          />
        </div>
      </Card>
    </div>
  );
}
