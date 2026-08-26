import { Suspense, lazy } from 'react';
import { CalendarIcon, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { CdrStatus } from '../../cdr-dashboard/api';

// Loaded on first open, same reasoning as ../../cdr-dashboard/components/DateSelector.tsx:
// react-day-picker only needs to exist once the popover has actually opened.
const Calendar = lazy(() =>
  import('@/components/ui/calendar').then((m) => ({ default: m.Calendar })),
);

interface SingleDateSelectorProps {
  /** Inclusive ISO `YYYY-MM-DD`. */
  date: string;
  onChange: (date: string) => void;
  status: CdrStatus;
  variant?: 'brand' | 'outline';
}

const toDate = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const pad = (n: number) => String(n).padStart(2, '0');

const toIso = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const toDisplay = (date: Date): string =>
  date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });

/**
 * The Campaign Metrics header date control — the same shadcn Calendar as the
 * analytics date range, restricted to `mode="single"` instead of `"range"`.
 *
 * The range picker's `classNames.selected` is deliberately blank in
 * components/ui/calendar.tsx, because in range mode every day between (and
 * including) the two endpoints also carries the `selected` modifier — giving
 * it real styling there would paint the whole span solid instead of just its
 * ends. A single-date picker has no span, so it's safe to style `selected`
 * here, passed as a classNames override on this one usage rather than
 * touching the shared component and risking the range picker's look.
 */
export function SingleDateSelector({ date, onChange, status, variant = 'outline' }: SingleDateSelectorProps) {
  const min = status.cdr.date_min;
  const max = status.cdr.date_max;

  const handleSelect = (next: Date | undefined) => {
    if (!next) return;
    onChange(toIso(next));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={variant}
          size="sm"
          id="campaign-date"
          // h-10 overrides the size variant's h-9 (cn is twMerge, so the later
          // utility wins) to match the controls sharing this header row.
          //
          // The open state wears the same blue ring the inputs show on focus.
          // Keyed off Radix's data-state rather than :focus-visible, which only
          // fires for keyboard focus — clicking the trigger would otherwise
          // leave it unhighlighted while its calendar is open.
          className="h-10 justify-start px-3 font-normal
                     data-[state=open]:ring-2 data-[state=open]:ring-blue-500 data-[state=open]:border-transparent"
        >
          <CalendarIcon className={variant === 'brand' ? 'text-white/70' : 'text-zinc-400'} />
          {toDisplay(toDate(date))}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Suspense
          fallback={
            <div className="flex items-center justify-center w-[280px] h-[336px]">
              <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
            </div>
          }
        >
          <Calendar
            mode="single"
            defaultMonth={toDate(date)}
            selected={toDate(date)}
            onSelect={handleSelect}
            numberOfMonths={1}
            startMonth={min ? toDate(min) : undefined}
            endMonth={max ? toDate(max) : undefined}
            disabled={[
              ...(min ? [{ before: toDate(min) }] : []),
              ...(max ? [{ after: toDate(max) }] : []),
            ]}
            classNames={{
              selected:
                'rounded-md [&>button]:bg-blue-600 [&>button]:text-white [&>button:hover]:bg-blue-600',
            }}
          />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}
