import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { LoadingBlock } from '../../../components/Loading';
import { Card } from '../../cdr-dashboard/components/attempt-analytics/AttemptCharts';
import { fmt } from '../../cdr-dashboard/components/attempt-analytics/design';
import { ActivityCalendar } from '../../summary/components/ActivityCalendar';
import { DailyStatement } from '../../summary/components/DailyStatement';
import { DailyVolume } from '../../summary/components/DailyVolume';
import { BusiestDays, Movers, SleepingAccounts } from '../../summary/components/AccountLists';
import { DownloadButton } from '../../summary/components/PageParts';
import { StatementTable } from '../../summary/components/StatementTable';
import { WeekHourHeatmap } from '../../summary/components/WeekHourHeatmap';
import { Toggle } from '../../summary/components/ui';
import { dayLabel, monthLabel, spanLabel } from '../../summary/format';
import { downloadStatement } from '../../summary/statement';
import { conferenceSummaryApi } from '../api';
import type { ConferenceOverview } from '../api';
import { CONFERENCE_COLUMNS, CONFERENCE_DAILY_COLUMNS, withConnectRate } from '../statement';
import { CALENDAR_METRICS, HOUR_LABELS, HOUR_METRICS, conferenceDayTip } from './shared';
import type { CalendarMetric, HourMetric } from './shared';

const NONE = { isLoading: false, error: null };

export type ConferenceTab = 'daily' | 'hours' | 'monthly' | 'statement' | 'watch';

/** Every account together, one section at a time — the Summary page's tabs. */
export function ConferenceSections({
  data,
  tab,
  onDay,
  onAccount,
}: {
  data: ConferenceOverview;
  tab: ConferenceTab;
  onDay: (iso: string) => void;
  onAccount: (id: number) => void;
}) {
  const [calendarMetric, setCalendarMetric] = useState<CalendarMetric>('conferences');
  const [hourMetric, setHourMetric] = useState<HourMetric>('conferences');
  const [idleDays, setIdleDays] = useState<'15' | '30'>('15');
  const { movers } = data;
  const names = new Map(data.accounts.map((a) => [a.account_id, a.name]));
  const sameDays = spanLabel(movers.previous_from, movers.previous_to);
  const thisSpan = spanLabel(movers.current_from, movers.current_to);

  if (tab === 'daily') {
    return (
      <div className="grid grid-cols-12 gap-4">
        <Card {...NONE} span={12} title="Daily volume" subtitle="Parties ringed and connected, all accounts — every day, the latest in view">
          <DailyVolume
            days={data.daily.map((d) => ({ date: d.date, total: d.ringed, connected: d.connected }))}
            asOf={data.as_of!}
            totalLabel="ringed"
            onDay={onDay}
          />
        </Card>
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
    );
  }

  if (tab === 'hours') {
    return (
      <div className="grid grid-cols-12 gap-4">
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
    );
  }

  if (tab === 'monthly') return <MonthlyStatement months={data.months} asOf={data.as_of!} />;

  if (tab === 'statement') {
    return (
      <DailyStatement
        days={data.daily.map(withConnectRate)}
        months={data.months}
        asOf={data.as_of!}
        columns={CONFERENCE_DAILY_COLUMNS}
        service="conference"
      />
    );
  }

  return (
    <div className="grid grid-cols-12 gap-4">
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
      <Card {...NONE} span={6} title="Rising and falling" subtitle={`Attended minutes, ${thisSpan} against ${sameDays}`}>
        <Movers movers={movers.accounts.map((m) => ({ ...m, name: names.get(m.account_id) }))} unit="attended minutes" onAccount={onAccount} />
      </Card>
    </div>
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
    placeholderData: (previous) => previous,
  });
  const lines = query.data?.rows ?? [];
  if (query.isPending) return <LoadingBlock height={360} />;
  return (
    <div className="grid grid-cols-12 gap-4">
      <Card
        span={12}
        isLoading={false}
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
        <div className={query.isFetching ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
          <StatementTable lines={lines} columns={CONFERENCE_COLUMNS} showMonth={month === 'all'} showAccount />
        </div>
      </Card>
    </div>
  );
}
