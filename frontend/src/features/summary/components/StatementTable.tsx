import clsx from 'clsx';

import { fmt } from '../../cdr-dashboard/components/attempt-analytics/design';
import { monthLabel } from '../format';
import { STATEMENT_COLUMNS as COLUMNS } from '../statement';
import type { StatementLine } from '../statement';

const TH = 'px-3 py-2 text-[10px] font-medium uppercase tracking-[0.6px] text-[#5b6a82] dark:text-zinc-400 whitespace-nowrap';
const TD = 'px-3 py-2 text-[12px] tabular-nums whitespace-nowrap text-[#405a7a] dark:text-zinc-200';

/**
 * The monthly statement: per account, per month — campaigns, dialed,
 * connected and minutes. What billing or the client gets, as a CSV.
 */
export function StatementTable({
  lines,
  showMonth,
  showAccount,
}: {
  lines: StatementLine[];
  showMonth: boolean;
  showAccount: boolean;
}) {
  const totals = COLUMNS.reduce<Record<string, number>>((acc, c) => {
    acc[c.key] = c.key === 'connect_rate' ? 0 : lines.reduce((sum, l) => sum + (l[c.key] as number), 0);
    return acc;
  }, {});
  totals.connect_rate = totals.dialed ? Math.round((totals.connected / totals.dialed) * 1000) / 10 : 0;

  return (
    <div className="max-h-[420px] overflow-auto rounded-xl border border-[#e9eef5] [scrollbar-width:thin] dark:border-white/[0.06]">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-[1] bg-[#eef5fc] dark:bg-[#13213a]">
          <tr>
            {showMonth && <th className={clsx(TH, 'text-left')}>Month</th>}
            {showAccount && <th className={clsx(TH, 'text-left')}>Account</th>}
            {showAccount && <th className={clsx(TH, 'text-left')}>Clients</th>}
            {COLUMNS.map((c) => (
              <th key={c.key} className={clsx(TH, 'text-right')}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={`${line.month}-${line.account_id}`} className="border-t border-[#eef2f7] dark:border-white/[0.05]">
              {showMonth && <td className={clsx(TD, 'text-left')}>{monthLabel(line.month)}</td>}
              {showAccount && <td className={clsx(TD, 'text-left font-medium')}>{line.account_id}</td>}
              {showAccount && <td className={clsx(TD, 'text-left text-[#8a99ad]')}>{line.client_ids.join(', ')}</td>}
              {COLUMNS.map((c) => (
                <td key={c.key} className={clsx(TD, 'text-right')}>
                  {c.key === 'connect_rate' ? `${line.connect_rate}%` : fmt(line[c.key] as number)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {lines.length > 1 && (
          <tfoot className="sticky bottom-0 bg-[#f6f9fd] dark:bg-[#101c31]">
            <tr className="border-t border-[#dfe7f1] dark:border-white/[0.08]">
              <td className={clsx(TD, 'text-left font-medium')} colSpan={(showMonth ? 1 : 0) + (showAccount ? 2 : 0) || 1}>
                Total
              </td>
              {COLUMNS.map((c) => (
                <td key={c.key} className={clsx(TD, 'text-right font-medium')}>
                  {c.key === 'connect_rate' ? `${totals.connect_rate}%` : fmt(totals[c.key])}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
