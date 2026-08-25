import { useMemo, useState } from 'react';

export type SortDirection = 'asc' | 'desc';

export interface SortState<K extends string> {
  key: K;
  direction: SortDirection;
}

/**
 * Client-side sorting for the Campaign Metrics tables.
 *
 * Sorting here rather than server-side is deliberate: these tables are one
 * day's worth of accounts, providers or locations — tens of rows, already all
 * in memory — so a round trip per column click would add latency without
 * adding anything else.
 *
 * Numeric columns compare as numbers and text columns via localeCompare with
 * `numeric`, so an account list reads 17, 193, 109775 rather than the
 * lexicographic 109775, 17, 193.
 */
export function useSortableRows<T, K extends string & keyof T>(
  rows: T[] | undefined,
  initial: SortState<K>,
) {
  const [sort, setSort] = useState<SortState<K>>(initial);

  const sorted = useMemo(() => {
    if (!rows) return undefined;
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = a[sort.key];
      const right = b[sort.key];
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * factor;
      return (
        String(left).localeCompare(String(right), undefined, { numeric: true }) * factor
      );
    });
  }, [rows, sort]);

  /** Clicking the active column flips it; clicking another switches to it, descending first. */
  const toggle = (key: K) =>
    setSort((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'desc' },
    );

  return { rows: sorted, sort, toggle };
}
