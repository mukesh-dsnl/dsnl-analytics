import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft } from 'lucide-react';

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
import { AccountDirectory } from '../components/AccountDirectory';
import { StatementTable } from '../components/StatementTable';
import { Toggle } from '../components/ui';
import { AccountSelect, Centered, DownloadButton, Problem, SectionTitle } from '../components/PageParts';
import { CALENDAR_METRICS, HOUR_LABELS, HOUR_METRICS, voicedropDayTip } from '../voicedrop';
import type { CalendarMetric, HourMetric } from '../voicedrop';

const NONE = { isLoading: false, error: null };
const PROBLEM = "Couldn't read voicedrop_summary.";

const CLIENT_CHIP = 'rounded-full border px-2.5 py-0.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#42b9e9]';
const CLIENT_OFF =
  'border-[#dfe7f1] bg-white text-[#5b6a82] hover:border-[#bcd6ef] hover:text-[#1d4ed8] dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-zinc-300 dark:hover:text-sky-300';
const CLIENT_ON = 'border-[#2563eb] bg-[#2563eb] text-white dark:border-sky-400 dark:bg-sky-500/80';

/**
 * Voicedrop › Accounts: every account, searchable (?q=), and one account's
 * history (?account=), or one client of it (&client=). Clicking a day opens
 * that account's campaigns in Campaign Metrics.
 */
export function AccountsPage() {
  const [params, setParams] = useSearchParams();
  const accountId = Number(params.get('account')) || null;
  const clientId = (accountId && Number(params.get('client'))) || null;
  const headerSlot = useHeaderSlot();
  const navigate = useNavigate();
  const setCampaignDate = useCampaignDateStore((s) => s.setDate);

  const overview = useQuery({ queryKey: ['summary', 'overview'], queryFn: summaryApi.overview, staleTime: 5 * 60_000 });
  const openAccount = (id: number) => setParams({ account: String(id) });
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
          <AccountSelect
            value={accountId}
            onChange={(id) => setParams(id ? { account: String(id) } : {})}
            options={overview.data.accounts.map((a) => ({
              id: a.account_id,
              label: `${a.account_id}${a.name ? ` — ${a.name}` : ''} · ${compact(a.dialed)} dialed${a.days_idle >= 15 ? ` · quiet ${a.days_idle}d` : ''}`,
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
          <AccountView key={`${accountId}-${clientId}`} accountId={accountId} clientId={clientId} onDay={openDay} />
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

function AccountView({ accountId, clientId, onDay }: { accountId: number; clientId: number | null; onDay: (iso: string) => void }) {
  const query = useQuery({
    queryKey: ['summary', 'account', accountId, clientId],
    queryFn: () => summaryApi.account(accountId, clientId),
    staleTime: 5 * 60_000,
  });
  if (query.isPending) return <LoadingBlock />;
  if (query.error) return <Problem title={PROBLEM} message={query.error.message} onRetry={() => query.refetch()} />;
  return <History data={query.data} onDay={onDay} />;
}

function History({ data, onDay }: { data: AccountHistory; onDay: (iso: string) => void }) {
  const [calendarMetric, setCalendarMetric] = useState<CalendarMetric>('dialed');
  const [hourMetric, setHourMetric] = useState<HourMetric>('campaigns');
  const lines = useMemo<VoicedropStatementLine[]>(
    () => [...data.monthly].reverse().map((m) => ({ ...m, account_id: data.account_id, name: data.name, client_ids: data.client_ids })),
    [data],
  );
  const activeDays = data.daily.length;

  return (
    <>
      <Link
        to="/analytics/voicedrop/accounts"
        className="mb-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-[#5b6a82] transition-colors hover:text-[#1d4ed8] dark:text-zinc-400 dark:hover:text-sky-300"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All accounts
      </Link>
      <div className="mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
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
          first campaign {dayLabel(data.first_date)} · last {dayLabel(data.last_date)} · {fmt(activeDays)} active days
        </span>
        {/* Each client opens the same page with that client's campaigns alone. */}
        {data.clients.length > 0 && (
          <nav className="flex w-full flex-wrap gap-1.5" aria-label="Clients">
            {data.clients.length > 1 && (
              <Link to={`?account=${data.account_id}`} aria-current={!data.client ? 'page' : undefined} className={clsx(CLIENT_CHIP, !data.client ? CLIENT_ON : CLIENT_OFF)}>
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

      <SectionTitle>Activity</SectionTitle>
      <div className="mb-6 grid grid-cols-12 gap-4">
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
        <Card
          {...NONE}
          span={12}
          title="When it sends"
          subtitle="Campaigns by weekday and start hour — the share of the week is on the right"
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
          subtitle={`${data.client ? `Client ${data.client.id} of account` : 'Account'} ${data.account_id}, month by month`}
          extra={
            <DownloadButton
              onClick={() =>
                downloadStatement(`voicedrop-statement-${data.account_id}${data.client ? `-${data.client.id}` : ''}.csv`, lines, VOICEDROP_COLUMNS)
              }
            />
          }
        >
          <StatementTable lines={lines} columns={VOICEDROP_COLUMNS} showMonth showAccount={false} />
        </Card>
      </div>
    </>
  );
}
