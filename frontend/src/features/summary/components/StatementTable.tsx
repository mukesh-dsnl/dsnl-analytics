import type { KeyboardEvent } from 'react';
import clsx from 'clsx';

import { fmt } from '../../cdr-dashboard/components/attempt-analytics/design';
import { monthLabel } from '../format';
import { columnTotal } from '../statement';
import type { StatementBase, StatementColumn } from '../statement';

const TH = 'px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.6px] text-[#2f5a8c] dark:text-[#a9c3e6] whitespace-nowrap';
const TD = 'px-3.5 py-2.5 text-[13px] tabular-nums whitespace-nowrap text-[#405a7a] transition-colors dark:text-zinc-200';
// A row that opens something: tinted and blue under the pointer, reachable by keyboard.
const ROW_LINK =
  'group cursor-pointer outline-none hover:bg-[#f2f7fe] focus-visible:bg-[#f2f7fe] dark:hover:bg-white/[0.04] dark:focus-visible:bg-white/[0.04]';
const TD_LINK = 'group-hover:text-[#1d4ed8] group-focus-visible:text-[#1d4ed8] dark:group-hover:text-sky-300 dark:group-focus-visible:text-sky-300';

/**
 * The monthly statement: per account, per month — what billing or the client
 * gets, as a CSV. The columns are the service's own (see ../statement.ts).
 * With `onRow`, a row opens what it stands for (an account's statement, a
 * month's days).
 */
export function StatementTable<T extends StatementBase>({
  lines,
  columns,
  showMonth,
  showAccount,
  onRow,
  rowTitle,
}: {
  lines: T[];
  columns: StatementColumn<T>[];
  showMonth: boolean;
  showAccount: boolean;
  onRow?: (line: T) => void;
  rowTitle?: (line: T) => string;
}) {
  const byName = lines.some((l) => l.name != null);
  const cell = (column: StatementColumn<T>, value: number) => (column.percent ? `${value}%` : fmt(value));
  const td = (...extra: string[]) => clsx(TD, onRow && TD_LINK, ...extra);
  return (
    <div className="max-h-[460px] overflow-auto rounded-xl border border-[#e9eef5] [scrollbar-width:thin] dark:border-white/[0.06]">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-[1] bg-[#eef5fc] dark:bg-[#13213a]">
          <tr>
            {showMonth && <th className={clsx(TH, 'text-left')}>Month</th>}
            {showAccount && <th className={clsx(TH, 'text-left')}>Account</th>}
            {showAccount && <th className={clsx(TH, 'text-left')}>{byName ? 'Name' : 'Clients'}</th>}
            {columns.map((c) => (
              <th key={c.key} className={clsx(TH, 'text-right')}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr
              key={`${line.month}-${line.account_id}`}
              className={clsx('border-t border-[#eef2f7] dark:border-white/[0.05]', onRow && ROW_LINK)}
              {...(onRow && {
                tabIndex: 0,
                title: rowTitle?.(line),
                onClick: () => onRow(line),
                onKeyDown: (e: KeyboardEvent) => {
                  if (e.key === 'Enter') onRow(line);
                },
              })}
            >
              {showMonth && <td className={td('text-left font-medium')}>{monthLabel(line.month)}</td>}
              {showAccount && <td className={td('text-left font-mono font-semibold text-[#1d4ed8] dark:text-sky-300')}>{line.account_id}</td>}
              {showAccount && (
                <td className={td('max-w-[300px] truncate text-left text-[#6a7d96]')} title={line.name ?? undefined}>
                  {byName ? line.name : (line.client_ids ?? []).join(', ')}
                </td>
              )}
              {columns.map((c) => (
                <td key={c.key} className={td('text-right')}>
                  {cell(c, Number(line[c.key]) || 0)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {lines.length > 1 && (
          <tfoot className="sticky bottom-0 bg-[#f6f9fd] dark:bg-[#101c31]">
            <tr className="border-t border-[#dfe7f1] dark:border-white/[0.08]">
              <td className={clsx(TD, 'text-left font-semibold')} colSpan={(showMonth ? 1 : 0) + (showAccount ? 2 : 0) || 1}>
                Total
              </td>
              {columns.map((c) => (
                <td key={c.key} className={clsx(TD, 'text-right font-semibold')}>
                  {cell(c, columnTotal(lines, c))}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
