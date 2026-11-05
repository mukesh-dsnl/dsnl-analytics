import { useMemo, useState } from 'react';
import clsx from 'clsx';

import { Card } from '../../cdr-dashboard/components/attempt-analytics/AttemptCharts';
import { fmt } from '../../cdr-dashboard/components/attempt-analytics/design';
import { downloadCsv } from '../../campaign-metrics/exportCsv';
import { dayLabel, monthLabel, weekdayDay } from '../format';
import { DownloadButton } from './PageParts';

export interface DailyColumn<T> {
  key: keyof T & string;
  label: string;
  percent?: boolean;
  /** The Total row's figure; summed when not given. */
  total?: (days: T[]) => number;
}

const TH = 'px-3 py-2 text-[10px] font-medium uppercase tracking-[0.6px] text-[#5b6a82] dark:text-zinc-400 whitespace-nowrap';
const TD = 'px-3 py-2 text-[12px] tabular-nums whitespace-nowrap text-[#405a7a] dark:text-zinc-200';

/**
 * The daily statement: one line per day of a month, every account together —
 * what the month looked like day by day, and its total. A month at a time,
 * newest day first, with the CSV of exactly what is shown.
 */
export function DailyStatement<T extends { date: string }>({
  days,
  months,
  asOf,
  columns,
  service,
  scope = 'all accounts together',
}: {
  days: T[];
  months: string[];
  asOf: string;
  columns: DailyColumn<T>[];
  /** The CSV's name starts with it: "voicedrop", "voicedrop-109446". */
  service: string;
  /** Whose days these are, for the subtitle. */
  scope?: string;
}) {
  // This month, or — for an account quiet this month — its latest month.
  const [month, setMonth] = useState(() => (months.includes(asOf.slice(0, 7)) ? asOf.slice(0, 7) : (months[months.length - 1] ?? asOf.slice(0, 7))));
  const lines = useMemo(() => days.filter((d) => d.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date)), [days, month]);
  // A total that does not add up (accounts across days) is given as NaN, and shown as a dash.
  const cell = (c: DailyColumn<T>, value: number) => (Number.isNaN(value) ? '—' : c.percent ? `${value}%` : fmt(value));
  const total = (c: DailyColumn<T>) => (c.total ? c.total(lines) : lines.reduce((s, d) => s + (Number(d[c.key]) || 0), 0));

  return (
    <div className="grid grid-cols-12 gap-4">
      <Card
        span={12}
        isLoading={false}
        error={null}
        isEmpty={!lines.length}
        title="Daily statement"
        subtitle={`Every day of ${monthLabel(month)}, ${scope}`}
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
                  {m === asOf.slice(0, 7) ? ` (to ${dayLabel(asOf)})` : ''}
                </option>
              ))}
            </select>
            <DownloadButton
              onClick={() =>
                downloadCsv(
                  `${service}-daily-statement-${month}.csv`,
                  ['Date', ...columns.map((c) => c.label)],
                  lines.map((d) => [d.date, ...columns.map((c) => d[c.key])]),
                )
              }
              disabled={!lines.length}
            />
          </div>
        }
      >
        <div className="max-h-[560px] overflow-auto rounded-xl border border-[#e9eef5] [scrollbar-width:thin] dark:border-white/[0.06]">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-[1] bg-[#eef5fc] dark:bg-[#13213a]">
              <tr>
                <th className={clsx(TH, 'text-left')}>Date</th>
                {columns.map((c) => (
                  <th key={c.key} className={clsx(TH, 'text-right')}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((d) => (
                <tr key={d.date} className="border-t border-[#eef2f7] dark:border-white/[0.05]">
                  <td className={clsx(TD, 'text-left font-medium')}>{weekdayDay(d.date)}</td>
                  {columns.map((c) => (
                    <td key={c.key} className={clsx(TD, 'text-right')}>
                      {cell(c, Number(d[c.key]) || 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {lines.length > 1 && (
              <tfoot className="sticky bottom-0 bg-[#f6f9fd] dark:bg-[#101c31]">
                <tr className="border-t border-[#dfe7f1] dark:border-white/[0.08]">
                  <td className={clsx(TD, 'text-left font-medium')}>Total · {lines.length} days</td>
                  {columns.map((c) => (
                    <td key={c.key} className={clsx(TD, 'text-right font-medium')}>
                      {cell(c, total(c))}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    </div>
  );
}
