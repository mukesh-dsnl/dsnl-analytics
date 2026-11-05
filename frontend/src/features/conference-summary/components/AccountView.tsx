import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { Card } from '../../cdr-dashboard/components/attempt-analytics/AttemptCharts';
import { fmt } from '../../cdr-dashboard/components/attempt-analytics/design';
import { ActivityCalendar } from '../../summary/components/ActivityCalendar';
import { DailyVolume } from '../../summary/components/DailyVolume';
import { MonthlyTrend, TrendNote } from '../../summary/components/MonthlyTrend';
import { Centered, DownloadButton, Problem, SectionTitle } from '../../summary/components/PageParts';
import { StatementTable } from '../../summary/components/StatementTable';
import { WeekHourHeatmap } from '../../summary/components/WeekHourHeatmap';
import { Toggle } from '../../summary/components/ui';
import { dayLabel } from '../../summary/format';
import { downloadStatement } from '../../summary/statement';
import { conferenceSummaryApi } from '../api';
import type { ConferenceAccountHistory, ConferenceMonth, ConferenceStatementLine } from '../api';
import { CONFERENCE_COLUMNS } from '../statement';
import { CALENDAR_METRICS, HOUR_LABELS, HOUR_METRICS, conferenceDayTip } from './shared';
import type { CalendarMetric, HourMetric } from './shared';

const NONE = { isLoading: false, error: null };

const monthTipRows = (m: ConferenceMonth): [string, string][] => [
  ['Conferences', fmt(m.conferences)],
  ['Active days', fmt(m.active_days)],
  ['Parties ringed', fmt(m.ringed)],
  ['Parties connected', fmt(m.connected)],
  ['Connect rate', `${m.connect_rate}%`],
  ['Rooms nobody joined', `${fmt(m.empty_rooms)} (${m.empty_rate}%)`],
  ['Attended minutes', fmt(m.attended_minutes)],
  ['Call minutes', fmt(m.call_minutes)],
  ['Peak port', fmt(m.peak_port)],
];

export function AccountView({ accountId, onDay }: { accountId: number; onDay: (iso: string) => void }) {
  const query = useQuery({
    queryKey: ['conference-summary', 'account', accountId],
    queryFn: () => conferenceSummaryApi.account(accountId),
    staleTime: 5 * 60_000,
  });
  if (query.isPending) {
    return (
      <Centered>
        <Loader2 className="h-8 w-8 animate-spin text-[#50a6d5]" />
      </Centered>
    );
  }
  if (query.error) {
    return <Problem title="Couldn't read conference_summary." message={query.error.message} onRetry={() => query.refetch()} />;
  }
  return <History data={query.data} onDay={onDay} />;
}

function History({ data, onDay }: { data: ConferenceAccountHistory; onDay: (iso: string) => void }) {
  const [calendarMetric, setCalendarMetric] = useState<CalendarMetric>('conferences');
  const [trend, setTrend] = useState<'usage' | 'quality'>('usage');
  const [hourMetric, setHourMetric] = useState<HourMetric>('conferences');
  const lines = useMemo<ConferenceStatementLine[]>(
    () => [...data.monthly].reverse().map((m) => ({ ...m, account_id: data.account_id, name: data.name })),
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
          first conference {dayLabel(data.first_date)} · {fmt(activeDays)} active days
        </span>
      </div>

      <div className="mb-6 grid grid-cols-12 gap-4">
        <Card {...NONE} span={12} title="Daily volume" subtitle="Parties ringed and connected — every day, the latest in view">
          <DailyVolume
            days={data.daily.map((d) => ({ date: d.date, total: d.ringed, connected: d.connected }))}
            asOf={data.as_of}
            totalLabel="ringed"
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
          subtitle="Every day of the last 12 months — click a day to open this account's conferences that day"
          extra={<Toggle label="Colour by" options={CALENDAR_METRICS} value={calendarMetric} onChange={setCalendarMetric} />}
        >
          <ActivityCalendar
            days={data.daily}
            asOf={data.as_of}
            firstDate={data.first_date}
            valueOf={(d) => d[calendarMetric]}
            renderTip={conferenceDayTip(calendarMetric)}
            emptyLabel="No conferences."
            onDay={onDay}
          />
        </Card>
        <Card
          {...NONE}
          span={7}
          title="Monthly trend"
          subtitle={
            trend === 'usage'
              ? 'Attended minutes per month, with the connect rate'
              : 'Connect rate and rooms nobody joined, per month'
          }
          isEmpty={!data.monthly.length}
          extra={
            <Toggle
              label="Show"
              value={trend}
              onChange={setTrend}
              options={[
                { id: 'usage', label: 'Usage' },
                { id: 'quality', label: 'Attendance' },
              ]}
            />
          }
        >
          <MonthlyTrend
            months={data.monthly}
            bar={trend === 'usage' ? { key: 'attended_minutes', label: 'Attended minutes' } : undefined}
            lines={
              trend === 'usage'
                ? [{ key: 'connect_rate', label: 'Connect rate' }]
                : [
                    { key: 'connect_rate', label: 'Connect rate' },
                    { key: 'empty_rate', label: 'Empty rooms %' },
                  ]
            }
            tipRows={monthTipRows}
            note={
              <TrendNote
                months={data.monthly}
                rate={{ key: 'connect_rate', label: 'connect rate' }}
                risk={{ key: 'empty_rate', label: 'rooms nobody joined', by: 5 }}
                advice="fewer invitees are joining. Worth checking the dial-out lists and timings with the client."
              />
            }
          />
        </Card>
        <Card
          {...NONE}
          span={5}
          title="When it meets"
          subtitle="Conferences by weekday and start hour"
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
          extra={
            <DownloadButton onClick={() => downloadStatement(`conference-statement-${data.account_id}.csv`, lines, CONFERENCE_COLUMNS)} />
          }
        >
          <StatementTable lines={lines} columns={CONFERENCE_COLUMNS} showMonth showAccount={false} />
        </Card>
      </div>
    </>
  );
}
