import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cdrApi } from './api';
import type { CdrStatus } from './api';
import { useDateRangeStore } from '../../store';

export const CDR_STATUS_KEY = ['cdr-status'] as const;

/**
 * What the parquet lake currently holds.
 *
 * There is no ingest to wait on, so this is a plain read rather than a poll —
 * but it isn't static either: a new daily export can land while the page is
 * open, and it decides which dates the picker will allow. A minute of staleness
 * is a fair trade against re-listing a network share on every render.
 */
export function useCdrStatus() {
  return useQuery<CdrStatus>({
    queryKey: CDR_STATUS_KEY,
    queryFn: cdrApi.getStatus,
    staleTime: 60_000,
  });
}

/**
 * The shared analytics date range, seeded from the lake's own coverage.
 *
 * The store starts null because only the backend knows which days exist; the
 * first status answer fills it in with the day the backend nominates. Seeding
 * once (rather than on every mount) is what lets the range survive navigation
 * between the service pages.
 */
export function useDateRange(status: CdrStatus) {
  const { dateFrom, dateTo, setRange } = useDateRangeStore();

  const fallback =
    status.default_date ?? status.cdr.date_max ?? new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!dateFrom || !dateTo) setRange(fallback, fallback);
  }, [dateFrom, dateTo, fallback, setRange]);

  return { from: dateFrom ?? fallback, to: dateTo ?? fallback, setRange };
}

/** Hold `value` back until it has stopped changing for `delay` ms. */
export function useDebouncedValue<T>(value: T, delay = 400): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
