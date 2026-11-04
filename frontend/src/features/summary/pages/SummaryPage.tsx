import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  AlertTriangle,
  CalendarCheck,
  CalendarClock,
  Clock,
  Download,
  Layers,
  Loader2,
  PhoneOutgoing,
  Sparkles,
  Timer,
  TrendingUp,
  Users,
} from 'lucide-react';

import { useHeaderSlot } from '../../../components/HeaderSlot';
import { useCampaignDateStore } from '../../../store';
import { HoverTooltipProvider, TipBody } from '../../cdr-dashboard/components/attempt-analytics/HoverTooltip';
import { Card } from '../../cdr-dashboard/components/attempt-analytics/AttemptCharts';
import { Kpi } from '../../cdr-dashboard/components/attempt-analytics/AttemptKpis';
import { TONES, compact, fmt, pct } from '../../cdr-dashboard/components/attempt-analytics/design';
import { summaryApi } from '../api';
import type { AccountHistory, Overview } from '../api';
import { dayLabel, daysAgo, hourLabel, monthLabel, spanLabel } from '../format';
import { downloadStatement } from '../statement';
import type { StatementLine } from '../statement';
import { ActivityCalendar } from '../components/ActivityCalendar';
import type { CalendarMetric } from '../components/ActivityCalendar';
import { WeekHourHeatmap } from '../components/WeekHourHeatmap';
import type { HourMetric } from '../components/WeekHourHeatmap';
import { MonthlyTrend } from '../components/MonthlyTrend';
import type { TrendView } from '../components/MonthlyTrend';
import { BusiestDays, Movers, SleepingAccounts } from '../components/AccountLists';
import { StatementTable } from '../components/StatementTable';
import { Change, Toggle } from '../components/ui';

const CALENDAR_METRICS: { id: CalendarMetric; label: string }[] = [
  { id: 'dialed', label: 'Dialed' },
  { id: 'minutes', label: 'Minutes' },
];
const HOUR_METRICS: { id: HourMetric; label: string }[] = [
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'dialed', label: 'Dialed' },
];

/**
 * Overview › Summary: Voicedrop usage over time, from voicedrop_summary.
 *
 * Two scopes, one URL: /analytics/summary is every account together;
 * ?account=109889 is one account's history. Clicking a day anywhere opens
 * that day's Campaigns tab in Voicedrop › Campaign Metrics.
 */
export function SummaryPage() {
  const [params, setParams] = useSearchParams();
  const accountId = Number(params.get('account')) || null;
  const scope: 'all' | 'account' = accountId || params.get('scope') === 'account' ? 'account' : 'all';
  const headerSlot = useHeaderSlot();

  const overview = useQuery({
    queryKey: ['summary', 'overview'],
    queryFn: summaryApi.overview,
    staleTime: 5 * 60_000,
  });

  const setCampaignDate = useCampaignDateStore((s) => s.setDate);
  const navigate = useNavigate();
  const openDay = (iso: string, account?: number) => {
    setCampaignDate(iso);
    navigate(`/analytics/voicedrop/campaign-metrics?view=campaigns${account ? `&search=${account}` : ''}`);
  };
  const openAccount = (id: number) => setParams({ account: String(id) });

  const header =
    headerSlot &&
    createPortal(
      <div className="flex min-w-0 items-center gap-4">
        <Toggle
          label="Scope"
          value={scope}
          onChange={(next) => setParams(next === 'all' ? {} : { scope: 'account' })}
          options={[
            { id: 'all', label: 'All accounts' },
            { id: 'account', label: 'Account' },
          ]}
        />
        {scope === 'account' && overview.data && (
          <select
            aria-label="Account"
            value={accountId ?? ''}
            onChange={(e) => (e.target.value ? openAccount(Number(e.target.value)) : setParams({ scope: 'account' }))}
            className="field-focus h-9 min-w-0 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          >
            <option value="">Choose an account…</option>
            {overview.data.accounts.map((a) => (
              <option key={a.account_id} value={a.account_id}>
                {a.account_id} — {compact(a.dialed)} dialed{a.days_idle >= 15 ? ` · quiet ${a.days_idle}d` : ''}
              </option>
            ))}
          </select>
        )}
        {overview.data?.as_of && (
          <span className="hidden shrink-0 text-xs text-zinc-500 sm:inline dark:text-zinc-400">
            Data to {dayLabel(overview.data.as_of)}
          </span>
        )}
      </div>,
      headerSlot,
    );

  return (
    <HoverTooltipProvider>
      {header}
      <div className="vd-design mx-auto max-w-[1500px] p-8">
        {overview.isPending ? (
          <Centered>
            <Loader2 className="h-8 w-8 animate-spin text-[#50a6d5]" />
          </Centered>
        ) : overview.error ? (
          <Problem message={overview.error.message} onRetry={() => overview.refetch()} />
        ) : !overview.data.as_of ? (
          <Centered>voicedrop_summary has no rows yet.</Centered>
        ) : scope === 'all' ? (
          <AllAccounts data={overview.data} onDay={(iso) => openDay(iso)} onAccount={openAccount} />
        ) : accountId ? (
          <AccountView key={accountId} accountId={accountId} onDay={(iso) => openDay(iso, accountId)} />
        ) : (
          <PickAccount data={overview.data} onAccount={openAccount} />
        )}
      </div>
    </HoverTooltipProvider>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[50vh] items-center justify-center text-sm text-zinc-500">{children}</div>;
}

function Problem({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto flex max-w-3xl items-start gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-900/20 dark:text-red-400">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Couldn't read voicedrop_summary.</p>
        <p className="mt-0.5 break-words">{message}</p>
        <button onClick={onRetry} className="mt-2 text-xs font-semibold underline">
          Retry
        </button>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mx-px mb-[13px] text-[13px] font-medium text-[#576980] dark:text-zinc-300">{children}</h2>;
}

const NONE = { isLoading: false, error: null };

// ── All accounts ────────────────────────────────────────────────────────────

function AllAccounts({
  data,
  onDay,
  onAccount,
}: {
  data: Overview;
  onDay: (iso: string) => void;
  onAccount: (id: number) => void;
}) {
  const [calendarMetric, setCalendarMetric] = useState<CalendarMetric>('dialed');
  const [hourMetric, setHourMetric] = useState<HourMetric>('dialed');
  const [idleDays, setIdleDays] = useState<'15' | '30'>('15');
  const { this_month: now, last_month_same_days: before } = data.kpis;
  const { movers } = data;
  const thisMonth = data.as_of!.slice(0, 7);
  const newThisMonth = data.new_accounts.find((n) => n.month === thisMonth && !n.is_table_start)?.accounts ?? [];
  const sameDays = `${spanLabel(movers.previous_from, movers.previous_to)}`;

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi
          {...NONE}
          tone={TONES.blue}
          icon={Users}
          label="Active accounts"
          value={fmt(data.kpis.active_accounts_30d)}
          note={
            <>
              last 30 days · <Change now={data.kpis.active_accounts_30d} before={data.kpis.active_accounts_prev_30d} />{' '}
              vs {data.kpis.active_accounts_prev_30d}
            </>
          }
          tip={() => (
            <TipBody
              eyebrow="Accounts with a campaign"
              title="Last 30 days"
              value={data.kpis.active_accounts_30d}
              share={`${data.kpis.active_accounts_prev_30d} in the 30 days before · ${data.accounts.length} in the table`}
            />
          )}
        />
        <Kpi
          {...NONE}
          tone={TONES.sky}
          icon={PhoneOutgoing}
          label="Dialed this month"
          value={compact(now.dialed)}
          note={
            <>
              <Change now={now.dialed} before={before.dialed} /> vs {sameDays}
            </>
          }
          tip={() => (
            <TipBody
              eyebrow={`${spanLabel(movers.current_from, movers.current_to)} vs ${sameDays}`}
              title="Numbers dialed"
              value={now.dialed}
              share={`${fmt(before.dialed)} the same days last month`}
              sections={[
                {
                  title: 'This month',
                  base: now.dialed,
                  rows: [
                    { label: 'Campaigns', value: now.campaigns, share: '' },
                    { label: 'Connected', value: now.connected },
                    { label: 'Not connected', value: now.not_connected },
                  ],
                },
              ]}
            />
          )}
        />
        <Kpi
          {...NONE}
          tone={TONES.teal}
          icon={TrendingUp}
          label="Connect rate"
          value={`${now.connect_rate}%`}
          bar={now.connect_rate}
          note={
            <>
              <strong>{before.connect_rate}%</strong> over {sameDays}
            </>
          }
          tip={() => (
            <TipBody
              eyebrow="This month so far"
              title="Connected"
              value={now.connected}
              share={`${pct(now.connected, now.dialed)} of ${fmt(now.dialed)} dialed`}
            />
          )}
        />
        <Kpi
          {...NONE}
          tone={TONES.violet}
          icon={Timer}
          label="Connected minutes"
          value={compact(now.minutes)}
          note={
            <>
              <Change now={now.minutes} before={before.minutes} /> vs {sameDays}
            </>
          }
          tip={() => (
            <TipBody
              eyebrow={spanLabel(movers.current_from, movers.current_to)}
              title="Connected minutes"
              value={now.minutes}
              share={`${fmt(before.minutes)} over ${sameDays}`}
            />
          )}
        />
        <Kpi
          {...NONE}
          tone={TONES.orange}
          icon={Sparkles}
          label="New accounts"
          value={fmt(newThisMonth.length)}
          note={newThisMonth.length ? <>first campaign in {monthLabel(thisMonth, true)}</> : <>none yet this month</>}
          tip={() => (
            <>
              <div className="text-[9px] uppercase tracking-[1px] text-[#8398b9]">First campaign, by month</div>
              <div className="mt-1.5 space-y-[3px]">
                {data.new_accounts.map((n) => (
                  <div key={n.month} className="flex justify-between gap-4 text-[11px] text-[#c5cee0]">
                    <span>
                      {monthLabel(n.month)}
                      {n.is_table_start && <span className="ml-1 text-[#8095b2]">(table start)</span>}
                    </span>
                    <span className="tabular-nums text-[#e7eefa]" title={n.accounts.join(', ')}>
                      {n.is_table_start ? '—' : n.accounts.length}
                    </span>
                  </div>
                ))}
              </div>
              {newThisMonth.length > 0 && (
                <div className="mt-2 border-t border-white/[0.07] pt-2 text-[11px] text-[#c5cee0]">
                  This month: {newThisMonth.join(', ')}
                </div>
              )}
            </>
          )}
        />
      </div>

      <SectionTitle>Activity</SectionTitle>
      <div className="mb-6 grid grid-cols-12 gap-4">
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
                metric={calendarMetric}
                onDay={onDay}
              />
            </div>
            <div className="lg:w-64 lg:shrink-0 lg:border-l lg:border-[#eef2f7] lg:pl-6 dark:lg:border-white/[0.06]">
              <BusiestDays days={data.daily} onDay={onDay} />
            </div>
          </div>
        </Card>
      </div>

      <SectionTitle>Accounts to watch</SectionTitle>
      <div className="mb-6 grid grid-cols-12 gap-4">
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
          <SleepingAccounts accounts={data.accounts} idleDays={Number(idleDays)} onAccount={onAccount} />
        </Card>
        <Card
          {...NONE}
          span={6}
          title="Rising and falling"
          subtitle={`Numbers dialed, ${spanLabel(movers.current_from, movers.current_to)} against ${sameDays}`}
        >
          <Movers movers={movers.accounts} onAccount={onAccount} />
        </Card>
      </div>

      <SectionTitle>Load</SectionTitle>
      <div className="mb-6 grid grid-cols-12 gap-4">
        <Card
          {...NONE}
          span={12}
          title="Busiest hours"
          subtitle="Campaigns by weekday and start hour, all accounts since the table began — the share of the week is on the right"
          extra={<Toggle label="Colour by" options={HOUR_METRICS} value={hourMetric} onChange={setHourMetric} />}
        >
          <WeekHourHeatmap cells={data.weekday_hour} metric={hourMetric} />
        </Card>
      </div>

      <SectionTitle>Billing</SectionTitle>
      <MonthlyStatement months={data.months} asOf={data.as_of!} />
    </>
  );
}

/** Per account, per month, for billing — one month at a time, or every month. */
function MonthlyStatement({ months, asOf }: { months: string[]; asOf: string }) {
  // The last complete month by default: what billing asks for.
  const current = asOf.slice(0, 7);
  const [month, setMonth] = useState<string>(() => [...months].reverse().find((m) => m < current) ?? current);
  const query = useQuery({
    queryKey: ['summary', 'statement', month],
    queryFn: () => summaryApi.statement(month === 'all' ? null : month),
    staleTime: 5 * 60_000,
  });
  const lines: StatementLine[] = query.data?.rows ?? [];
  return (
    <div className="mb-6 grid grid-cols-12 gap-4">
      <Card
        span={12}
        isLoading={query.isPending}
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
            <DownloadButton onClick={() => downloadStatement(`voicedrop-statement-${month}.csv`, lines)} />
          </div>
        }
      >
        <StatementTable lines={lines} showMonth={month === 'all'} showAccount />
      </Card>
    </div>
  );
}

function DownloadButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      <Download className="h-3.5 w-3.5" />
      CSV
    </button>
  );
}

// ── One account ─────────────────────────────────────────────────────────────

function PickAccount({ data, onAccount }: { data: Overview; onAccount: (id: number) => void }) {
  return (
    <div className="mx-auto max-w-2xl">
      <p className="mb-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
        Choose an account above, or one of the biggest senders:
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {data.accounts.slice(0, 12).map((a) => (
          <button
            key={a.account_id}
            type="button"
            onClick={() => onAccount(a.account_id)}
            className="flex items-center justify-between rounded-xl border border-[#e9eef5] bg-white px-4 py-3 text-left text-sm shadow-[0_6px_20px_#1c305408] transition-colors hover:border-[#bcd6ef] dark:border-[#1c2a42] dark:bg-[#0e192c]"
          >
            <span className="font-medium tabular-nums text-[#35415a] dark:text-zinc-100">{a.account_id}</span>
            <span className="text-xs tabular-nums text-[#7a899f]">
              {compact(a.dialed)} dialed · last {dayLabel(a.last_date)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function AccountView({ accountId, onDay }: { accountId: number; onDay: (iso: string) => void }) {
  const query = useQuery({
    queryKey: ['summary', 'account', accountId],
    queryFn: () => summaryApi.account(accountId),
    staleTime: 5 * 60_000,
  });
  if (query.isPending) {
    return (
      <Centered>
        <Loader2 className="h-8 w-8 animate-spin text-[#50a6d5]" />
      </Centered>
    );
  }
  if (query.error) return <Problem message={query.error.message} onRetry={() => query.refetch()} />;
  return <AccountHistoryView data={query.data} onDay={onDay} />;
}

function AccountHistoryView({ data, onDay }: { data: AccountHistory; onDay: (iso: string) => void }) {
  const [calendarMetric, setCalendarMetric] = useState<CalendarMetric>('dialed');
  const [trend, setTrend] = useState<TrendView>('usage');
  const [hourMetric, setHourMetric] = useState<HourMetric>('campaigns');
  const h = data.habits;
  const period = h.scope === '90d' ? 'last 90 days' : 'whole history';
  const lines = useMemo<StatementLine[]>(
    () =>
      [...data.monthly].reverse().map((m) => ({ ...m, account_id: data.account_id, client_ids: data.client_ids })),
    [data],
  );
  const activeDays = data.daily.length;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-xl font-semibold tabular-nums text-[#16213a] dark:text-white">Account {data.account_id}</h1>
        <span className="text-sm text-[#6a7d96] dark:text-zinc-400">
          {data.client_ids.length > 0 && <>Client {data.client_ids.join(', ')} · </>}
          first campaign {dayLabel(data.first_date)} · {fmt(activeDays)} active days
        </span>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi
          {...NONE}
          tone={TONES.blue}
          icon={CalendarCheck}
          label="Active days"
          value={fmt(h.active_days_this_month)}
          note={
            <>
              this month · <strong>{h.active_days_last_month}</strong> last month
            </>
          }
          tip={() => (
            <TipBody
              eyebrow={monthLabel(data.as_of.slice(0, 7))}
              title="Days with a campaign"
              value={h.active_days_this_month}
              share={`${h.active_days_last_month} last month · ${activeDays} since ${dayLabel(data.first_date)}`}
            />
          )}
        />
        <Kpi
          {...NONE}
          tone={TONES.sky}
          icon={Layers}
          label="Campaigns a day"
          value={String(h.campaigns_per_active_day)}
          note={<>per active day, {period}</>}
          tip={() => (
            <TipBody eyebrow={period} title="Campaigns per active day" value={h.campaigns_per_active_day} />
          )}
        />
        <Kpi
          {...NONE}
          tone={TONES.teal}
          icon={Users}
          label="Campaign size"
          value={compact(h.avg_campaign_size)}
          note={
            <>
              numbers each · <strong>{compact(h.avg_dialed_per_campaign)}</strong> dialed
            </>
          }
          tip={() => (
            <TipBody
              eyebrow={period}
              title="Phone numbers per campaign"
              value={h.avg_campaign_size}
              share={`${fmt(h.avg_dialed_per_campaign)} dialed per campaign on average`}
            />
          )}
        />
        <Kpi
          {...NONE}
          tone={TONES.violet}
          icon={Clock}
          label="Usual start"
          value={h.usual_start ?? '—'}
          note={h.busiest_hour != null ? <>busiest hour {hourLabel(h.busiest_hour)}–{hourLabel((h.busiest_hour + 1) % 24)}</> : <>no start times</>}
          tip={() => (
            <>
              <div className="text-[9px] uppercase tracking-[1px] text-[#8398b9]">{period}</div>
              <div className="mt-1 text-[12px] text-[#c5cee0]">
                Half its campaigns start before {h.usual_start ?? '—'}, half after.
              </div>
            </>
          )}
        />
        <Kpi
          {...NONE}
          tone={h.days_since_active >= 15 ? TONES.orange : TONES.teal}
          icon={CalendarClock}
          label="Last active"
          value={dayLabel(h.last_active).replace(/ \d{4}$/, '')}
          note={<span className={clsx(h.days_since_active >= 15 && 'text-[#e07d2c]')}>{daysAgo(h.days_since_active)}</span>}
          tip={() => (
            <TipBody
              eyebrow="Last campaign"
              title={dayLabel(h.last_active)}
              value={h.days_since_active}
              share={`days before ${dayLabel(data.as_of)}, the latest data`}
            />
          )}
        />
      </div>

      <SectionTitle>History</SectionTitle>
      <div className="mb-6 grid grid-cols-12 gap-4">
        <Card
          {...NONE}
          span={12}
          title="Activity calendar"
          subtitle="Every day of the last 12 months — click a day to open this account's campaigns that day"
          extra={<Toggle label="Colour by" options={CALENDAR_METRICS} value={calendarMetric} onChange={setCalendarMetric} />}
        >
          <ActivityCalendar days={data.daily} asOf={data.as_of} firstDate={data.first_date} metric={calendarMetric} onDay={onDay} />
        </Card>
        <Card
          {...NONE}
          span={7}
          title="Monthly trend"
          subtitle={trend === 'usage' ? 'Connected minutes per month, with the connect rate' : 'Connect rate and DND % per month — stale lists show here first'}
          isEmpty={!data.monthly.length}
          extra={
            <Toggle
              label="Show"
              value={trend}
              onChange={setTrend}
              options={[
                { id: 'usage', label: 'Usage' },
                { id: 'quality', label: 'List quality' },
              ]}
            />
          }
        >
          <MonthlyTrend months={data.monthly} view={trend} />
        </Card>
        <Card
          {...NONE}
          span={5}
          title="When it sends"
          subtitle="Campaigns by weekday and start hour"
          extra={<Toggle label="Colour by" options={HOUR_METRICS} value={hourMetric} onChange={setHourMetric} />}
        >
          <WeekHourHeatmap cells={data.weekday_hour} metric={hourMetric} />
        </Card>
      </div>

      <SectionTitle>Billing</SectionTitle>
      <div className="mb-6 grid grid-cols-12 gap-4">
        <Card
          {...NONE}
          span={12}
          title="Monthly statement"
          subtitle={`Account ${data.account_id}, month by month`}
          extra={<DownloadButton onClick={() => downloadStatement(`voicedrop-statement-${data.account_id}.csv`, lines)} />}
        >
          <StatementTable lines={lines} showMonth showAccount={false} />
        </Card>
      </div>
    </>
  );
}
