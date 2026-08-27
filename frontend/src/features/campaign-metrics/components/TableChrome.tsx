import type { ReactNode } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  Loader2,
} from 'lucide-react';
import clsx from 'clsx';
import type { SortState } from '../useSortableRows';
import { PAGE_SIZE } from '../usePagination';

/**
 * Shared shell every Campaign Metrics table renders inside — loading, error and
 * empty states, once.
 *
 * A flex column with `min-h-0`: that is what lets the rows scroll inside the
 * card while the header row, the tabs above and the pager below all stay put.
 * Without `min-h-0` a flex child refuses to shrink below its content, the card
 * grows to fit every row, and the page scrolls instead — taking the table's own
 * header off screen with it.
 */
export function TableCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col min-h-0 bg-white dark:bg-surface-dark border border-zinc-200 dark:border-zinc-800/60 rounded-md shadow-sm dark:shadow-lg overflow-hidden transition-colors duration-300">
      {children}
    </div>
  );
}

export function TableStatus({ isLoading, error, isEmpty }: { isLoading: boolean; error: Error | null; isEmpty: boolean }) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-start gap-3 px-5 py-6 text-sm text-red-600 dark:text-red-400">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <p className="break-words">{error.message}</p>
      </div>
    );
  }
  if (isEmpty) {
    return (
      <div className="px-5 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
        No calls for this day.
      </div>
    );
  }
  return null;
}

/**
 * Header cells stay put while the rows scroll under them.
 *
 * The bottom rule is an inset box-shadow rather than `border-b`: with
 * `border-collapse`, a border on a sticky cell is painted by the table and
 * scrolls away with it, leaving the pinned header sitting on the rows with no
 * separation. A shadow belongs to the cell and travels with it.
 */
export const TH_CLASS =
  'sticky top-0 z-20 bg-white dark:bg-surface-dark px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 ' +
  'shadow-[inset_0_-1px_0_theme(colors.zinc.200)] dark:shadow-[inset_0_-1px_0_theme(colors.zinc.800)]';
export const TH_CLASS_RIGHT = `${TH_CLASS} text-right`;
export const TD_CLASS = 'px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300 tabular-nums';
export const TD_CLASS_RIGHT = `${TD_CLASS} text-right`;

interface TablePagerProps {
  page: number;
  pageCount: number;
  total: number;
  onPage: (page: number) => void;
}

/**
 * The footer pager.
 *
 * Prev/next plus a stated position rather than a numbered page strip: these
 * tables run to a handful of pages at most, so a strip would be more chrome
 * than the navigation is worth.
 */
export function TablePager({ page, pageCount, total, onPage }: TablePagerProps) {
  const first = (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-zinc-200 dark:border-zinc-800/60">
      <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
        {first.toLocaleString()}–{last.toLocaleString()} of {total.toLocaleString()}
      </p>
      <div className="flex items-center gap-1.5">
        <PagerButton label="Previous page" onClick={() => onPage(page - 1)} disabled={page <= 1}>
          <ChevronLeft className="w-4 h-4" />
        </PagerButton>
        <span className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums px-1">
          {page} / {pageCount}
        </span>
        <PagerButton
          label="Next page"
          onClick={() => onPage(page + 1)}
          disabled={page >= pageCount}
        >
          <ChevronRight className="w-4 h-4" />
        </PagerButton>
      </div>
    </div>
  );
}

function PagerButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 disabled:opacity-40 disabled:pointer-events-none transition-colors"
    >
      {children}
    </button>
  );
}

interface SortableHeaderProps<K extends string> {
  label: string;
  sortKey: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
  align?: 'left' | 'right';
}

/**
 * A column header that sorts on click.
 *
 * The direction chevron only appears on the active column; every other header
 * shows a muted up/down glyph, so the whole row reads as sortable without four
 * arrows competing with the one that actually means something.
 */
export function SortableHeader<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  align = 'left',
}: SortableHeaderProps<K>) {
  const isActive = sort.key === sortKey;

  return (
    <th className={align === 'right' ? TH_CLASS_RIGHT : TH_CLASS} aria-sort={isActive ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={clsx(
          'group inline-flex items-center gap-1 uppercase tracking-wider hover:text-zinc-900 dark:hover:text-white transition-colors',
          align === 'right' && 'flex-row-reverse',
          isActive && 'text-zinc-900 dark:text-white',
        )}
      >
        {label}
        {isActive ? (
          sort.direction === 'asc' ? (
            <ChevronUp className="w-3 h-3 shrink-0" />
          ) : (
            <ChevronDown className="w-3 h-3 shrink-0" />
          )
        ) : (
          <ChevronsUpDown className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-50 transition-opacity" />
        )}
      </button>
    </th>
  );
}
