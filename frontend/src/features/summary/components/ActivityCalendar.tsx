import { useMemo } from 'react';
import type { ReactNode } from 'react';
import clsx from 'clsx';

import { useHover } from '../../cdr-dashboard/components/attempt-analytics/tooltipContext';
import { TipBody } from '../../cdr-dashboard/components/attempt-analytics/HoverTooltip';
import { fmt, pct } from '../../cdr-dashboard/components/attempt-analytics/design';
import type { DayTotals } from '../api';
import { RAMP, addDays, dayLabel, isoDay, levels, parseDay, weekdayDay } from '../format';

export type CalendarMetric = 'dialed' | 'minutes';

const METRIC_LABEL: Record<CalendarMetric, string> = {
  dialed: 'Numbers dialed',
  minutes: 'Connected minutes',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Cell {
  iso: string;
  /** Before the table's first day: unknown, not zero. */
  beforeData: boolean;
  /** After `asOf`: not drawn. */
  future: boolean;
  day?: DayTotals;
}

/**
 * Twelve months of days, one square each, GitHub-style: a column per week,
 * Monday at the top. The colour is the day's numbers dialed (or connected
 * minutes), by quintile; days before the table's first load are drawn
 * hatched, since "no data" and "no campaigns" are different things.
 */
export function ActivityCalendar({
  days,
  asOf,
  firstDate,
  metric,
  onDay,
}: {
  days: DayTotals[];
  asOf: string;
  firstDate: string;
  metric: CalendarMetric;
  /** Clicking a day — opens that day's campaigns. */
  onDay?: (iso: string) => void;
}) {
  const { weeks, monthMarks, levelOf } = useMemo(() => {
    const byDate = new Map(days.map((d) => [d.date, d]));
    const end = parseDay(asOf);
    const start = addDays(end, -364);
    // Back to the Monday of the first week, so every column is a whole week.
    const firstMonday = addDays(start, -((start.getDay() + 6) % 7));
    const columns: Cell[][] = [];
    const marks: { column: number; label: string }[] = [];
    for (let cursor = firstMonday, column = 0; cursor <= end; column += 1) {
      const week: Cell[] = [];
      for (let row = 0; row < 7; row += 1, cursor = addDays(cursor, 1)) {
        const iso = isoDay(cursor);
        week.push({ iso, beforeData: iso < firstDate, future: cursor > end || cursor < start, day: byDate.get(iso) });
        // A month's label sits over the week holding its 1st.
        if (cursor.getDate() === 1 && cursor >= start && cursor <= end) marks.push({ column, label: MONTHS[cursor.getMonth()] });
      }
      columns.push(week);
    }
    return { weeks: columns, monthMarks: marks, levelOf: levels(days.map((d) => d[metric])) };
  }, [days, asOf, firstDate, metric]);

  return (
    <div className="min-w-0">
      {/* Month names, each over the week its 1st falls in. */}
      <div className="ml-8 grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
        {weeks.map((_, column) => {
          const mark = monthMarks.find((m) => m.column === column);
          return (
            <span key={column} className="h-4 overflow-visible whitespace-nowrap text-[10px] text-[#7a899f] dark:text-zinc-500">
              {mark?.label}
            </span>
          );
        })}
      </div>
      <div className="mt-1 flex gap-[3px]">
        <div className="grid w-8 shrink-0 grid-rows-7 gap-[3px] text-[10px] text-[#7a899f] dark:text-zinc-500">
          {['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].map((label, i) => (
            <span key={i} className="flex items-center leading-none">
              {label}
            </span>
          ))}
        </div>
        <div className="grid min-w-0 flex-1 gap-[3px]" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
          {weeks.map((week, column) => (
            <div key={column} className="grid grid-rows-7 gap-[3px]">
              {week.map((cell) => (
                <DayCell key={cell.iso} cell={cell} metric={metric} level={cell.day ? levelOf(cell.day[metric]) : -1} onDay={onDay} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <Legend firstDate={firstDate} />
    </div>
  );
}

function DayCell({
  cell,
  metric,
  level,
  onDay,
}: {
  cell: Cell;
  metric: CalendarMetric;
  level: number;
  onDay?: (iso: string) => void;
}) {
  const hover = useHover(() => <DayTip cell={cell} metric={metric} />);
  if (cell.future) return <span aria-hidden className="aspect-square" />;
  const style = level >= 0 ? { background: RAMP[level] } : undefined;
  const className = clsx(
    'aspect-square w-full rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-[#42b9e9]',
    cell.beforeData
      ? 'bg-[repeating-linear-gradient(135deg,#eef2f7_0_2px,transparent_2px_4px)] dark:bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.05)_0_2px,transparent_2px_4px)]'
      : level < 0 && 'bg-[#edf1f6] dark:bg-white/[0.06]',
    cell.day && onDay && 'cursor-pointer hover:ring-1 hover:ring-[#2f6fa8] dark:hover:ring-sky-300',
  );
  return cell.day && onDay ? (
    <button
      type="button"
      {...hover}
      onClick={() => onDay(cell.iso)}
      aria-label={`${dayLabel(cell.iso)}: ${fmt(cell.day[metric])}`}
      className={className}
      style={style}
    />
  ) : (
    <span {...hover} className={className} style={style} />
  );
}

function DayTip({ cell, metric }: { cell: Cell; metric: CalendarMetric }) {
  const eyebrow = weekdayDay(cell.iso);
  if (cell.beforeData) return <Note eyebrow={eyebrow}>Before the table's first load — no data.</Note>;
  const day = cell.day;
  if (!day) return <Note eyebrow={eyebrow}>No campaigns.</Note>;
  return (
    <TipBody
      eyebrow={eyebrow}
      title={METRIC_LABEL[metric]}
      value={day[metric]}
      share={`${fmt(day.campaigns)} campaign${day.campaigns === 1 ? '' : 's'}${day.accounts ? ` · ${day.accounts} account${day.accounts === 1 ? '' : 's'}` : ''}`}
      sections={[
        {
          title: 'That day',
          base: day.dialed,
          rows: [
            { label: 'Numbers dialed', value: day.dialed, share: '' },
            { label: 'Connected', value: day.connected, share: pct(day.connected, day.dialed) },
            { label: 'Connected minutes', value: day.minutes, share: '' },
            { label: 'DND', value: day.dnd, share: pct(day.dnd, day.phone_numbers) },
          ],
        },
      ]}
    />
  );
}

function Note({ eyebrow, children }: { eyebrow: string; children: ReactNode }) {
  return (
    <>
      <div className="text-[9px] uppercase tracking-[1px] text-[#8398b9]">{eyebrow}</div>
      <div className="mt-1 text-[12px] text-[#c5cee0]">{children}</div>
    </>
  );
}

function Legend({ firstDate }: { firstDate: string }) {
  return (
    <div className="mt-3 ml-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-[10px] text-[#7a899f] dark:text-zinc-500">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[3px] bg-[repeating-linear-gradient(135deg,#dfe6ef_0_2px,transparent_2px_4px)] dark:bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.12)_0_2px,transparent_2px_4px)]" />
        No data before {dayLabel(firstDate)}
      </span>
      <span className="inline-flex items-center gap-1">
        Less
        <span className="h-2.5 w-2.5 rounded-[3px] bg-[#edf1f6] dark:bg-white/[0.06]" />
        {RAMP.map((color) => (
          <span key={color} className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />
        ))}
        More
      </span>
    </div>
  );
}
