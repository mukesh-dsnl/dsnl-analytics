import type { ReactNode } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, ChevronsUpDown, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import type { SortState } from '../useSortableRows';

/** Shared shell every Campaign Metrics table renders inside — loading, error and empty states, once. */
export function TableCard({ children }: { children: ReactNode }) {
  return (
    <div className="bg-white dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800/60 rounded-md shadow-sm dark:shadow-lg overflow-hidden transition-colors duration-300">
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

export const TH_CLASS =
  'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400';
export const TH_CLASS_RIGHT = `${TH_CLASS} text-right`;
export const TD_CLASS = 'px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300 tabular-nums';
export const TD_CLASS_RIGHT = `${TD_CLASS} text-right`;

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
