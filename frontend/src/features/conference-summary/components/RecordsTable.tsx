import type { KeyboardEvent } from 'react';
import clsx from 'clsx';

import { ConnectedBar } from '../../campaign-metrics/components/ConnectedBar';
import { TableCard, TableStatus, TH_CLASS, TH_CLASS_RIGHT } from '../../campaign-metrics/components/TableChrome';
import { roomKey } from '../api';
import type { ConferenceRecord } from '../api';
import { SummaryLink } from '../../campaign-metrics/components/SummaryLink';
import { ChartButton } from '../../campaign-metrics/components/ChartButton';
import { summaryPath } from '../../campaign-metrics/links';

/** A record as the table holds it: nulls flattened, and the connect rate worked out. */
export interface ConferenceRow extends ConferenceRecord {
  conference_name: string;
  account_name: string;
  start_time: string;
  connect_rate: number;
}

const MINUTES: { key: 'call_minutes' | 'attended_minutes' | 'peak_port'; label: string; title: string }[] = [
  { key: 'call_minutes', label: 'Call min', title: 'Minutes from each leg starting to its release, summed' },
  { key: 'attended_minutes', label: 'Attended min', title: 'Minutes from each leg joining to its release, summed' },
  { key: 'peak_port', label: 'Peak port', title: 'The highest port number any leg used' },
];

const CELL = 'px-3 py-2.5 align-middle';
const NUM = `${CELL} text-right text-sm tabular-nums whitespace-nowrap`;

const nf = new Intl.NumberFormat('en-US');

/**
 * One day of conference_summary: a row per conference (CRN + Conf Num), in
 * start-time order, on one scrolling list under a pinned header — a day holds
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
}: {
  rows: ConferenceRow[] | undefined;
  isLoading: boolean;
  error: Error | null;
  /** The room whose details are open, highlighted. */
  openKey?: string | null;
  onOpen?: (row: ConferenceRow) => void;
  /** Opens the charts for one conference (its account and CRN). */
  onChart?: (row: ConferenceRow) => void;
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
                <th className={TH_CLASS}>Account</th>
                <th className={`${TH_CLASS} whitespace-nowrap`}>Start time</th>
                <th className={TH_CLASS}>Conference</th>
                <th className={TH_CLASS}>CRN</th>
                <th className={TH_CLASS_RIGHT} title="Distinct conferees dialled into the room">
                  Ringed
                </th>
                <th className={TH_CLASS_RIGHT} title="Of those, how many joined">
                  Connected
                </th>
                <th className={TH_CLASS_RIGHT}>Connected %</th>
                {MINUTES.map((m) => (
                  <th key={m.key} className={TH_CLASS_RIGHT} title={m.title}>
                    {m.label}
                  </th>
                ))}
                {onChart && <th className={`${TH_CLASS} w-16`} />}
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
                      onClick: () => onOpen(row),
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
                    <td className={clsx(CELL, 'max-w-[240px]')}>
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
                      <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400" title={row.account_name}>
                        {row.account_name}
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
                    {onChart && (
                      <td className={clsx(CELL, 'text-right')} onClick={(e) => e.stopPropagation()}>
                        <ChartButton label={`View charts for CRN ${row.crn}`} onClick={() => onChart(row)} />
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
