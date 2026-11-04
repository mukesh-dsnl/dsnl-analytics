import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  CalendarCheck,
  CalendarClock,
  Clock,
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
import type { AccountHistory, DayTotals, MonthTotals, Overview } from '../api';
import { dayLabel, daysAgo, hourLabel, monthLabel, spanLabel } from '../format';
import { VOICEDROP_COLUMNS, downloadStatement } from '../statement';
import type { VoicedropStatementLine } from '../statement';
import { ActivityCalendar } from '../components/ActivityCalendar';
import { WeekHourHeatmap } from '../components/WeekHourHeatmap';
import { MonthlyTrend, TrendNote } from '../components/MonthlyTrend';
import { BusiestDays, Movers, SleepingAccounts } from '../components/AccountLists';
import { DailyVolume } from '../components/DailyVolume';
import { AccountDirectory } from '../components/AccountDirectory';
import { StatementTable } from '../components/StatementTable';
import { Change, Toggle } from '../components/ui';
import { AccountSelect, Centered, DownloadButton, Problem, SectionTitle } from '../components/PageParts';

type CalendarMetric = 'dialed' | 'minutes';
type HourMetric = 'campaigns' | 'dialed';
type TrendView = 'usage' | 'quality';

const CALENDAR_LABEL: Record<CalendarMetric, string> = { dialed: 'Numbers dialed', minutes: 'Connected minutes' };
const HOUR_LABELS: { id: HourMetric; label: string }[] = [
  { id: 'campaigns', label: 'Campaigns started' },
  { id: 'dialed', label: 'Numbers dialed' },
];

/** A calendar day's readout: the chosen figure, then the day's campaigns. */
function dayTip(metric: CalendarMetric) {
  return function VoicedropDayTip(day: DayTotals, eyebrow: string) {
    return (
      <TipBody
        eyebrow={eyebrow}
        title={CALENDAR_LABEL[metric]}
        value={day[metric]}
        share={`${fmt(day.campaigns)} campaign${day.campaigns === 1 ? '' : 's'}${day.accounts ? ` · ${day.accounts} account${day.accounts === 1 ? '' : 's'}` : ''}`}
        sections={[
          {
            title: 'That day',
            base: day.dialed,
            rows: [
              { label: 'Numbers dialed', value: day.dialed, share: '' },
              { label: 'Connected', value: day.connected, share: pct(day.connected, day.dialed) },
              { label: 'Connected minutes', value: day.minutes, share: '' },
              { label: 'DND', value: day.dnd, share: pct(day.dnd, day.phone_numbers) },
            ],
          },
        ]}
      />
    );
  };
}

const monthTipRows = (m: MonthTotals): [string, string][] => [
  ['Campaigns', fmt(m.campaigns)],
  ['Active days', fmt(m.active_days)],
  ['Numbers dialed', fmt(m.dialed)],
  ['Connected', fmt(m.connected)],
  ['Connect rate', `${m.connect_rate}%`],
  ['Connected minutes', fmt(m.minutes)],
  ['DND', `${fmt(m.dnd)} (${m.dnd_rate}%)`],
];

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
  // One client of the account (?client=): the same history, that client's campaigns alone.
  const clientId = (accountId && Number(params.get('client'))) || null;
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
    navigate(`/analytics/voicedrop/campaign-metrics?view=campaigns&date=${iso}${account ? `&search=${account}` : ''}`);
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
          <AccountSelect
            value={accountId}
            onChange={(id) => (id ? openAccount(id) : setParams({ scope: 'account' }))}
            options={overview.data.accounts.map((a) => ({
              id: a.account_id,
              label: `${a.account_id}${a.name ? ` — ${a.name}` : ''} · ${compact(a.dialed)} dialed${a.days_idle >= 15 ? ` · quiet ${a.days_idle}d` : ''}`,
            }))}
          />
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
          <Problem title="Couldn't read voicedrop_summary." message={overview.error.message} onRetry={() => overview.refetch()} />
        ) : !overview.data.as_of ? (
          <Centered>voicedrop_summary has no rows yet.</Centered>
        ) : scope === 'all' ? (
          <AllAccounts data={overview.data} onDay={(iso) => openDay(iso)} onAccount={openAccount} />
        ) : accountId ? (
          <AccountView
            key={`${accountId}-${clientId}`}
            accountId={accountId}
            clientId={clientId}
            onDay={(iso) => openDay(iso, clientId ?? accountId)}
          />
        ) : (
          <AccountDirectory
            rows={overview.data.accounts.map((a) => ({
              account_id: a.account_id,
              name: a.name,
              total: a.dialed,
              detail: `${fmt(a.campaigns)} campaigns`,
              last_date: a.last_date,
              days_idle: a.days_idle,
            }))}
            totalLabel="Total dialed"
            query={params.get('q') ?? ''}
            onQuery={(q) => setParams(q ? { scope: 'account', q } : { scope: 'account' })}
            onAccount={openAccount}
          />
        )}
      </div>
    </HoverTooltipProvider>
  );
}

const NONE = { isLoading: false, error: null };

const CLIENT_CHIP = 'rounded-full border px-2.5 py-0.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#42b9e9]';
const CLIENT_OFF =
  'border-[#dfe7f1] bg-white text-[#5b6a82] hover:border-[#bcd6ef] hover:text-[#1d4ed8] dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-zinc-300 dark:hover:text-sky-300';
const CLIENT_ON = 'border-[#2563eb] bg-[#2563eb] text-white dark:border-sky-400 dark:bg-sky-500/80';

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
  const names = new Map(data.accounts.map((a) => [a.account_id, a.name]));
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

      <div className="mb-6 grid grid-cols-12 gap-4">
        <Card {...NONE} span={12} title="Daily volume" subtitle="Dial out and connected, all accounts — every day, the latest in view">
          <DailyVolume
            days={data.daily.map((d) => ({ date: d.date, total: d.dialout, connected: d.connected }))}
            asOf={data.as_of!}
            totalLabel="dialed"
            onDay={onDay}
          />
        </Card>
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
                valueOf={(d) => d[calendarMetric]}
                renderTip={dayTip(calendarMetric)}
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
            movers={movers.accounts.map((m) => ({
              ...m,
              name: names.get(m.account_id),
              current: m.current_dialed,
              previous: m.previous_dialed,
            }))}
            unit="dialed"
            onAccount={onAccount}
          />
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
          <WeekHourHeatmap cells={data.weekday_hour} metric={hourMetric} metrics={HOUR_LABELS} />
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
  const lines: VoicedropStatementLine[] = query.data?.rows ?? [];
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
            <DownloadButton onClick={() => downloadStatement(`voicedrop-statement-${month}.csv`, lines, VOICEDROP_COLUMNS)} />
          </div>
        }
      >
        <StatementTable lines={lines} columns={VOICEDROP_COLUMNS} showMonth={month === 'all'} showAccount />
      </Card>
    </div>
  );
}

// ── One account ─────────────────────────────────────────────────────────────

function AccountView({
  accountId,
  clientId,
  onDay,
}: {
  accountId: number;
  clientId: number | null;
  onDay: (iso: string) => void;
}) {
  const query = useQuery({
    queryKey: ['summary', 'account', accountId, clientId],
    queryFn: () => summaryApi.account(accountId, clientId),
    staleTime: 5 * 60_000,
  });
  if (query.isPending) {
    return (
      <Centered>
        <Loader2 className="h-8 w-8 animate-spin text-[#50a6d5]" />
      </Centered>
    );
  }
  if (query.error) return <Problem title="Couldn't read voicedrop_summary." message={query.error.message} onRetry={() => query.refetch()} />;
  return <AccountHistoryView data={query.data} onDay={onDay} />;
}

function AccountHistoryView({ data, onDay }: { data: AccountHistory; onDay: (iso: string) => void }) {
  const [calendarMetric, setCalendarMetric] = useState<CalendarMetric>('dialed');
  const [trend, setTrend] = useState<TrendView>('usage');
  const [hourMetric, setHourMetric] = useState<HourMetric>('campaigns');
  const h = data.habits;
  const period = h.scope === '90d' ? 'last 90 days' : 'whole history';
  const lines = useMemo<VoicedropStatementLine[]>(
    () =>
      [...data.monthly].reverse().map((m) => ({ ...m, account_id: data.account_id, client_ids: data.client_ids })),
    [data],
  );
  const activeDays = data.daily.length;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-xl font-semibold text-[#16213a] dark:text-white">
          <span className="tabular-nums">{data.account_id}</span>
          {data.name && <span className="ml-2 font-medium text-[#35415a] dark:text-zinc-200">{data.name}</span>}
        </h1>
        <span className="text-sm text-[#6a7d96] dark:text-zinc-400">
          {data.client && (
            <>
              client <strong className="font-semibold text-[#35415a] dark:text-zinc-100">{data.client.id}</strong>
              {data.client.name && <> {data.client.name}</>} ·{' '}
            </>
          )}
          first campaign {dayLabel(data.first_date)} · {fmt(activeDays)} active days
        </span>
        {/* Each client opens the same page with that client's campaigns alone. */}
        {data.clients.length > 0 && (
          <nav className="flex w-full flex-wrap gap-1.5" aria-label="Clients">
            {data.clients.length > 1 && (
              <Link
                to={`?account=${data.account_id}`}
                aria-current={!data.client ? 'page' : undefined}
                className={clsx(CLIENT_CHIP, !data.client ? CLIENT_ON : CLIENT_OFF)}
              >
                All clients
              </Link>
            )}
            {data.clients.map((c) => (
              <Link
                key={c.id}
                to={`?account=${data.account_id}&client=${c.id}`}
                aria-current={data.client?.id === c.id ? 'page' : undefined}
                title={`Show client ${c.id} alone`}
                className={clsx(CLIENT_CHIP, data.client?.id === c.id ? CLIENT_ON : CLIENT_OFF)}
              >
                <span className={clsx('tabular-nums', data.client?.id !== c.id && 'text-[#8a99ad]')}>{c.id}</span>
                {c.name && <span className="ml-1">{c.name}</span>}
              </Link>
            ))}
          </nav>
        )}
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

      <div className="mb-6 grid grid-cols-12 gap-4">
        <Card {...NONE} span={12} title="Daily volume" subtitle="Dial out and connected — every day, the latest in view">
          <DailyVolume
            days={data.daily.map((d) => ({ date: d.date, total: d.dialout, connected: d.connected }))}
            asOf={data.as_of}
            totalLabel="dialed"
            onDay={onDay}
          />
        </Card>
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
          <ActivityCalendar
            days={data.daily}
            asOf={data.as_of}
            firstDate={data.first_date}
            valueOf={(d) => d[calendarMetric]}
            renderTip={dayTip(calendarMetric)}
            emptyLabel="No campaigns."
            onDay={onDay}
          />
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
          <MonthlyTrend
            months={data.monthly}
            bar={trend === 'usage' ? { key: 'minutes', label: 'Connected minutes' } : undefined}
            lines={
              trend === 'usage'
                ? [{ key: 'connect_rate', label: 'Connect rate' }]
                : [
                    { key: 'connect_rate', label: 'Connect rate' },
                    { key: 'dnd_rate', label: 'DND %' },
                  ]
            }
            tipRows={monthTipRows}
            note={
              <TrendNote
                months={data.monthly}
                rate={{ key: 'connect_rate', label: 'connect rate' }}
                risk={{ key: 'dnd_rate', label: 'DND' }}
                advice="the number lists may be getting stale. Worth raising with the client."
              />
            }
          />
        </Card>
        <Card
          {...NONE}
          span={5}
          title="When it sends"
          subtitle="Campaigns by weekday and start hour"
          extra={<Toggle label="Colour by" options={HOUR_METRICS} value={hourMetric} onChange={setHourMetric} />}
        >
          <WeekHourHeatmap cells={data.weekday_hour} metric={hourMetric} metrics={HOUR_LABELS} />
        </Card>
      </div>

      <SectionTitle>Billing</SectionTitle>
      <div className="mb-6 grid grid-cols-12 gap-4">
        <Card
          {...NONE}
          span={12}
          title="Monthly statement"
          subtitle={`Account ${data.account_id}, month by month`}
          extra={<DownloadButton onClick={() => downloadStatement(`voicedrop-statement-${data.account_id}.csv`, lines, VOICEDROP_COLUMNS)} />}
        >
          <StatementTable lines={lines} columns={VOICEDROP_COLUMNS} showMonth showAccount={false} />
        </Card>
      </div>
    </>
  );
}
