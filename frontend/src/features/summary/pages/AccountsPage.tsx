import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';

import { useHeaderSlot } from '../../../components/HeaderSlot';
import { LoadingBlock } from '../../../components/Loading';
import { useCampaignDateStore } from '../../../store';
import { HoverTooltipProvider } from '../../cdr-dashboard/components/attempt-analytics/HoverTooltip';
import { Card } from '../../cdr-dashboard/components/attempt-analytics/AttemptCharts';
import { compact, fmt } from '../../cdr-dashboard/components/attempt-analytics/design';
import { summaryApi } from '../api';
import type { AccountHistory } from '../api';
import { dayLabel } from '../format';
import { VOICEDROP_COLUMNS, downloadStatement } from '../statement';
import type { VoicedropStatementLine } from '../statement';
import { ActivityCalendar } from '../components/ActivityCalendar';
import { WeekHourHeatmap } from '../components/WeekHourHeatmap';
import { DailyVolume } from '../components/DailyVolume';
import { DailyStatement } from '../components/DailyStatement';
import { AccountDirectory } from '../components/AccountDirectory';
import { AccountHeader } from '../components/AccountHeader';
import { useAccountTab } from '../accountTabs';
import type { AccountTab } from '../accountTabs';
import { AccountPicker } from '../components/AccountPicker';
import { StatementTable } from '../components/StatementTable';
import { Toggle } from '../components/ui';
import { Centered, DownloadButton, Problem } from '../components/PageParts';
import { CALENDAR_METRICS, HOUR_LABELS, HOUR_METRICS, VOICEDROP_DAILY_COLUMNS, voicedropDayTip, withRate } from '../voicedrop';
import type { CalendarMetric, HourMetric } from '../voicedrop';

const NONE = { isLoading: false, error: null };
const PROBLEM = "Couldn't read voicedrop_summary.";
// One account's daily statement: the Accounts column counts accounts, so it goes.
const ACCOUNT_DAILY_COLUMNS = VOICEDROP_DAILY_COLUMNS.filter((c) => c.key !== 'accounts');

const CLIENT_CHIP = 'rounded-full border px-2.5 py-0.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#42b9e9]';
const CLIENT_OFF =
  'border-[#dfe7f1] bg-white text-[#5b6a82] hover:border-[#bcd6ef] hover:text-[#1d4ed8] dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-zinc-300 dark:hover:text-sky-300';
const CLIENT_ON = 'border-[#2563eb] bg-[#2563eb] text-white dark:border-sky-400 dark:bg-sky-500/80';

/**
 * Voicedrop › Accounts: every account, searchable (?q=), and one account's
 * history (?account=), or one client of it (&client=), in four sections
 * (&tab=). Clicking a day opens that account's campaigns in Campaign Metrics.
 */
export function AccountsPage() {
  const [params, setParams] = useSearchParams();
  const accountId = Number(params.get('account')) || null;
  const clientId = (accountId && Number(params.get('client'))) || null;
  const [tab, setTab] = useAccountTab();
  const headerSlot = useHeaderSlot();
  const navigate = useNavigate();
  const setCampaignDate = useCampaignDateStore((s) => s.setDate);

  const overview = useQuery({ queryKey: ['summary', 'overview'], queryFn: summaryApi.overview, staleTime: 5 * 60_000 });
  const openAccount = (id: number | null) => setParams(id ? { account: String(id), ...(tab !== 'daily' && { tab }) } : {});
  const openDay = (iso: string) => {
    setCampaignDate(iso);
    navigate(
      `/analytics/voicedrop/campaign-metrics?view=campaigns&date=${iso}&account=${accountId}${clientId ? `&search=${clientId}` : ''}`,
    );
  };

  const header =
    headerSlot &&
    createPortal(
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <h1 className="shrink-0 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Voicedrop Accounts</h1>
        {overview.data && (
          <AccountPicker
            value={accountId}
            onChange={openAccount}
            options={overview.data.accounts.map((a) => ({
              id: a.account_id,
              name: a.name,
              meta: `${compact(a.dialed)} dialed`,
              days_idle: a.days_idle,
            }))}
          />
        )}
        {overview.data?.as_of && (
          <span className="ml-auto hidden shrink-0 text-xs text-zinc-500 sm:inline dark:text-zinc-400">Data to {dayLabel(overview.data.as_of)}</span>
        )}
      </div>,
      headerSlot,
    );

  return (
    <HoverTooltipProvider>
      {header}
      <div className="vd-design mx-auto max-w-[1500px] p-8">
        {accountId ? (
          <AccountView key={`${accountId}-${clientId}`} accountId={accountId} clientId={clientId} tab={tab} onTab={setTab} onDay={openDay} />
        ) : overview.isPending ? (
          <LoadingBlock />
        ) : overview.error ? (
          <Problem title={PROBLEM} message={overview.error.message} onRetry={() => overview.refetch()} />
        ) : !overview.data.as_of ? (
          <Centered>voicedrop_summary has no rows yet.</Centered>
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
            onQuery={(q) => setParams(q ? { q } : {})}
            onAccount={openAccount}
          />
        )}
      </div>
    </HoverTooltipProvider>
  );
}

interface ViewProps {
  tab: AccountTab;
  onTab: (tab: AccountTab) => void;
  onDay: (iso: string) => void;
}

function AccountView({ accountId, clientId, ...rest }: ViewProps & { accountId: number; clientId: number | null }) {
  const query = useQuery({
    queryKey: ['summary', 'account', accountId, clientId],
    queryFn: () => summaryApi.account(accountId, clientId),
    staleTime: 5 * 60_000,
  });
  if (query.isPending) return <LoadingBlock />;
  if (query.error) return <Problem title={PROBLEM} message={query.error.message} onRetry={() => query.refetch()} />;
  return <History data={query.data} {...rest} />;
}

function History({ data, tab, onTab, onDay }: ViewProps & { data: AccountHistory }) {
  const [calendarMetric, setCalendarMetric] = useState<CalendarMetric>('dialed');
  const [hourMetric, setHourMetric] = useState<HourMetric>('campaigns');
  const lines = useMemo<VoicedropStatementLine[]>(
    () => [...data.monthly].reverse().map((m) => ({ ...m, account_id: data.account_id, name: data.name, client_ids: data.client_ids })),
    [data],
  );
  const who = data.client ? `client ${data.client.id} of account ${data.account_id}` : `account ${data.account_id}`;
  const file = `${data.account_id}${data.client ? `-${data.client.id}` : ''}`;
  const keepTab = tab !== 'daily' ? `&tab=${tab}` : '';

  return (
    <>
      <AccountHeader backTo="/analytics/voicedrop/accounts" id={data.account_id} name={data.name} tab={tab} onTab={onTab}>
        {/* Each client opens the same page with that client's campaigns alone. */}
        {data.clients.length > 0 && (
          <nav className="flex flex-wrap gap-1.5" aria-label="Clients">
            {data.clients.length > 1 && (
              <Link
                to={`?account=${data.account_id}${keepTab}`}
                aria-current={!data.client ? 'page' : undefined}
                className={clsx(CLIENT_CHIP, !data.client ? CLIENT_ON : CLIENT_OFF)}
              >
                All clients
              </Link>
            )}
            {data.clients.map((c) => (
              <Link
                key={c.id}
                to={`?account=${data.account_id}&client=${c.id}${keepTab}`}
                aria-current={data.client?.id === c.id ? 'page' : undefined}
                title={`Show client ${c.id} alone`}
                className={clsx(CLIENT_CHIP, data.client?.id === c.id ? CLIENT_ON : CLIENT_OFF)}
              >
                <span className={clsx('font-mono tabular-nums', data.client?.id !== c.id && 'text-[#8a99ad]')}>{c.id}</span>
                {c.name && <span className="ml-1">{c.name}</span>}
              </Link>
            ))}
          </nav>
        )}
      </AccountHeader>

      {tab === 'daily' && (
        <div className="grid grid-cols-12 gap-4">
          <Card {...NONE} span={12} title="Daily volume" subtitle="Dial out and connected — every day, the latest in view">
            <DailyVolume
              days={data.daily.map((d) => ({ date: d.date, total: d.dialout, connected: d.connected }))}
              asOf={data.as_of}
              totalLabel="dialed"
              onDay={onDay}
            />
          </Card>
          <Card
            {...NONE}
            span={12}
            title="Activity calendar"
            subtitle="Every day of the last 12 months — click a day to open its campaigns"
            extra={<Toggle label="Colour by" options={CALENDAR_METRICS} value={calendarMetric} onChange={setCalendarMetric} />}
          >
            <ActivityCalendar
              days={data.daily}
              asOf={data.as_of}
              firstDate={data.first_date}
              valueOf={(d) => d[calendarMetric]}
              renderTip={voicedropDayTip(calendarMetric)}
              emptyLabel="No campaigns."
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
            subtitle="Campaigns by weekday and start hour — the share of the week is on the right"
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
            subtitle={`${who[0].toUpperCase()}${who.slice(1)}, month by month`}
            extra={<DownloadButton onClick={() => downloadStatement(`voicedrop-statement-${file}.csv`, lines, VOICEDROP_COLUMNS)} />}
          >
            <StatementTable lines={lines} columns={VOICEDROP_COLUMNS} showMonth showAccount={false} />
          </Card>
        </div>
      )}

      {tab === 'statement' && (
        <DailyStatement
          days={data.daily.map(withRate)}
          months={data.monthly.map((m) => m.month)}
          asOf={data.as_of}
          columns={ACCOUNT_DAILY_COLUMNS}
          service={`voicedrop-${file}`}
          scope={who}
        />
      )}
    </>
  );
}
