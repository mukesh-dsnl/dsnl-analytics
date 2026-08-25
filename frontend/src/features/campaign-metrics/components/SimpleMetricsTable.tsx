import { PercentagePill } from './PercentagePill';
import { useSortableRows } from '../useSortableRows';
import {
  SortableHeader,
  TableCard,
  TableStatus,
  TD_CLASS,
  TD_CLASS_RIGHT,
} from './TableChrome';
import type { CampaignMetricsRow } from '../api';

interface SimpleRow extends CampaignMetricsRow {
  label: string;
}

type SortKey = 'label' | keyof CampaignMetricsRow;

interface SimpleMetricsTableProps {
  /** What the first column is called — "Service Provider" or "Location". */
  columnLabel: string;
  rows: SimpleRow[] | undefined;
  isLoading: boolean;
  error: Error | null;
}

/**
 * The Service Provider Wise and Location Wise tables — identical shape, just
 * a different first column, so one component covers both rather than two
 * near-duplicates.
 */
export function SimpleMetricsTable({ columnLabel, rows, isLoading, error }: SimpleMetricsTableProps) {
  const { rows: sorted, sort, toggle } = useSortableRows<SimpleRow, SortKey>(rows, {
    key: 'total_size',
    direction: 'desc',
  });

  const isEmpty = !isLoading && !error && (sorted?.length ?? 0) === 0;

  const columns: { key: SortKey; label: string; align: 'left' | 'right' }[] = [
    { key: 'label', label: columnLabel, align: 'left' },
    { key: 'total_size', label: 'Total Size', align: 'right' },
    { key: 'connected_size', label: 'Connected Size', align: 'right' },
    { key: 'not_connected_size', label: 'Not Connected Size', align: 'right' },
    { key: 'connected_percentage', label: 'Connected %', align: 'right' },
  ];

  return (
    <TableCard>
      <TableStatus isLoading={isLoading} error={error} isEmpty={isEmpty} />
      {!isLoading && !error && !isEmpty && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800/60">
                {columns.map((column) => (
                  <SortableHeader
                    key={column.key}
                    label={column.label}
                    sortKey={column.key}
                    sort={sort}
                    onSort={toggle}
                    align={column.align}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted!.map((row) => (
                <tr
                  key={row.label}
                  className="border-b border-zinc-100 dark:border-zinc-800/40 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
                >
                  <td className={`${TD_CLASS} font-medium text-zinc-900 dark:text-white`}>{row.label}</td>
                  <td className={TD_CLASS_RIGHT}>{row.total_size.toLocaleString()}</td>
                  <td className={TD_CLASS_RIGHT}>{row.connected_size.toLocaleString()}</td>
                  <td className={TD_CLASS_RIGHT}>{row.not_connected_size.toLocaleString()}</td>
                  <td className={TD_CLASS_RIGHT}>
                    <PercentagePill value={row.connected_percentage} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TableCard>
  );
}
