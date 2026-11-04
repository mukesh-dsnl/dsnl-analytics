import clsx from 'clsx';

import { ConnectedBar } from '../../campaign-metrics/components/ConnectedBar';
import { SortableHeader, TableCard, TableStatus, TH_CLASS } from '../../campaign-metrics/components/TableChrome';
import type { SortState } from '../../campaign-metrics/useSortableRows';
import type { ConferenceRecord } from '../api';
import { SummaryLink } from '../../campaign-metrics/components/SummaryLink';
import { summaryPath } from '../../campaign-metrics/links';

/** A record as the table holds it: nulls flattened for sorting, and the connect rate worked out. */
export interface ConferenceRow extends ConferenceRecord {
  conference_name: string;
  account_name: string;
  start_time: string;
  connect_rate: number;
}

export type ConferenceSortKey =
  | 'account_id'
  | 'start_time'
  | 'conference_name'
  | 'crn'
  | 'ringed'
  | 'connected'
  | 'connect_rate'
  | 'call_minutes'
  | 'attended_minutes'
  | 'peak_port';

const MEASURES: { key: ConferenceSortKey; label: string; title: string }[] = [
  { key: 'ringed', label: 'Ringed', title: 'Distinct conferees dialled into the room' },
  { key: 'connected', label: 'Connected', title: 'Of those, how many joined' },
];
const MINUTES: { key: ConferenceSortKey; label: string; title: string }[] = [
  { key: 'call_minutes', label: 'Call min', title: 'Minutes from each leg starting to its release, summed' },
  { key: 'attended_minutes', label: 'Attended min', title: 'Minutes from each leg joining to its release, summed' },
  { key: 'peak_port', label: 'Peak port', title: 'The highest port number any leg used' },
];

const CELL = 'px-3 py-2.5 align-middle';
const NUM = `${CELL} text-right text-sm tabular-nums whitespace-nowrap`;

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '—');
const nf = new Intl.NumberFormat('en-US');

/**
 * One day of conference_summary: a row per conference (CRN + Conf Num), on
 * one scrolling list under a pinned header — a day holds a few hundred rooms
 * at most. A room nobody joined is greyed, so the empty ones stand out
 * without a filter.
 */
export function RecordsTable({
  rows,
  isLoading,
  error,
  sort,
  onSort,
}: {
  rows: ConferenceRow[] | undefined;
  isLoading: boolean;
  error: Error | null;
  sort: SortState<ConferenceSortKey>;
  onSort: (key: ConferenceSortKey) => void;
}) {
  const isEmpty = !isLoading && !error && (rows?.length ?? 0) === 0;
  const ready = !isLoading && !error && !isEmpty && rows;
  return (
    <TableCard>
      <TableStatus isLoading={isLoading} error={error} isEmpty={isEmpty} />
      {ready && (
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <SortableHeader label="Account" sortKey="account_id" sort={sort} onSort={onSort} />
                <SortableHeader label="Time" sortKey="start_time" sort={sort} onSort={onSort} />
                <SortableHeader label="Conference" sortKey="conference_name" sort={sort} onSort={onSort} />
                <SortableHeader label="CRN" sortKey="crn" sort={sort} onSort={onSort} />
                <th className={TH_CLASS}>PIN · DID</th>
                {MEASURES.map((m) => (
                  <SortableHeader key={m.key} label={m.label} sortKey={m.key} sort={sort} onSort={onSort} align="right" />
                ))}
                <SortableHeader label="Connected %" sortKey="connect_rate" sort={sort} onSort={onSort} align="right" />
                {MINUTES.map((m) => (
                  <SortableHeader key={m.key} label={m.label} sortKey={m.key} sort={sort} onSort={onSort} align="right" />
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {rows.map((row) => {
                const empty = row.connected === 0;
                return (
                  <tr
                    key={`${row.crn}-${row.conf_num}`}
                    className={clsx(
                      'transition-colors hover:bg-[#f5f9fe] dark:hover:bg-white/[0.03]',
                      empty && 'text-zinc-400 dark:text-zinc-500',
                    )}
                  >
                    <td className={clsx(CELL, 'max-w-[240px]')}>
                      <div className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-white">
                        <SummaryLink to={summaryPath('conference', row.account_id)!} title={`Open account ${row.account_id}'s summary`}>
                          {row.account_id}
                        </SummaryLink>
                      </div>
                      <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400" title={row.account_name}>
                        {row.account_name}
                      </div>
                    </td>
                    <td className={clsx(CELL, 'whitespace-nowrap')}>
                      <div className="text-sm tabular-nums text-zinc-800 dark:text-zinc-200">
                        {hhmm(row.start_time)} – {hhmm(row.end_time)}
                      </div>
                      {row.length_minutes != null && (
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{row.length_minutes} min</div>
                      )}
                    </td>
                    <td className={clsx(CELL, 'max-w-[320px]')}>
                      <div
                        className={clsx('truncate text-sm font-medium', empty ? 'text-zinc-500' : 'text-zinc-800 dark:text-zinc-100')}
                        title={row.conference_name}
                      >
                        {row.conference_name || '—'}
                      </div>
                    </td>
                    <td className={clsx(CELL, 'whitespace-nowrap')}>
                      <div className="text-sm tabular-nums">{row.crn}</div>
                      <div className="text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">Conf {row.conf_num}</div>
                    </td>
                    <td className={clsx(CELL, 'whitespace-nowrap')}>
                      <div className="text-sm tabular-nums">{row.pin ?? '—'}</div>
                      <div className="text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400" title={row.dids.join(', ')}>
                        {row.dids.length ? row.dids[0] : 'no DID'}
                        {row.dids.length > 1 && ` +${row.dids.length - 1}`}
                      </div>
                    </td>
                    <td className={NUM}>{nf.format(row.ringed)}</td>
                    <td className={clsx(NUM, !empty && 'font-semibold text-emerald-600 dark:text-emerald-400')}>
                      {nf.format(row.connected)}
                    </td>
                    <td className={CELL}>
                      <ConnectedBar value={row.connect_rate} dim={empty} />
                    </td>
                    {MINUTES.map((m) => (
                      <td key={m.key} className={NUM}>
                        {nf.format(row[m.key] as number)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </TableCard>
  );
}
