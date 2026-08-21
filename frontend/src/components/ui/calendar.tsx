import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import type { DayPickerProps } from 'react-day-picker';

import { cn } from '@/lib/utils';

export type CalendarProps = DayPickerProps;

/**
 * shadcn/ui Calendar over react-day-picker v10.
 *
 * v10 names its class slots off the `UI` enum ("months", "day_button",
 * "range_start", …) rather than v8's `rdp-*` classes, so the overrides below
 * are keyed to those names. Styling is written against this app's zinc/blue
 * ramp for the same reason the Button is — there is no shadcn CSS-variable
 * theme in this project to inherit from.
 */
function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  const dayBase =
    'relative h-9 w-9 p-0 text-center text-sm focus-within:relative focus-within:z-20';

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row gap-4',
        month: 'flex flex-col gap-4',
        month_caption: 'flex justify-center pt-1 relative items-center h-9',
        caption_label: 'text-sm font-semibold text-zinc-900 dark:text-white',
        nav: 'flex items-center gap-1 absolute inset-x-3 top-3 justify-between pointer-events-none',
        button_previous:
          'pointer-events-auto h-7 w-7 inline-flex items-center justify-center rounded-md border border-zinc-200 dark:border-zinc-800 ' +
          'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 disabled:opacity-30 disabled:pointer-events-none transition-colors',
        button_next:
          'pointer-events-auto h-7 w-7 inline-flex items-center justify-center rounded-md border border-zinc-200 dark:border-zinc-800 ' +
          'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 disabled:opacity-30 disabled:pointer-events-none transition-colors',
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'w-9 text-[11px] font-medium text-zinc-400 dark:text-zinc-500',
        week: 'flex w-full mt-1',
        day: dayBase,
        day_button:
          'h-9 w-9 rounded-md font-normal text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 ' +
          'transition-colors disabled:pointer-events-none aria-selected:font-medium',
        // Range ends carry the solid fill; the middle gets the subtle wash, so
        // the selected span reads as one continuous band.
        range_start:
          'rounded-l-md bg-blue-600 [&>button]:bg-blue-600 [&>button]:text-white [&>button:hover]:bg-blue-600',
        range_end:
          'rounded-r-md bg-blue-600 [&>button]:bg-blue-600 [&>button]:text-white [&>button:hover]:bg-blue-600',
        range_middle:
          'bg-blue-50 dark:bg-blue-600/15 [&>button]:text-blue-700 dark:[&>button]:text-blue-400 [&>button:hover]:bg-blue-100 dark:[&>button:hover]:bg-blue-600/25',
        selected: '',
        today: '[&>button]:ring-1 [&>button]:ring-inset [&>button]:ring-blue-400',
        outside: 'text-zinc-300 dark:text-zinc-700 [&>button]:text-zinc-300 dark:[&>button]:text-zinc-700',
        disabled: 'opacity-30 [&>button]:pointer-events-none',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...chevronProps }) =>
          orientation === 'left' ? (
            <ChevronLeft className="h-4 w-4" {...chevronProps} />
          ) : (
            <ChevronRight className="h-4 w-4" {...chevronProps} />
          ),
      }}
      {...props}
    />
  );
}

export { Calendar };
