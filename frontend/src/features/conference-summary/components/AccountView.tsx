import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { LoadingBlock } from '../../../components/Loading';
import { Card } from '../../cdr-dashboard/components/attempt-analytics/AttemptCharts';
import { AccountHeader } from '../../summary/components/AccountHeader';
import type { AccountTab } from '../../summary/accountTabs';
import { ActivityCalendar } from '../../summary/components/ActivityCalendar';
import { DailyStatement } from '../../summary/components/DailyStatement';
import { DailyVolume } from '../../summary/components/DailyVolume';
import { DownloadButton, Problem } from '../../summary/components/PageParts';
import { StatementTable } from '../../summary/components/StatementTable';
import { WeekHourHeatmap } from '../../summary/components/WeekHourHeatmap';
import { Toggle } from '../../summary/components/ui';
import { monthLabel } from '../../summary/format';
import { downloadStatement } from '../../summary/statement';
import { conferenceSummaryApi } from '../api';
import type { ConferenceAccountHistory, ConferenceStatementLine } from '../api';
import { CONFERENCE_COLUMNS, CONFERENCE_DAILY_COLUMNS, withConnectRate } from '../statement';
import { CALENDAR_METRICS, HOUR_LABELS, HOUR_METRICS, conferenceDayTip } from './shared';
import type { CalendarMetric, HourMetric } from './shared';

const NONE = { isLoading: false, error: null };
// One account's daily statement: the Accounts column counts accounts, so it goes.
const ACCOUNT_DAILY_COLUMNS = CONFERENCE_DAILY_COLUMNS.filter((c) => c.key !== 'accounts');

interface ViewProps {
  tab: AccountTab;
  onTab: (tab: AccountTab) => void;
  onDay: (iso: string) => void;
  /** The Daily Statement's month (?month=), set by clicking a month. */
  month: string | null;
  onMonth: (month: string) => void;
}

/** One account's history on the Conference Accounts page, in four sections (?tab=). */
export function AccountView({ accountId, ...rest }: ViewProps & { accountId: number }) {
  const query = useQuery({
    queryKey: ['conference-summary', 'account', accountId],
    queryFn: () => conferenceSummaryApi.account(accountId),
    staleTime: 5 * 60_000,
  });
  if (query.isPending) return <LoadingBlock />;
  if (query.error) {
    return <Problem title="Couldn't read conference_summary." message={query.error.message} onRetry={() => query.refetch()} />;
  }
  return <History data={query.data} {...rest} />;
}

function History({ data, tab, onTab, onDay, month, onMonth }: ViewProps & { data: ConferenceAccountHistory }) {
  const [calendarMetric, setCalendarMetric] = useState<CalendarMetric>('conferences');
  const [hourMetric, setHourMetric] = useState<HourMetric>('conferences');
  const lines = useMemo<ConferenceStatementLine[]>(
    () => [...data.monthly].reverse().map((m) => ({ ...m, account_id: data.account_id, name: data.name })),
    [data],
  );

  return (
    <>
      <AccountHeader backTo="/analytics/conference/accounts" id={data.account_id} name={data.name} tab={tab} onTab={onTab} />

      {tab === 'daily' && (
        <div className="grid grid-cols-12 gap-4">
          <Card {...NONE} span={12} title="Daily volume" subtitle="Parties ringed and connected — every day, the latest in view">
            <DailyVolume
              days={data.daily.map((d) => ({ date: d.date, total: d.ringed, connected: d.connected }))}
              asOf={data.as_of}
              totalLabel="ringed"
              onDay={onDay}
            />
          </Card>
          <Card
            {...NONE}
            span={12}
            title="Activity calendar"
            subtitle="Every day of the last 12 months — click a day to open its conferences"
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
        </div>
      )}

      {tab === 'hours' && (
        <div className="grid grid-cols-12 gap-4">
          <Card
            {...NONE}
            span={12}
            title="Busiest hours"
            subtitle="Conferences by weekday and start hour — the share of the week is on the right"
            extra={<Toggle label="Colour by" options={HOUR_METRICS} value={hourMetric} onChange={setHourMetric} />}
          >
            <WeekHourHeatmap cells={data.weekday_hour} metric={hourMetric} metrics={HOUR_LABELS} />
          </Card>
        </div>
      )}

      {tab === 'monthly' && (
        <div className="grid grid-cols-12 gap-4">
          <Card
            {...NONE}
            span={12}
            title="Monthly statement"
            subtitle={`Account ${data.account_id}, month by month`}
            extra={
              <DownloadButton onClick={() => downloadStatement(`conference-statement-${data.account_id}.csv`, lines, CONFERENCE_COLUMNS)} />
            }
          >
            <StatementTable
              lines={lines}
              columns={CONFERENCE_COLUMNS}
              showMonth
              showAccount={false}
              onRow={(line) => onMonth(line.month)}
              rowTitle={(line) => `Open the days of ${monthLabel(line.month)}`}
            />
          </Card>
        </div>
      )}

      {tab === 'statement' && (
        <DailyStatement
          days={data.daily.map(withConnectRate)}
          months={data.monthly.map((m) => m.month)}
          asOf={data.as_of}
          columns={ACCOUNT_DAILY_COLUMNS}
          service={`conference-${data.account_id}`}
          scope={`account ${data.account_id}`}
          initialMonth={month}
          onDay={onDay}
        />
      )}
    </>
  );
}
