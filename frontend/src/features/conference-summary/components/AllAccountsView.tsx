import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, Timer, TrendingUp, Users, Video } from 'lucide-react';

import { Card } from '../../cdr-dashboard/components/attempt-analytics/AttemptCharts';
import { Kpi } from '../../cdr-dashboard/components/attempt-analytics/AttemptKpis';
import { TipBody } from '../../cdr-dashboard/components/attempt-analytics/HoverTooltip';
import { TONES, compact, fmt, pct } from '../../cdr-dashboard/components/attempt-analytics/design';
import { ActivityCalendar } from '../../summary/components/ActivityCalendar';
import { DailyVolume } from '../../summary/components/DailyVolume';
import { BusiestDays, Movers, SleepingAccounts } from '../../summary/components/AccountLists';
import { DownloadButton, SectionTitle } from '../../summary/components/PageParts';
import { StatementTable } from '../../summary/components/StatementTable';
import { WeekHourHeatmap } from '../../summary/components/WeekHourHeatmap';
import { Change, Toggle } from '../../summary/components/ui';
import { dayLabel, monthLabel, spanLabel } from '../../summary/format';
import { downloadStatement } from '../../summary/statement';
import { conferenceSummaryApi } from '../api';
import type { ConferenceOverview } from '../api';
import { CONFERENCE_COLUMNS } from '../statement';
import { CALENDAR_METRICS, HOUR_LABELS, HOUR_METRICS, conferenceDayTip } from './shared';
import type { CalendarMetric, HourMetric } from './shared';

const NONE = { isLoading: false, error: null };

/** Every account together: this month, the calendar, who to watch, the load, billing. */
export function AllAccountsView({
  data,
  onDay,
  onAccount,
}: {
  data: ConferenceOverview;
  onDay: (iso: string) => void;
  onAccount: (id: number) => void;
}) {
  const [calendarMetric, setCalendarMetric] = useState<CalendarMetric>('conferences');
  const [hourMetric, setHourMetric] = useState<HourMetric>('conferences');
  const [idleDays, setIdleDays] = useState<'15' | '30'>('15');
  const { this_month: now, last_month_same_days: before } = data.kpis;
  const { movers } = data;
  const names = new Map(data.accounts.map((a) => [a.account_id, a.name]));
  const thisMonth = data.as_of!.slice(0, 7);
  const newThisMonth = data.new_accounts.find((n) => n.month === thisMonth && !n.is_table_start)?.accounts ?? [];
  const sameDays = spanLabel(movers.previous_from, movers.previous_to);
  const thisSpan = spanLabel(movers.current_from, movers.current_to);

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
              last 30 days · <Change now={data.kpis.active_accounts_30d} before={data.kpis.active_accounts_prev_30d} /> vs{' '}
              {data.kpis.active_accounts_prev_30d}
            </>
          }
          tip={() => (
            <TipBody
              eyebrow="Accounts with a conference"
              title="Last 30 days"
              value={data.kpis.active_accounts_30d}
              share={`${data.kpis.active_accounts_prev_30d} in the 30 days before · ${data.accounts.length} in the table`}
            />
          )}
        />
        <Kpi
          {...NONE}
          tone={TONES.sky}
          icon={Video}
          label="Conferences"
          value={fmt(now.conferences)}
          note={
            <>
              <Change now={now.conferences} before={before.conferences} /> vs {sameDays}
            </>
          }
          tip={() => (
            <TipBody
              eyebrow={`${thisSpan} vs ${sameDays}`}
              title="Conferences held"
              value={now.conferences}
              share={`${fmt(before.conferences)} the same days last month`}
              sections={[
                {
                  title: 'This month',
                  base: now.conferences,
                  rows: [
                    { label: 'Nobody joined', value: now.empty_rooms },
                    { label: 'Parties connected', value: now.connected, share: '' },
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
              title="Parties who joined"
              value={now.connected}
              share={`${pct(now.connected, now.ringed)} of ${fmt(now.ringed)} ringed`}
            />
          )}
        />
        <Kpi
          {...NONE}
          tone={TONES.violet}
          icon={Timer}
          label="Attended minutes"
          value={compact(now.attended_minutes)}
          note={
            <>
              <Change now={now.attended_minutes} before={before.attended_minutes} /> vs {sameDays}
            </>
          }
          tip={() => (
            <TipBody
              eyebrow={thisSpan}
              title="Minutes joined to release"
              value={now.attended_minutes}
              share={`${fmt(before.attended_minutes)} over ${sameDays} · ${fmt(now.call_minutes)} call minutes`}
            />
          )}
        />
        <Kpi
          {...NONE}
          tone={TONES.orange}
          icon={Sparkles}
          label="New accounts"
          value={fmt(newThisMonth.length)}
          note={newThisMonth.length ? <>first conference in {monthLabel(thisMonth, true)}</> : <>none yet this month</>}
          tip={() => (
            <>
              <div className="text-[9px] uppercase tracking-[1px] text-[#8398b9]">First conference, by month</div>
              <div className="mt-1.5 space-y-[3px]">
                {data.new_accounts.map((n) => (
                  <div key={n.month} className="flex justify-between gap-4 text-[11px] text-[#c5cee0]">
                    <span>
                      {monthLabel(n.month)}
                      {n.is_table_start && <span className="ml-1 text-[#8095b2]">(table start)</span>}
                    </span>
                    <span className="tabular-nums text-[#e7eefa]">{n.is_table_start ? '—' : n.accounts.length}</span>
                  </div>
                ))}
              </div>
              {newThisMonth.length > 0 && (
                <div className="mt-2 border-t border-white/[0.07] pt-2 text-[11px] text-[#c5cee0]">
                  This month: {newThisMonth.map((id) => names.get(id) ?? id).join(', ')}
                </div>
              )}
            </>
          )}
        />
      </div>

      <div className="mb-6 grid grid-cols-12 gap-4">
        <Card {...NONE} span={12} title="Daily volume" subtitle="Parties ringed and connected, all accounts — every day, the latest in view">
          <DailyVolume
            days={data.daily.map((d) => ({ date: d.date, total: d.ringed, connected: d.connected }))}
            asOf={data.as_of!}
            totalLabel="ringed"
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
          subtitle="Every day of the last 12 months, all accounts together — click a day to open its conferences"
          extra={<Toggle label="Colour by" options={CALENDAR_METRICS} value={calendarMetric} onChange={setCalendarMetric} />}
        >
          <div className="flex flex-col gap-6 lg:flex-row">
            <div className="min-w-0 flex-1">
              <ActivityCalendar
                days={data.daily}
                asOf={data.as_of!}
                firstDate={data.first_date!}
                valueOf={(d) => d[calendarMetric]}
                renderTip={conferenceDayTip(calendarMetric)}
                emptyLabel="No conferences."
                onDay={onDay}
              />
            </div>
            <div className="lg:w-64 lg:shrink-0 lg:border-l lg:border-[#eef2f7] lg:pl-6 dark:lg:border-white/[0.06]">
              <BusiestDays
                days={data.daily}
                valueOf={(d) => d.attended_minutes}
                describe={(d) => `${fmt(d.attended_minutes)} attended minutes · ${d.conferences} conferences · ${d.accounts} accounts`}
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
          subtitle={`Held conferences before, none in the last ${idleDays} days — biggest users first`}
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
            accounts={data.accounts.map((a) => ({ ...a, recent: a.attended_last_90_active }))}
            idleDays={Number(idleDays)}
            unit="attended minutes"
            onAccount={onAccount}
          />
        </Card>
        <Card
          {...NONE}
          span={6}
          title="Rising and falling"
          subtitle={`Attended minutes, ${thisSpan} against ${sameDays}`}
        >
          <Movers
            movers={movers.accounts.map((m) => ({ ...m, name: names.get(m.account_id) }))}
            unit="attended minutes"
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
          subtitle="Conferences by weekday and start hour, all accounts since the table began — the share of the week is on the right"
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

/** Per account, per month — one month at a time, or every month. */
function MonthlyStatement({ months, asOf }: { months: string[]; asOf: string }) {
  // The last complete month by default: what billing asks for.
  const current = asOf.slice(0, 7);
  const [month, setMonth] = useState<string>(() => [...months].reverse().find((m) => m < current) ?? current);
  const query = useQuery({
    queryKey: ['conference-summary', 'statement', month],
    queryFn: () => conferenceSummaryApi.statement(month === 'all' ? null : month),
    staleTime: 5 * 60_000,
  });
  const lines = query.data?.rows ?? [];
  return (
    <div className="mb-6 grid grid-cols-12 gap-4">
      <Card
        span={12}
        isLoading={query.isPending}
        error={query.error}
        isEmpty={!lines.length}
        title="Monthly statement"
        subtitle="Per account: conferences, parties and minutes — ready for billing or the client"
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
            <DownloadButton onClick={() => downloadStatement(`conference-statement-${month}.csv`, lines, CONFERENCE_COLUMNS)} />
          </div>
        }
      >
        <StatementTable lines={lines} columns={CONFERENCE_COLUMNS} showMonth={month === 'all'} showAccount />
      </Card>
    </div>
  );
}
