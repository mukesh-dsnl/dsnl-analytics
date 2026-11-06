import { useMemo } from 'react';
import clsx from 'clsx';

import { useHover } from '../../cdr-dashboard/components/attempt-analytics/tooltipContext';
import { TipBody } from '../../cdr-dashboard/components/attempt-analytics/HoverTooltip';
import { pct } from '../../cdr-dashboard/components/attempt-analytics/design';
import { RAMP, WEEKDAYS, hourLabel, levels } from '../format';
import { HScroll } from './HScroll';

interface HourCell {
  /** 0 = Monday … 6 = Sunday. */
  weekday: number;
  hour: number;
}

/**
 * Monday to Sunday down, start hour across: when the platform (or one
 * account) is busiest. Coloured by `metric`, by quintile, as the calendar;
 * the readout lists every one of `metrics` for the hour.
 */
export function WeekHourHeatmap<T extends HourCell, K extends keyof T & string>({
  cells,
  metric,
  metrics,
}: {
  cells: T[];
  metric: K;
  metrics: { id: K; label: string }[];
}) {
  const { grid, total, levelOf, rowTotals } = useMemo(() => {
    const g: (T | undefined)[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => undefined));
    for (const c of cells) g[c.weekday][c.hour] = c;
    const values = g.flat().map((c) => read(c, metric));
    return {
      grid: g,
      total: values.reduce((a, b) => a + b, 0),
      levelOf: levels(values),
      rowTotals: g.map((row) => row.reduce((a, c) => a + read(c, metric), 0)),
    };
  }, [cells, metric]);
  const label = metrics.find((m) => m.id === metric)?.label ?? metric;

  return (
    <HScroll>
      <div className="min-w-[460px]">
        <div className="ml-[43px] mr-[59px] grid gap-[3px]" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="text-[10px] text-[#7a899f] dark:text-zinc-500">
              {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
            </span>
          ))}
        </div>
        {grid.map((row, weekday) => (
          <div key={weekday} className="mt-[3px] flex items-center gap-[3px]">
            <span className="w-10 shrink-0 text-[10px] text-[#7a899f] dark:text-zinc-500">{WEEKDAYS[weekday].slice(0, 3)}</span>
            <div className="grid flex-1 gap-[3px]" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
              {row.map((cell, hour) => (
                <Square
                  key={hour}
                  weekday={weekday}
                  hour={hour}
                  value={read(cell, metric)}
                  label={label}
                  total={total}
                  level={levelOf(read(cell, metric))}
                  rows={metrics.map((m) => ({ label: m.label, value: read(cell, m.id), share: '' }))}
                />
              ))}
            </div>
            <span className="w-14 shrink-0 text-right text-[10px] tabular-nums text-[#7a899f] dark:text-zinc-500">
              {pct(rowTotals[weekday], total)}
            </span>
          </div>
        ))}
      </div>
    </HScroll>
  );
}

const read = <T,>(cell: T | undefined, key: keyof T) => (cell ? Number(cell[key]) || 0 : 0);

function Square({
  weekday,
  hour,
  value,
  label,
  total,
  level,
  rows,
}: {
  weekday: number;
  hour: number;
  value: number;
  label: string;
  total: number;
  level: number;
  rows: { label: string; value: number; share: string }[];
}) {
  const hover = useHover(() => (
    <TipBody
      eyebrow={`${WEEKDAYS[weekday]} · ${hourLabel(hour)}–${hourLabel((hour + 1) % 24)}`}
      title={label}
      value={value}
      share={`${pct(value, total)} of the week`}
      sections={[{ title: 'In this hour', rows }]}
    />
  ));
  return (
    <span
      {...hover}
      className={clsx(
        'h-6 rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-[#42b9e9]',
        level < 0 && 'bg-[#edf1f6] dark:bg-white/[0.06]',
      )}
      style={level >= 0 ? { background: RAMP[level] } : undefined}
    />
  );
}
