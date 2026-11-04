import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Info, PhoneCall, Server, Timer, UserCheck, Video } from 'lucide-react';

import { useSortableRows } from '../../campaign-metrics/useSortableRows';
import { downloadCsv } from '../../campaign-metrics/exportCsv';
import { DownloadButton } from '../../summary/components/PageParts';
import { TipBody } from '../../cdr-dashboard/components/attempt-analytics/HoverTooltip';
import { Kpi } from '../../cdr-dashboard/components/attempt-analytics/AttemptKpis';
import { TONES, compact, fmt, pct } from '../../cdr-dashboard/components/attempt-analytics/design';
import { conferenceSummaryApi } from '../api';
import type { ConferenceDay, ConferenceRecord, ConferenceStatus } from '../api';
import { DailyTable } from './DailyTable';
import { RecordsTable } from './RecordsTable';
import type { ConferenceRow, ConferenceSortKey } from './RecordsTable';
import { PARTY_BUCKETS, dayLabel } from '../format';

/** How many days the daily summary shows, ending on the selected day. */
const DAILY_SPAN = 31;

/**
 * The Day tab: one day of conference_summary — its headline figures, the
 * daily summary around it, and every conference that day. The page's header
 * holds the date and the search.
 */
export function DayView({
  status,
  date,
  onDate,
  search,
}: {
  status: ConferenceStatus;
  date: string;
  onDate: (date: string) => void;
  search: string;
}) {

  const records = useQuery({
    queryKey: ['conference-summary', 'records', date],
    queryFn: () => conferenceSummaryApi.records(date),
    placeholderData: (previous) => previous,
  });
  // The month to the selected day: kept while clicking between its days.
  const [dailyEnd, setDailyEnd] = useState(date);
  if (date > dailyEnd || date < shiftDays(dailyEnd, -(DAILY_SPAN - 1))) setDailyEnd(date);
  const daily = useQuery({
    queryKey: ['conference-summary', 'daily', dailyEnd],
    queryFn: () => conferenceSummaryApi.daily(dailyEnd, DAILY_SPAN),
    placeholderData: (previous) => previous,
  });

  const term = search.trim().toLowerCase();
  const rows = useMemo((): ConferenceRow[] | undefined => {
    const all = records.data?.rows.map((r) => ({
      ...r,
      conference_name: r.conference_name ?? '',
      account_name: r.account_name ?? '',
      start_time: r.start_time ?? '',
      connect_rate: r.ringed ? Math.round((r.connected / r.ringed) * 1000) / 10 : 0,
    }));
    if (!all || !term) return all;
    return all.filter((r) =>
      [r.account_id, r.account_name, r.crn, r.conf_num, r.conference_name, r.pin ?? '', ...r.dids].some((v) =>
        String(v).toLowerCase().includes(term),
      ),
    );
  }, [records.data, term]);
  const sorted = useSortableRows<ConferenceRow, ConferenceSortKey>(rows, { key: 'start_time', direction: 'asc' });

  const day = daily.data?.rows.find((d) => d.date === date);

  const exportRecords = () =>
    downloadCsv(
      `conference-summary-${date}.csv`,
      [
        'Call Date', 'Account ID', 'CRN', 'Conf Num', 'Start Time', 'End Time', 'Account Name', 'Conference Name',
        'PIN', 'DID', 'Total Ringed Calls', 'Total Connected Calls', 'Total Call Duration (Mins)',
        'Total Attended Duration (Mins)', 'Peak Port Used',
      ],
      (sorted.rows ?? []).map((r) => [
        r.date, r.account_id, r.crn, r.conf_num, r.start_time, r.end_time, r.account_name, r.conference_name,
        r.pin, r.dids.join(', '), r.ringed, r.connected, r.call_minutes, r.attended_minutes, r.peak_port,
      ]),
    );

  const exportDaily = () =>
    downloadCsv(
      `conference-daily-summary-${dailyEnd}.csv`,
      [
        'Date', 'Conferences', 'Total Count', 'ACS Count', 'Proxy Count', 'Multicall Count', 'Accounts', 'Ringed',
        'Connected', 'Call Minutes', 'Attended Minutes', 'Peak Port', '0 Party', '1 Party', '2 Party', '3 Party',
        '>3 Party', 'Source',
      ],
      (daily.data?.rows ?? []).map((d) => [
        d.date, d.conferences, d.total_count, d.acs_count, d.proxy_count, d.multicall_count, d.accounts, d.ringed,
        d.connected, d.call_minutes, d.attended_minutes, d.peak_port, d.party_0, d.party_1, d.party_2, d.party_3,
        d.party_above_3, d.source,
      ]),
    );

  return (
    <>
        {/* The cards follow the search: with one account typed in, they are that account's day. */}
        <DayKpis day={term ? undefined : day} records={rows} isLoading={records.isPending} error={records.error} date={date} />

        <SectionHeading
          title="Daily summary"
          note={`${DAILY_SPAN} days to ${dayLabel(dailyEnd)} — click a day to show its conferences`}
          action={<DownloadButton onClick={exportDaily} disabled={!daily.data?.rows.length} />}
        />
        {status.daily_table_days === 0 && (
          <p className="mb-3 flex items-start gap-2 rounded-lg border border-[#d6e6f5] bg-[#f3f8fd] px-3 py-2 text-[12px] text-[#40607f] dark:border-sky-500/20 dark:bg-sky-500/[0.06] dark:text-sky-200">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <strong className="font-semibold">conference_daily_summary has no rows yet.</strong> The party counts
              below are worked out from conference_summary (each room's connected calls — the same count the daily
              table uses). The ACS / Proxy / MultiCall split appears here once the daily table is filled.
            </span>
          </p>
        )}
        <div className="mb-8">
          <DailyTable
            days={daily.data?.rows}
            isLoading={daily.isPending}
            error={daily.error}
            selected={date}
            onSelect={onDate}
          />
        </div>

        <SectionHeading
          title={`Conferences on ${dayLabel(date)}`}
          note={
            rows
              ? `${fmt(rows.length)} ${rows.length === 1 ? 'conference' : 'conferences'}${term ? ` matching “${search.trim()}”` : ''} · rooms nobody joined are greyed`
              : ''
          }
          action={<DownloadButton onClick={exportRecords} disabled={!sorted.rows?.length} />}
        />
        <div className="flex max-h-[70vh] min-h-0 flex-col">
          <RecordsTable
            rows={sorted.rows}
            isLoading={records.isPending}
            error={records.error}
            sort={sorted.sort}
            onSort={sorted.toggle}
          />
        </div>
    </>
  );
}

/** The day's headline figures, from its conferences. */
function DayKpis({
  day,
  records,
  isLoading,
  error,
  date,
}: {
  day: ConferenceDay | undefined;
  records: ConferenceRecord[] | undefined;
  isLoading: boolean;
  error: Error | null;
  date: string;
}) {
  const rooms = records?.length ?? 0;
  const sum = (key: 'ringed' | 'connected' | 'call_minutes' | 'attended_minutes') =>
    (records ?? []).reduce((total, r) => total + r[key], 0);
  const ringed = sum('ringed');
  const connected = sum('connected');
  const attended = sum('attended_minutes');
  const callMinutes = sum('call_minutes');
  const peak = (records ?? []).reduce<ConferenceRecord | undefined>(
    (best, r) => (!best || r.peak_port > best.peak_port ? r : best),
    undefined,
  );
  const empty = (records ?? []).filter((r) => r.connected === 0).length;
  const state = { isLoading, error };

  return (
    <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-5">
      <Kpi
        {...state}
        tone={TONES.blue}
        icon={Video}
        label="Conferences"
        value={fmt(rooms)}
        note={
          <>
            <strong>{fmt(empty)}</strong> nobody joined
          </>
        }
        tip={() => (
          <TipBody
            eyebrow={dayLabel(date)}
            title="Rooms by parties connected"
            value={rooms}
            sections={
              day
                ? [{ title: 'Parties connected', rows: PARTY_BUCKETS.map((b) => ({ label: `${b.label} — ${b.title.toLowerCase()}`, value: day[b.key] })) }]
                : []
            }
          />
        )}
      />
      <Kpi
        {...state}
        tone={TONES.sky}
        icon={PhoneCall}
        label="Ringed"
        value={compact(ringed)}
        note={<>conferees dialled in</>}
        tip={() => <TipBody eyebrow={dayLabel(date)} title="Distinct conferees, summed over rooms" value={ringed} />}
      />
      <Kpi
        {...state}
        tone={TONES.teal}
        icon={UserCheck}
        label="Connected"
        value={compact(connected)}
        bar={ringed ? (connected / ringed) * 100 : 0}
        note={
          <>
            <strong>{pct(connected, ringed)}</strong> of ringed
          </>
        }
        tip={() => (
          <TipBody eyebrow={dayLabel(date)} title="Conferees who joined" value={connected} share={`${pct(connected, ringed)} of ${fmt(ringed)} ringed`} />
        )}
      />
      <Kpi
        {...state}
        tone={TONES.violet}
        icon={Timer}
        label="Attended minutes"
        value={compact(attended)}
        note={
          <>
            of <strong>{compact(callMinutes)}</strong> call minutes
          </>
        }
        tip={() => (
          <TipBody
            eyebrow={dayLabel(date)}
            title="Minutes joined to release"
            value={attended}
            share={`${fmt(callMinutes)} minutes start to release`}
          />
        )}
      />
      <Kpi
        {...state}
        tone={TONES.orange}
        icon={Server}
        label="Peak port"
        value={fmt(peak?.peak_port ?? 0)}
        note={<span className="block truncate">{peak?.conference_name ?? '—'}</span>}
        tip={() => (
          <TipBody
            eyebrow="Highest port number used"
            title={peak?.conference_name ?? '—'}
            value={peak?.peak_port ?? 0}
            share={peak ? `CRN ${peak.crn}` : undefined}
          />
        )}
      />
    </div>
  );
}

function SectionHeading({ title, note, action }: { title: string; note: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[14px] font-semibold text-[#35415a] dark:text-zinc-100">{title}</h2>
        {note && <p className="mt-0.5 text-[12px] text-[#7a899f] dark:text-zinc-400">{note}</p>}
      </div>
      {action}
    </div>
  );
}

/** "2026-11-02" moved by n days. */
function shiftDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const day = new Date(y, m - 1, d + n);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}
