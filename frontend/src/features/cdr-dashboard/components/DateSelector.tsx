import { CalendarRange } from 'lucide-react';
import type { CdrFilters, CdrStatus } from '../api';
import { clampDate } from '../dateRange';

const DATE_INPUT_CLASS =
  'bg-transparent text-sm text-zinc-900 dark:text-white outline-none w-[125px] ' +
  '[&::-webkit-calendar-picker-indicator]:dark:invert [&::-webkit-calendar-picker-indicator]:opacity-50';

interface DateSelectorProps {
  value: CdrFilters;
  onChange: (next: CdrFilters) => void;
  status: CdrStatus;
}

/**
 * The date range control, sized to sit on the same line as the service filters.
 *
 * It belongs beside them rather than inside the filter panel because it is
 * not an ordinary filter: it decides which daily export files the backend
 * opens, so it sets what the query costs as much as what it returns.
 */
export function DateSelector({ value, onChange, status }: DateSelectorProps) {
  const min = status.cdr.date_min;
  const max = status.cdr.date_max;

  /**
   * Moving one end drags the other along when the range would otherwise end
   * up backwards — picking a "from" after the current "to" means you want
   * that day, not an error message.
   */
  const setFrom = (raw: string) => {
    if (!raw) return;
    const from = clampDate(raw, min, max);
    onChange({ ...value, date_from: from, date_to: value.date_to < from ? from : value.date_to });
  };

  const setTo = (raw: string) => {
    if (!raw) return;
    const to = clampDate(raw, min, max);
    onChange({ ...value, date_to: to, date_from: value.date_from > to ? to : value.date_from });
  };

  return (
    <div className="flex items-center gap-2 px-3 h-[46px] rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#09090B] transition-colors duration-300">
      <CalendarRange className="w-4 h-4 shrink-0 text-zinc-400" />

      <label htmlFor="cdr-date-from" className="sr-only">
        From date
      </label>
      <input
        id="cdr-date-from"
        type="date"
        value={value.date_from}
        min={min}
        max={max}
        onChange={(e) => setFrom(e.target.value)}
        className={DATE_INPUT_CLASS}
      />
      <span className="text-zinc-300 dark:text-zinc-600 select-none">–</span>
      <label htmlFor="cdr-date-to" className="sr-only">
        To date
      </label>
      <input
        id="cdr-date-to"
        type="date"
        value={value.date_to}
        min={min}
        max={max}
        onChange={(e) => setTo(e.target.value)}
        className={DATE_INPUT_CLASS}
      />
    </div>
  );
}
