import { useMemo } from 'react';
import clsx from 'clsx';

import { useHover } from '../../cdr-dashboard/components/attempt-analytics/tooltipContext';
import { TipBody } from '../../cdr-dashboard/components/attempt-analytics/HoverTooltip';
import { pct } from '../../cdr-dashboard/components/attempt-analytics/design';
import type { WeekdayHour } from '../api';
import { RAMP, WEEKDAYS, hourLabel, levels } from '../format';

export type HourMetric = 'campaigns' | 'dialed';

/**
 * Monday to Sunday down, campaign start hour across: when the platform (or
 * one account) is busiest. Colour by quintile, as the calendar.
 */
export function WeekHourHeatmap({ cells, metric }: { cells: WeekdayHour[]; metric: HourMetric }) {
  const { grid, total, levelOf, rowTotals } = useMemo(() => {
    const g = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ campaigns: 0, dialed: 0 })));
    for (const c of cells) g[c.weekday][c.hour] = { campaigns: c.campaigns, dialed: c.dialed };
    const values = g.flat().map((v) => v[metric]);
    return {
      grid: g,
      total: values.reduce((a, b) => a + b, 0),
      levelOf: levels(values),
      rowTotals: g.map((row) => row.reduce((a, v) => a + v[metric], 0)),
    };
  }, [cells, metric]);

  return (
    <div className="min-w-0 overflow-x-auto">
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
              {row.map((value, hour) => (
                <HourCell
                  key={hour}
                  weekday={weekday}
                  hour={hour}
                  value={value}
                  metric={metric}
                  total={total}
                  level={levelOf(value[metric])}
                />
              ))}
            </div>
            <span className="w-14 shrink-0 text-right text-[10px] tabular-nums text-[#7a899f] dark:text-zinc-500">
              {pct(rowTotals[weekday], total)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HourCell({
  weekday,
  hour,
  value,
  metric,
  total,
  level,
}: {
  weekday: number;
  hour: number;
  value: { campaigns: number; dialed: number };
  metric: HourMetric;
  total: number;
  level: number;
}) {
  const hover = useHover(() => (
    <TipBody
      eyebrow={`${WEEKDAYS[weekday]} · ${hourLabel(hour)}–${hourLabel((hour + 1) % 24)}`}
      title={metric === 'campaigns' ? 'Campaigns started' : 'Numbers dialed'}
      value={value[metric]}
      share={`${pct(value[metric], total)} of the week`}
      sections={[
        {
          title: 'In this hour',
          rows: [
            { label: 'Campaigns started', value: value.campaigns, share: '' },
            { label: 'Numbers dialed', value: value.dialed, share: '' },
          ],
        },
      ]}
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
