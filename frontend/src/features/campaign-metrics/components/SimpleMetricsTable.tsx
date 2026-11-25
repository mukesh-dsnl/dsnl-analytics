import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { ConnectedBar } from './ConnectedBar';
import type { SortState } from '../useSortableRows';
import { usePagination } from '../usePagination';
import { SortableHeader, TableCard, TablePager, TableStatus, TOTAL_CELL } from './TableChrome';
import type { CampaignMetricsRow } from '../api';
import { SMALL_GROUP } from '../labels';
import type { MeasureLabels } from '../labels';

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
  /** The measure columns' names, in the service's own words. */
  labels: MeasureLabels;
  /**
   * The day counted once, from the backend. Left out while a search narrows
   * the rows — the Total row then adds up what is shown.
   */
  total?: CampaignMetricsRow;
  /** How many times a number appears in a second row (see the note under the table). */
  overlap?: number;
}

const NUM = 'px-4 py-3 text-right text-sm tabular-nums font-semibold text-zinc-900 dark:text-white';

const sumOf = (rows: SimpleRow[], key: 'total_size' | 'connected_size' | 'not_connected_size') =>
  rows.reduce((total, row) => total + row[key], 0);

/**
 * The Service Provider Wise and Location Wise tables — identical shape, just
 * a different first column, so one component covers both rather than two
 * near-duplicates.
 *
 * The Total row is the day counted once, not the rows added up: a number
 * tried through two providers is in both rows, so the rows can add up to more
 * than the day holds. When they do, the note under the table says by how much.
 */
export function SimpleMetricsTable({
  columnLabel,
  icon: Icon,
  rows,
  isLoading,
  error,
  sort,
  onSort,
  labels,
  total,
  overlap = 0,
}: SimpleMetricsTableProps) {
  const { pageRows, page, pageCount, total: rowCount, setPage, isPaged } = usePagination(rows);

  const isEmpty = !isLoading && !error && (rows?.length ?? 0) === 0;

  const columns: { key: SimpleSortKey; label: string; align: 'left' | 'right'; title?: string }[] = [
    { key: 'label', label: columnLabel, align: 'left' },
    { key: 'total_size', label: labels.total, align: 'right' },
    { key: 'connected_size', label: labels.connected, align: 'right' },
    { key: 'not_connected_size', label: labels.notConnected, align: 'right' },
    { key: 'connected_percentage', label: labels.percent, align: 'right', title: labels.percentNote },
  ];

  // Counted once by the backend when it sent a total; otherwise the shown rows added up.
  const shown = rows ?? [];
  const footer: CampaignMetricsRow = total ?? {
    total_size: sumOf(shown, 'total_size'),
    connected_size: sumOf(shown, 'connected_size'),
    not_connected_size: sumOf(shown, 'not_connected_size'),
    connected_percentage: sumOf(shown, 'total_size')
      ? (sumOf(shown, 'connected_size') / sumOf(shown, 'total_size')) * 100
      : 0,
  };
  const rowsSum = sumOf(shown, 'total_size');
  const group = columnLabel.toLowerCase();

  return (
    <TableCard>
      <TableStatus isLoading={isLoading} error={error} isEmpty={isEmpty} />
      {!isLoading && !error && !isEmpty && (
        // The only scrolling element: rows move under a pinned header rather
        // than the whole card sliding up the page.
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {columns.map((column) => (
                  <SortableHeader
                    key={column.key}
                    label={column.label}
                    sortKey={column.key}
                    sort={sort}
                    onSort={onSort}
                    align={column.align}
                    title={column.title}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows!.map((row) => (
                <tr
                  key={row.label}
                  className="border-b border-[#eef2f8] dark:border-zinc-800/40 last:border-0 hover:bg-[#f4f8fd] dark:hover:bg-white/[0.03] transition-colors"
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
                    <ConnectedBar value={row.connected_percentage} muted={row.total_size < SMALL_GROUP} unit={labels.unit} />
                  </td>
                </tr>
              ))}
            </tbody>
            {shown.length > 1 && (
              <tfoot>
                <tr>
                  <td className={clsx(TOTAL_CELL, 'px-4 py-3 text-sm font-semibold text-zinc-900 dark:text-white')}>
                    Total
                    {total && overlap > 0 && (
                      <span className="font-normal text-zinc-500 dark:text-zinc-400"> · each of the {labels.unit} counted once</span>
                    )}
                  </td>
                  <td className={clsx(TOTAL_CELL, NUM)}>{footer.total_size.toLocaleString()}</td>
                  <td className={clsx(TOTAL_CELL, NUM)}>{footer.connected_size.toLocaleString()}</td>
                  <td className={clsx(TOTAL_CELL, NUM)}>{footer.not_connected_size.toLocaleString()}</td>
                  <td className={clsx(TOTAL_CELL, 'px-4 py-3')}>
                    <ConnectedBar value={footer.connected_percentage} />
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {!isLoading && !error && !isEmpty && total && overlap > 0 && (
        <p className="shrink-0 border-t border-[#e6eef8] px-4 py-2.5 text-xs leading-5 text-zinc-600 dark:border-zinc-800/60 dark:text-zinc-400">
          <strong className="font-semibold text-zinc-800 dark:text-zinc-200">
            {overlap.toLocaleString()} of the {labels.unit}
          </strong>{' '}
          {overlap === 1 ? 'was' : 'were'} tried on more than one {group}, so {overlap === 1 ? 'it is' : 'they are'} in
          each {group}&rsquo;s row. The rows add up to {rowsSum.toLocaleString()}; the Total counts each one once,{' '}
          {footer.total_size.toLocaleString()}.
        </p>
      )}
      {!isLoading && !error && !isEmpty && isPaged && (
        <TablePager page={page} pageCount={pageCount} total={rowCount} onPage={setPage} />
      )}
    </TableCard>
  );
}
