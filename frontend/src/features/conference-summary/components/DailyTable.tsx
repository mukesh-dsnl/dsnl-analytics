import clsx from 'clsx';

import { TableCard, TableStatus, TH_CLASS, TH_CLASS_RIGHT } from '../../campaign-metrics/components/TableChrome';
import type { ConferenceDay } from '../api';
import { PARTY_BUCKETS, dayLabel } from '../format';

const CELL = 'px-3 py-2 align-middle';
const NUM = `${CELL} text-right text-sm tabular-nums whitespace-nowrap`;
const nf = new Intl.NumberFormat('en-US');

/**
 * One line per day: rooms, conferees, minutes, and rooms by how many parties
 * connected. ACS / Proxy / MultiCall appear only once conference_daily_summary
 * has rows — conference_summary does not record the module type. Clicking a
 * day shows its conferences below.
 */
export function DailyTable({
  days,
  isLoading,
  error,
  selected,
  onSelect,
}: {
  days: ConferenceDay[] | undefined;
  isLoading: boolean;
  error: Error | null;
  selected: string;
  onSelect: (date: string) => void;
}) {
  const isEmpty = !isLoading && !error && (days?.length ?? 0) === 0;
  const ready = !isLoading && !error && !isEmpty && days;
  const hasModules = !!days?.some((d) => d.acs_count != null);
  return (
    <TableCard>
      <TableStatus isLoading={isLoading} error={error} isEmpty={isEmpty} />
      {ready && (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={TH_CLASS}>Date</th>
                <th className={TH_CLASS_RIGHT}>Conferences</th>
                {hasModules && (
                  <>
                    <th className={TH_CLASS_RIGHT} title="CODR records, module type 1">ACS</th>
                    <th className={TH_CLASS_RIGHT} title="CODR records, module type 2">Proxy</th>
                    <th className={TH_CLASS_RIGHT} title="CODR records, module type 4">MultiCall</th>
                  </>
                )}
                <th className={TH_CLASS_RIGHT}>Accounts</th>
                <th className={TH_CLASS_RIGHT}>Ringed</th>
                <th className={TH_CLASS_RIGHT}>Connected</th>
                <th className={TH_CLASS_RIGHT}>Attended min</th>
                <th className={TH_CLASS}>Rooms by parties connected</th>
                {PARTY_BUCKETS.map((b) => (
                  <th key={b.key} className={TH_CLASS_RIGHT} title={b.title}>
                    {b.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {days.map((day) => {
                const rooms = PARTY_BUCKETS.reduce((sum, b) => sum + day[b.key], 0);
                const isSelected = day.date === selected;
                return (
                  <tr
                    key={day.date}
                    onClick={() => onSelect(day.date)}
                    aria-selected={isSelected}
                    className={clsx(
                      'cursor-pointer transition-colors',
                      isSelected ? 'bg-[#e8f2fc] dark:bg-sky-500/10' : 'hover:bg-[#f5f9fe] dark:hover:bg-white/[0.03]',
                    )}
                  >
                    <td className={clsx(CELL, 'whitespace-nowrap text-sm font-medium text-zinc-800 dark:text-zinc-100')}>
                      {dayLabel(day.date)}
                      {day.source === 'conference_daily_summary' && (
                        <span className="ml-1.5 text-[10px] font-normal text-zinc-400" title="Party counts from conference_daily_summary">
                          daily
                        </span>
                      )}
                    </td>
                    <td className={NUM}>{nf.format(day.conferences)}</td>
                    {hasModules && (
                      <>
                        <td className={NUM}>{day.acs_count == null ? '—' : nf.format(day.acs_count)}</td>
                        <td className={NUM}>{day.proxy_count == null ? '—' : nf.format(day.proxy_count)}</td>
                        <td className={NUM}>{day.multicall_count == null ? '—' : nf.format(day.multicall_count)}</td>
                      </>
                    )}
                    <td className={NUM}>{nf.format(day.accounts)}</td>
                    <td className={NUM}>{nf.format(day.ringed)}</td>
                    <td className={NUM}>{nf.format(day.connected)}</td>
                    <td className={NUM}>{nf.format(day.attended_minutes)}</td>
                    <td className={clsx(CELL, 'min-w-[150px]')}>
                      <div className="flex h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-white/[0.06]">
                        {PARTY_BUCKETS.map((b) =>
                          day[b.key] > 0 ? (
                            <span
                              key={b.key}
                              className="h-full"
                              style={{ width: `${(day[b.key] / (rooms || 1)) * 100}%`, background: b.color }}
                            />
                          ) : null,
                        )}
                      </div>
                    </td>
                    {PARTY_BUCKETS.map((b) => (
                      <td key={b.key} className={clsx(NUM, b.key === 'party_0' && day.party_0 > 0 && 'text-[#e07d2c]')}>
                        {nf.format(day[b.key])}
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
