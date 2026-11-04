import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TriangleAlert, TrendingUp } from 'lucide-react';

import { COLORS, compact, fmt } from '../../cdr-dashboard/components/attempt-analytics/design';
import type { MonthTotals } from '../api';
import { monthLabel } from '../format';

export type TrendView = 'usage' | 'quality';

const AXIS = { fontSize: 11, fill: '#8a99ad' };

/**
 * One bar per month and a rate line over it.
 *
 * Usage: connected minutes, with the connect rate — is the account growing
 * or shrinking. List quality: connect rate and DND % alone — a connect rate
 * sliding month after month, or DND creeping up, means the number lists are
 * going stale, which is worth telling the client. The sentence above the
 * chart says so when it is happening.
 */
export function MonthlyTrend({ months, view }: { months: MonthTotals[]; view: TrendView }) {
  const data = months.map((m) => ({ ...m, label: monthLabel(m.month, true) }));
  // A round top for the rate axis, in quarters, so its ticks read 0/10/20/30/40.
  const highest = Math.max(0, ...months.map((m) => (view === 'quality' ? Math.max(m.connect_rate, m.dnd_rate) : m.connect_rate)));
  const top = Math.min(100, Math.max(20, Math.ceil((highest + 2) / 20) * 20));
  const rateTicks = [0, top / 4, top / 2, (top * 3) / 4, top];
  return (
    <div className="min-w-0">
      <TrendNote months={months} />
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="#8a99ad" strokeOpacity={0.15} />
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
            {view === 'usage' && (
              <YAxis yAxisId="left" tick={AXIS} axisLine={false} tickLine={false} width={48} tickFormatter={compact} />
            )}
            <YAxis
              yAxisId="right"
              orientation={view === 'usage' ? 'right' : 'left'}
              tick={AXIS}
              axisLine={false}
              tickLine={false}
              width={40}
              unit="%"
              domain={[0, top]}
              ticks={rateTicks}
            />
            <Tooltip content={<MonthTip view={view} />} cursor={{ fill: '#8a99ad', fillOpacity: 0.08 }} />
            {view === 'usage' && (
              <Bar yAxisId="left" dataKey="minutes" name="Connected minutes" fill={COLORS.blue} radius={[4, 4, 0, 0]} maxBarSize={42} />
            )}
            <Line
              yAxisId="right"
              dataKey="connect_rate"
              name="Connect rate"
              stroke={view === 'usage' ? COLORS.navy : COLORS.blue}
              strokeWidth={2}
              dot={{ r: 3 }}
              type="monotone"
            />
            {view === 'quality' && (
              <Line yAxisId="right" dataKey="dnd_rate" name="DND %" stroke="#ee8a3c" strokeWidth={2} dot={{ r: 3 }} type="monotone" />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex items-center justify-center gap-5 text-[11px] text-[#6a7d96] dark:text-zinc-400">
        {view === 'usage' ? (
          <>
            <Key color={COLORS.blue} label="Connected minutes" square />
            <Key color={COLORS.navy} label="Connect rate" />
          </>
        ) : (
          <>
            <Key color={COLORS.blue} label="Connect rate" />
            <Key color="#ee8a3c" label="DND %" />
          </>
        )}
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

interface TipProps {
  view: TrendView;
  active?: boolean;
  payload?: { payload: MonthTotals }[];
}

function MonthTip({ active, payload }: TipProps) {
  const month = payload?.[0]?.payload;
  if (!active || !month) return null;
  const rows: [string, string][] = [
    ['Campaigns', fmt(month.campaigns)],
    ['Active days', fmt(month.active_days)],
    ['Numbers dialed', fmt(month.dialed)],
    ['Connected', fmt(month.connected)],
    ['Connect rate', `${month.connect_rate}%`],
    ['Connected minutes', fmt(month.minutes)],
    ['DND', `${fmt(month.dnd)} (${month.dnd_rate}%)`],
  ];
  return (
    <div className="vd-design min-w-[220px] rounded-[10px] border border-white/[0.08] bg-[#1f2b45f7] px-3.5 py-3 text-white shadow-[0_12px_35px_#15253d2d]">
      <div className="text-[9px] uppercase tracking-[1px] text-[#8398b9]">{monthLabel(month.month)}</div>
      <div className="mt-1.5 space-y-[3px]">
        {rows.map(([label, value]) => (
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

function TrendNote({ months }: { months: MonthTotals[] }) {
  const recent = months.slice(-3);
  if (!recent.length) return null;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const span = recent.length === 1 ? 'this month' : `${monthLabel(first.month, true)} to ${monthLabel(last.month, true)}`;
  const falling = moved(months.map((m) => m.connect_rate), -1, 5);
  const dndRising = moved(months.map((m) => m.dnd_rate), 1, 1);

  if (falling || dndRising) {
    const parts = [
      falling && `connect rate fell from ${first.connect_rate}% to ${last.connect_rate}%`,
      dndRising && `DND rose from ${first.dnd_rate}% to ${last.dnd_rate}%`,
    ].filter(Boolean);
    return (
      <p className="mb-3 flex items-start gap-2 rounded-lg bg-[#fff6ee] px-3 py-2 text-[12px] text-[#9a5418] dark:bg-orange-500/10 dark:text-orange-200">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          From {span}, {parts.join(' and ')} — the number lists may be getting stale. Worth raising with the client.
        </span>
      </p>
    );
  }
  const low = Math.min(...recent.map((m) => m.connect_rate));
  const high = Math.max(...recent.map((m) => m.connect_rate));
  return (
    <p className="mb-3 flex items-center gap-2 text-[12px] text-[#6a7d96] dark:text-zinc-400">
      <TrendingUp className="h-3.5 w-3.5 shrink-0 text-[#25a883]" />
      Connect rate {low === high ? `at ${low}%` : `between ${low}% and ${high}%`} from {span}, DND at {last.dnd_rate}% — holding steady.
    </p>
  );
}
