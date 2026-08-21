import { Suspense, lazy } from 'react';
import { CalendarIcon, Loader2 } from 'lucide-react';
import type { DateRange } from 'react-day-picker';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { CdrStatus } from '../api';

/**
 * The grid itself is loaded on first open, not with the app.
 *
 * This control sits in the header, so it mounts on every route — but the
 * calendar only ever renders inside the popover. Importing it eagerly would
 * put react-day-picker (~55kB gzipped) in the initial bundle to render a
 * button. Radix keeps the content unmounted while closed, so the import fires
 * on the first click and is cached from then on.
 *
 * Only the type import above stays static — types erase at build time.
 */
const Calendar = lazy(() =>
  import('@/components/ui/calendar').then((m) => ({ default: m.Calendar })),
);

interface DateSelectorProps {
  /** Inclusive ISO `YYYY-MM-DD` bounds. */
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  status: CdrStatus;
  /** `brand` for the blue header band; `outline` on a normal surface. */
  variant?: 'brand' | 'outline';
}

/**
 * ISO `YYYY-MM-DD` ⇄ Date, both pinned to local midnight.
 *
 * Deliberately not `new Date(iso)`, which parses a bare date as UTC and lands
 * on the previous day for anyone west of Greenwich — the picker would then
 * highlight a different day than the one the filter holds.
 */
const toDate = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Built from the local parts, not toISOString() — that converts to UTC and can shift the day. */
const toIso = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** "Aug 01, 2026". Intl rather than date-fns, which would otherwise be the one
 *  heavy import keeping this header control out of a lazy chunk. */
const toDisplay = (date: Date): string =>
  date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });

/**
 * The analytics date range control, living in the header.
 *
 * It sits there rather than on the page because it is not an ordinary filter:
 * it decides which daily export files the backend opens, so it applies to
 * every analytics page and sets what a query costs as much as what it returns.
 * The lake only holds the days between status.cdr.date_min and date_max, so
 * everything outside that is disabled rather than clamped after the fact.
 */
export function DateSelector({ from, to, onChange, status, variant = 'outline' }: DateSelectorProps) {
  const min = status.cdr.date_min;
  const max = status.cdr.date_max;

  const selected: DateRange = { from: toDate(from), to: toDate(to) };

  /**
   * react-day-picker reports the in-progress range too — the first click
   * gives `from` with no `to`. Committing `to = from` there keeps the filter
   * a valid one-day range while the second click is still pending, rather
   * than emitting a half-open range the backend would reject.
   */
  const handleSelect = (range: DateRange | undefined) => {
    if (!range?.from) return;
    const nextFrom = toIso(range.from);
    onChange(nextFrom, range.to ? toIso(range.to) : nextFrom);
  };

  const fromText = toDisplay(toDate(from));
  const label = from === to ? fromText : `${fromText} - ${toDisplay(toDate(to))}`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={variant}
          size="sm"
          id="cdr-date-range"
          className="justify-start px-3 font-normal"
        >
          <CalendarIcon className={variant === 'brand' ? 'text-white/70' : 'text-zinc-400'} />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Suspense
          fallback={
            <div className="flex items-center justify-center w-[560px] max-w-[80vw] h-[336px]">
              <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
            </div>
          }
        >
          <Calendar
            mode="range"
            defaultMonth={toDate(from)}
            selected={selected}
            onSelect={handleSelect}
            numberOfMonths={2}
            startMonth={min ? toDate(min) : undefined}
            endMonth={max ? toDate(max) : undefined}
            disabled={[
              ...(min ? [{ before: toDate(min) }] : []),
              ...(max ? [{ after: toDate(max) }] : []),
            ]}
          />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}
