import type { LucideIcon } from 'lucide-react';
import { ConnectedBar } from './ConnectedBar';
import type { SortState } from '../useSortableRows';
import { usePagination } from '../usePagination';
import { SortableHeader, TableCard, TablePager, TableStatus } from './TableChrome';
import type { CampaignMetricsRow } from '../api';

export interface SimpleRow extends CampaignMetricsRow {
  label: string;
}

export type SimpleSortKey = 'label' | keyof CampaignMetricsRow;

interface SimpleMetricsTableProps {
  /** What the first column is called — "Service Provider" or "Location". */
  columnLabel: string;
  /** Badge glyph for the first cell, matching the active view. */
  icon: LucideIcon;
  rows: SimpleRow[] | undefined;
  isLoading: boolean;
  error: Error | null;
  sort: SortState<SimpleSortKey>;
  onSort: (key: SimpleSortKey) => void;
}

const NUM = 'px-4 py-3 text-right text-sm tabular-nums font-semibold text-zinc-900 dark:text-white';

/**
 * The Service Provider Wise and Location Wise tables — identical shape, just
 * a different first column, so one component covers both rather than two
 * near-duplicates.
 */
export function SimpleMetricsTable({
  columnLabel,
  icon: Icon,
  rows,
  isLoading,
  error,
  sort,
  onSort,
}: SimpleMetricsTableProps) {
  const { pageRows, page, pageCount, total, setPage, isPaged } = usePagination(rows);

  const isEmpty = !isLoading && !error && (rows?.length ?? 0) === 0;

  const columns: { key: SimpleSortKey; label: string; align: 'left' | 'right' }[] = [
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
                    onSort={onSort}
                    align={column.align}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows!.map((row) => (
                <tr
                  key={row.label}
                  className="border-b border-zinc-100 dark:border-zinc-800/40 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
                >
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 shrink-0"
                      >
                        <Icon className="w-3.5 h-3.5" />
                      </span>
                      <span className="text-sm font-semibold text-zinc-900 dark:text-white">
                        {row.label}
                      </span>
                    </span>
                  </td>
                  <td className={NUM}>{row.total_size.toLocaleString()}</td>
                  <td className={NUM}>{row.connected_size.toLocaleString()}</td>
                  <td className={NUM}>{row.not_connected_size.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <ConnectedBar value={row.connected_percentage} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!isLoading && !error && !isEmpty && isPaged && (
        <TablePager page={page} pageCount={pageCount} total={total} onPage={setPage} />
      )}
    </TableCard>
  );
}
