import type { KeyboardEvent } from 'react';
import clsx from 'clsx';

import { ConnectedBar } from '../../campaign-metrics/components/ConnectedBar';
import { SortableHeader, TableCard, TableStatus, TH_CLASS } from '../../campaign-metrics/components/TableChrome';
import type { SortState } from '../../campaign-metrics/useSortableRows';
import { roomKey } from '../api';
import type { ConferenceRecord } from '../api';
import { SummaryLink } from '../../campaign-metrics/components/SummaryLink';
import { ChartButton, DetailsButton } from '../../campaign-metrics/components/ChartButton';
import { summaryPath } from '../../campaign-metrics/links';
import { useClickToOpen } from '../../../lib/useClickToOpen';

/** A record as the table holds it: nulls flattened, and the connect rate worked out. */
export interface ConferenceRow extends ConferenceRecord {
  conference_name: string;
  account_name: string;
  start_time: string;
  connect_rate: number;
}

/** The columns a click on the header sorts by. */
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

const MINUTES: { key: 'call_minutes' | 'attended_minutes' | 'peak_port'; label: string; title: string }[] = [
  { key: 'call_minutes', label: 'Call min', title: 'Minutes from each leg starting to its release, summed' },
  { key: 'attended_minutes', label: 'Attended min', title: 'Minutes from each leg joining to its release, summed' },
  { key: 'peak_port', label: 'Peak port', title: 'The highest port number any leg used' },
];

const CELL = 'px-3 py-2.5 align-middle';
const NUM = `${CELL} text-right text-sm tabular-nums whitespace-nowrap`;

const nf = new Intl.NumberFormat('en-US');

/**
 * One day of conference_summary: a row per conference (CRN + Conf Num),
 * earliest start first until a header is clicked, on one scrolling list under a pinned header — a day holds
 * a few hundred rooms at most. A room nobody joined is greyed, so the empty
 * ones stand out without a filter. Clicking a row opens the room's details
 * (`onOpen`); the account id keeps its own link to the account's page.
 */
export function RecordsTable({
  rows,
  isLoading,
  error,
  openKey,
  onOpen,
  onChart,
  sort,
  onSort,
}: {
  rows: ConferenceRow[] | undefined;
  isLoading: boolean;
  error: Error | null;
  sort: SortState<ConferenceSortKey>;
  onSort: (key: ConferenceSortKey) => void;
  /** The room whose details are open, highlighted. */
  openKey?: string | null;
  onOpen?: (row: ConferenceRow) => void;
  /** Opens the charts for one conference (its account and CRN). */
  onChart?: (row: ConferenceRow) => void;
}) {
  const isEmpty = !isLoading && !error && (rows?.length ?? 0) === 0;
  const ready = !isLoading && !error && !isEmpty && rows;
  // Opens on a click, but not on one that selects text to copy.
  const clickToOpen = useClickToOpen();
  return (
    <TableCard>
      <TableStatus isLoading={isLoading} error={error} isEmpty={isEmpty} />
      {ready && (
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <SortableHeader label="Account" sortKey="account_id" sort={sort} onSort={onSort} />
                <SortableHeader label="Start time" sortKey="start_time" sort={sort} onSort={onSort} />
                <SortableHeader label="Conference" sortKey="conference_name" sort={sort} onSort={onSort} />
                <SortableHeader label="CRN" sortKey="crn" sort={sort} onSort={onSort} />
                <SortableHeader label="Ringed" sortKey="ringed" sort={sort} onSort={onSort} align="right" title="Distinct conferees dialled into the room" />
                <SortableHeader label="Connected" sortKey="connected" sort={sort} onSort={onSort} align="right" title="Of those, how many joined" />
                <SortableHeader label="Connected %" sortKey="connect_rate" sort={sort} onSort={onSort} align="right" />
                {MINUTES.map((m) => (
                  <SortableHeader key={m.key} label={m.label} sortKey={m.key} sort={sort} onSort={onSort} align="right" title={m.title} />
                ))}
                {(onChart || onOpen) && <th className={`${TH_CLASS} w-28`} />}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {rows.map((row) => {
                const empty = row.connected === 0;
                const open = openKey === roomKey(row);
                return (
                  <tr
                    key={roomKey(row)}
                    aria-selected={onOpen ? open : undefined}
                    {...(onOpen && {
                      tabIndex: 0,
                      title: 'Show this conference’s details',
                      onClick: (e: { detail: number }) => clickToOpen(e, () => onOpen(row)),
                      onKeyDown: (e: KeyboardEvent) => {
                        if (e.key === 'Enter') onOpen(row);
                      },
                    })}
                    className={clsx(
                      'transition-colors',
                      onOpen && 'cursor-pointer outline-none focus-visible:bg-[#eef5fe] dark:focus-visible:bg-white/[0.04]',
                      open ? 'bg-[#e8f1fd] dark:bg-sky-500/10' : 'hover:bg-[#f5f9fe] dark:hover:bg-white/[0.03]',
                      empty && 'text-zinc-400 dark:text-zinc-500',
                    )}
                  >
                    <td className={CELL}>
                      {/* The id is its own link, to the account's page — not the details. */}
                      <div
                        className="w-fit text-sm font-semibold tabular-nums text-zinc-900 dark:text-white"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <SummaryLink to={summaryPath('conference', row.account_id)!} title={`Open account ${row.account_id}'s page`}>
                          {row.account_id}
                        </SummaryLink>
                      </div>
                    </td>
                    <td className={clsx(CELL, 'whitespace-nowrap text-sm tabular-nums text-zinc-800 dark:text-zinc-200')}>
                      {row.start_time || '—'}
                    </td>
                    <td className={clsx(CELL, 'max-w-[320px]')}>
                      <div
                        className={clsx('truncate text-sm font-medium', empty ? 'text-zinc-500' : 'text-zinc-800 dark:text-zinc-100')}
                        title={row.conference_name}
                      >
                        {row.conference_name || '—'}
                      </div>
                    </td>
                    <td className={clsx(CELL, 'whitespace-nowrap text-sm tabular-nums')}>{row.crn}</td>
                    <td className={NUM}>{nf.format(row.ringed)}</td>
                    <td className={clsx(NUM, !empty && 'font-semibold text-emerald-600 dark:text-emerald-400')}>
                      {nf.format(row.connected)}
                    </td>
                    <td className={CELL}>
                      <ConnectedBar value={row.connect_rate} dim={empty} />
                    </td>
                    {MINUTES.map((m) => (
                      <td key={m.key} className={NUM}>
                        {nf.format(row[m.key])}
                      </td>
                    ))}
                    {(onChart || onOpen) && (
                      <td className={clsx(CELL, 'text-right')} onClick={(e) => e.stopPropagation()}>
                        <span className="inline-flex items-center gap-1.5">
                          {onChart && <ChartButton label={`View charts for CRN ${row.crn}`} onClick={() => onChart(row)} />}
                          {onOpen && <DetailsButton label={`Show details for CRN ${row.crn}`} onClick={() => onOpen(row)} />}
                        </span>
                      </td>
                    )}
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
