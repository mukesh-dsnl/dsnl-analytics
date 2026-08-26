import { useMemo, useState } from 'react';

/** Rows per page across every Campaign Metrics table. */
export const PAGE_SIZE = 50;

/**
 * Client-side paging for the Campaign Metrics tables.
 *
 * Paged here rather than server-side for the same reason sorting is: one day's
 * accounts, providers or locations are already in memory, so a round trip per
 * page would add latency and nothing else. It also keeps paging and sorting
 * consistent — the page is cut from the sorted list, so sorting reorders the
 * whole table rather than just the rows currently visible.
 */
export function usePagination<T>(rows: T[] | undefined) {
  const [page, setPage] = useState(1);

  const total = rows?.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Clamped during render rather than corrected in an effect. A filter or date
  // change can shorten the list under the page currently held, and resetting
  // that from an effect would render the empty page once before fixing it —
  // deriving it means the out-of-range page is simply never shown.
  const safePage = Math.min(page, pageCount);

  const pageRows = useMemo(() => {
    if (!rows) return undefined;
    const start = (safePage - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }, [rows, safePage]);

  return {
    pageRows,
    page: safePage,
    pageCount,
    total,
    setPage: (next: number) => setPage(Math.max(1, Math.min(next, pageCount))),
    /** Below one full page there is nothing to page through. */
    isPaged: total > PAGE_SIZE,
  };
}
