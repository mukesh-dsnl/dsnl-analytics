import { useEffect } from 'react';
import { useCampaignDateStore } from '../../store';
import type { CdrStatus } from '../cdr-dashboard/api';

// The lake status query is shared verbatim with the CDR dashboard — it's the
// same read-only "what does the lake hold" answer either module needs to seed
// its date picker from, so there is no reason for Campaign Metrics to ask for
// it a second, differently-named way.
export { useCdrStatus } from '../cdr-dashboard/hooks';

/**
 * The Campaign Metrics single-day selection, seeded from the lake's own
 * coverage — mirrors ../cdr-dashboard/hooks.ts's useDateRange, but for one
 * date rather than a range, and backed by its own store so the two modules'
 * header controls never collide.
 */
export function useCampaignDate(status: CdrStatus) {
  const { date, setDate } = useCampaignDateStore();

  const fallback =
    status.default_date ?? status.cdr.date_max ?? new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!date) setDate(fallback);
  }, [date, fallback, setDate]);

  return { date: date ?? fallback, setDate };
}
