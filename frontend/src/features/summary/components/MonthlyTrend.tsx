import type { ReactNode } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TriangleAlert, TrendingUp } from 'lucide-react';

import { COLORS, compact } from '../../cdr-dashboard/components/attempt-analytics/design';
import { monthLabel } from '../format';
import { HScroll } from './HScroll';

const AXIS = { fontSize: 11, fill: '#8a99ad' };

interface Series<K> {
  key: K;
  label: string;
  color?: string;
}

/**
 * One bar per month (optional) with percentage lines over it, on a right
 * axis of round quarters. What the bar and lines are is the caller's: the
 * Voicedrop summary draws minutes and connect rate / DND %, the Conference
 * summary attended minutes and connect rate / empty rooms.
 */
export function MonthlyTrend<T extends { month: string }, K extends keyof T & string>({
  months,
  bar,
  lines,
  tipRows,
  note,
}: {
  months: T[];
  bar?: Series<K>;
  /** Percentages, 0–100. */
  lines: Series<K>[];
  tipRows: (month: T) => [string, string][];
  note?: ReactNode;
}) {
  const data = months.map((m) => ({ ...m, label: monthLabel(m.month, true) }));
  // A round top for the rate axis, in quarters, so its ticks read evenly.
  const highest = Math.max(0, ...months.flatMap((m) => lines.map((l) => Number(m[l.key]) || 0)));
  const top = Math.min(100, Math.max(20, Math.ceil((highest + 2) / 20) * 20));
  const rateTicks = [0, top / 4, top / 2, (top * 3) / 4, top];
  const lineColor = (i: number, series: Series<K>) => series.color ?? (i === 0 ? (bar ? COLORS.navy : COLORS.blue) : '#ee8a3c');

  return (
    <div className="min-w-0">
      {note}
      {/* Room for every month at a readable width: once there are more than
          fit, the chart scrolls sideways, opening on the latest. */}
      <HScroll startAtEnd>
      <div className="h-[260px]" style={{ minWidth: `max(100%, ${months.length * 72}px)` }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="#8a99ad" strokeOpacity={0.15} />
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
            {bar && <YAxis yAxisId="left" tick={AXIS} axisLine={false} tickLine={false} width={48} tickFormatter={compact} />}
            <YAxis
              yAxisId="right"
              orientation={bar ? 'right' : 'left'}
              tick={AXIS}
              axisLine={false}
              tickLine={false}
              width={40}
              unit="%"
              domain={[0, top]}
              ticks={rateTicks}
            />
            <Tooltip content={<MonthTip tipRows={tipRows} />} cursor={{ fill: '#8a99ad', fillOpacity: 0.08 }} />
            {bar && (
              <Bar yAxisId="left" dataKey={bar.key} name={bar.label} fill={bar.color ?? COLORS.blue} radius={[4, 4, 0, 0]} maxBarSize={42} />
            )}
            {lines.map((series, i) => (
              <Line
                key={series.key}
                yAxisId="right"
                dataKey={series.key}
                name={series.label}
                stroke={lineColor(i, series)}
                strokeWidth={2}
                dot={{ r: 3 }}
                type="monotone"
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      </HScroll>
      <div className="mt-2 flex items-center justify-center gap-5 text-[11px] text-[#6a7d96] dark:text-zinc-400">
        {bar && <Key color={bar.color ?? COLORS.blue} label={bar.label} square />}
        {lines.map((series, i) => (
          <Key key={series.key} color={lineColor(i, series)} label={series.label} />
        ))}
      </div>
    </div>
  );
}

function Key({ color, label, square }: { color: string; label: string; square?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={square ? 'h-2.5 w-2.5 rounded-[3px]' : 'h-0.5 w-3.5 rounded-full'} style={{ background: color }} />
      {label}
    </span>
  );
}

function MonthTip<T extends { month: string }>({
  active,
  payload,
  tipRows,
}: {
  active?: boolean;
  payload?: { payload: T }[];
  tipRows: (month: T) => [string, string][];
}) {
  const month = payload?.[0]?.payload;
  if (!active || !month) return null;
  return (
    <div className="vd-design min-w-[220px] rounded-[10px] border border-white/[0.08] bg-[#1f2b45f7] px-3.5 py-3 text-white shadow-[0_12px_35px_#15253d2d]">
      <div className="text-[9px] uppercase tracking-[1px] text-[#8398b9]">{monthLabel(month.month)}</div>
      <div className="mt-1.5 space-y-[3px]">
        {tipRows(month).map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 text-[11px] text-[#c5cee0]">
            <span>{label}</span>
            <span className="tabular-nums text-[#e7eefa]">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A move worth raising: over the last three months, by at least `by` points
 * from first to last — or month after month in the same direction.
 */
function moved(values: number[], direction: 1 | -1, by: number): boolean {
  if (values.length < 2) return false;
  const last = values.slice(-3);
  const total = (last[last.length - 1] - last[0]) * direction;
  const steady = last.length === 3 && last.every((v, i) => i === 0 || (v - last[i - 1]) * direction > 0);
  return total >= by || (steady && total >= by / 2);
}

/**
 * The sentence above the trend: whether the good rate (`rate`) has been
 * falling or the bad one (`risk`) rising over the last three months — and
 * what that means for this service (`advice`).
 */
export function TrendNote<T extends { month: string }, K extends keyof T & string>({
  months,
  rate,
  risk,
  advice,
}: {
  months: T[];
  rate: { key: K; label: string };
  risk: { key: K; label: string; by?: number };
  advice: string;
}) {
  const recent = months.slice(-3);
  if (!recent.length) return null;
  const value = (m: T, key: K) => Number(m[key]) || 0;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const span = recent.length === 1 ? 'this month' : `${monthLabel(first.month, true)} to ${monthLabel(last.month, true)}`;
  const falling = moved(months.map((m) => value(m, rate.key)), -1, 5);
  const rising = moved(months.map((m) => value(m, risk.key)), 1, risk.by ?? 1);

  if (falling || rising) {
    const parts = [
      falling && `${rate.label} fell from ${value(first, rate.key)}% to ${value(last, rate.key)}%`,
      rising && `${risk.label} rose from ${value(first, risk.key)}% to ${value(last, risk.key)}%`,
    ].filter(Boolean);
    return (
      <p className="mb-3 flex items-start gap-2 rounded-lg bg-[#fff6ee] px-3 py-2 text-[12px] text-[#9a5418] dark:bg-orange-500/10 dark:text-orange-200">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          From {span}, {parts.join(' and ')} — {advice}
        </span>
      </p>
    );
  }
  const rates = recent.map((m) => value(m, rate.key));
  const low = Math.min(...rates);
  const high = Math.max(...rates);
  return (
    <p className="mb-3 flex items-center gap-2 text-[12px] text-[#6a7d96] dark:text-zinc-400">
      <TrendingUp className="h-3.5 w-3.5 shrink-0 text-[#25a883]" />
      {rate.label[0].toUpperCase() + rate.label.slice(1)} {low === high ? `at ${low}%` : `between ${low}% and ${high}%`} from{' '}
      {span}, {risk.label} at {value(last, risk.key)}% — holding steady.
    </p>
  );
}
