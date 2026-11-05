import { useMemo, useRef, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import clsx from 'clsx';
import { BarChart3, Maximize2, Minimize2, RotateCcw } from 'lucide-react';

import { ProcessingChip, ProgressSweep } from '../../../components/Loading';
import { compact } from '../../cdr-dashboard/components/attempt-analytics/design';
import type { PortResult } from '../api';
import { clock, fromSeconds, toSeconds } from '../params';

const nf = new Intl.NumberFormat('en-US');
const AXIS = { fontSize: 12, fill: '#6b7a90' };
const BLUE = '#2563eb';

export type PortView = 'hour' | 'minute';

/**
 * Port activity over time — one card, one line: ports in use through the
 * window. The figures arrive minute by minute; "Hour wise" folds them into
 * each hour's peak here, so switching between the two needs no new request.
 * Drag across the chart to zoom into a stretch.
 */
export function PortActivity({
  result,
  isFetching,
  view,
  onView,
  onZoom,
  zoomed,
  onResetZoom,
  dateLabel,
  full,
  onFull,
}: {
  result?: PortResult;
  isFetching: boolean;
  view: PortView;
  onView: (v: PortView) => void;
  onZoom: (from: string, to: string) => void;
  zoomed: boolean;
  onResetZoom: () => void;
  dateLabel: string;
  /** Full screen is the page's — it takes the filters along — so the card only asks. */
  full: boolean;
  onFull: (full: boolean) => void;
}) {

  // Minute by minute as it arrives, or each hour's highest minute.
  const data = useMemo(() => {
    if (!result) return [];
    const minutes = result.labels.map((t, i) => ({ t: t.slice(0, 5), ports: result.total[i] }));
    if (view === 'minute') return minutes;
    const hours = new Map<string, number>();
    for (const m of minutes) {
      const hour = `${m.t.slice(0, 2)}:00`;
      hours.set(hour, Math.max(hours.get(hour) ?? 0, m.ports));
    }
    return [...hours].map(([t, ports]) => ({ t, ports }));
  }, [result, view]);
  const stepSeconds = view === 'hour' ? 3600 : 60;

  // Drag to zoom. Recharts delivers its mouse moves a frame late, so the
  // release is read a moment after it happens, once the last move has landed.
  const [drag, setDrag] = useState<{ from: string; to: string } | null>(null);
  const dragRef = useRef<{ from: string; to: string } | null>(null);
  const moveDrag = (next: { from: string; to: string } | null) => {
    dragRef.current = next;
    setDrag(next);
  };
  const startDrag = (at: string) => {
    moveDrag({ from: at, to: at });
    const finish = () =>
      window.setTimeout(() => {
        const done = dragRef.current;
        moveDrag(null);
        if (done && done.from !== done.to) {
          const [a, b] = [toSeconds(`${done.from}:00`), toSeconds(`${done.to}:00`)].sort((x, y) => x - y);
          onZoom(fromSeconds(a), fromSeconds(b + stepSeconds - 1));
        }
      }, 80);
    window.addEventListener('mouseup', finish, { once: true });
  };

  return (
    <section
      className={clsx(
        'relative flex flex-col overflow-hidden rounded-2xl border border-[#e4eaf2] bg-white p-5 shadow-[0_6px_24px_#1c30540a] dark:border-[#1c2a42] dark:bg-[#0e192c]',
        full && 'min-h-0 flex-1',
      )}
    >
      {/* Working: a sweep along the card's top edge. */}
      {isFetching && <ProgressSweep />}

      <header className="mb-4 flex flex-wrap items-center gap-3">
        <BarChart3 className="h-6 w-6 shrink-0 text-[#2563eb]" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[19px] font-semibold tracking-[-0.2px] text-[#0f172a] dark:text-white">Port Activity Over Time</h2>
          <p className="mt-0.5 text-[12px] text-[#6b7a90] dark:text-zinc-400">
            {result ? (
              <>
                {dateLabel} · peak <strong className="font-semibold text-[#0f172a] dark:text-white">{nf.format(result.summary.peak)}</strong>{' '}
                ports at {clock(result.summary.peak_at)}
              </>
            ) : (
              dateLabel
            )}
          </p>
        </div>
        {zoomed && result && (
          <button
            type="button"
            onClick={onResetZoom}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#dfe7f1] px-3 text-[13px] font-medium text-[#45556e] transition-colors hover:bg-zinc-50 dark:border-white/[0.08] dark:text-zinc-300 dark:hover:bg-white/[0.04]"
          >
            <RotateCcw className="h-4 w-4" />
            Reset zoom
          </button>
        )}
        <button
          type="button"
          onClick={() => onFull(!full)}
          title={full ? 'Exit full screen (Esc)' : 'Full screen'}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#dfe7f1] text-[#45556e] transition-colors hover:bg-zinc-50 dark:border-white/[0.08] dark:text-zinc-300 dark:hover:bg-white/[0.04]"
        >
          {full ? <Minimize2 className="h-[18px] w-[18px]" /> : <Maximize2 className="h-[18px] w-[18px]" />}
        </button>
      </header>

      <div className={clsx('relative min-w-0 select-none', full ? 'min-h-[300px] flex-1' : 'h-[420px]')}>
        {result ? (
          <div
            className={clsx(
              'h-full cursor-crosshair transition-opacity [&_.recharts-surface]:outline-none [&_.recharts-wrapper]:outline-none',
              isFetching && 'opacity-40',
            )}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data}
                margin={{ top: 10, right: 16, bottom: 18, left: 8 }}
                onMouseDown={(e) => e?.activeLabel != null && startDrag(String(e.activeLabel))}
                onMouseMove={(e) => dragRef.current && e?.activeLabel != null && moveDrag({ ...dragRef.current, to: String(e.activeLabel) })}
              >
                <defs>
                  <linearGradient id="port-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={BLUE} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={BLUE} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e6ecf4" vertical={false} />
                <XAxis
                  dataKey="t"
                  tick={AXIS}
                  tickLine={false}
                  axisLine={{ stroke: '#d5dde8' }}
                  minTickGap={view === 'hour' ? 8 : 56}
                  label={{ value: 'Time', position: 'insideBottom', offset: -12, fill: '#6b7a90', fontSize: 12 }}
                />
                <YAxis
                  tick={AXIS}
                  tickLine={false}
                  axisLine={false}
                  width={58}
                  tickFormatter={compact}
                  allowDecimals={false}
                  label={{ value: 'Ports in use', angle: -90, position: 'insideLeft', fill: '#6b7a90', fontSize: 12, dy: 40 }}
                />
                <Tooltip content={<Tip view={view} date={dateLabel} />} cursor={{ stroke: '#475569', strokeDasharray: '4 4' }} />
                <Area
                  dataKey="ports"
                  type="monotone"
                  stroke={BLUE}
                  strokeWidth={2.2}
                  fill="url(#port-fill)"
                  dot={view === 'hour' ? { r: 3, fill: BLUE, strokeWidth: 0 } : false}
                  activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
                {drag && <ReferenceArea x1={drag.from} x2={drag.to} fill={BLUE} fillOpacity={0.08} stroke={BLUE} strokeOpacity={0.3} />}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-full rounded-xl bg-[repeating-linear-gradient(0deg,transparent_0_83px,#eef2f7_83px_84px)] dark:bg-[repeating-linear-gradient(0deg,transparent_0_83px,rgba(255,255,255,0.05)_83px_84px)]" />
        )}

        {isFetching && <ProcessingChip />}
      </div>

      {/* The view switch, along the bottom. */}
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[11px] text-[#8a99ad] dark:text-zinc-500">
          {result
            ? `Each point is the highest number of ports in use in that ${view === 'hour' ? 'hour' : 'minute'} · drag across the chart to zoom in`
            : ''}
        </span>
        <div className="inline-flex rounded-xl bg-[#eef3f9] p-1 dark:bg-white/[0.06]" role="radiogroup" aria-label="View">
          {(
            [
              { id: 'hour', label: 'Hour wise' },
              { id: 'minute', label: 'Minute wise' },
            ] as const
          ).map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={view === o.id}
              onClick={() => onView(o.id)}
              className={clsx(
                'rounded-lg px-4 py-1.5 text-[13px] font-medium transition-colors',
                view === o.id ? 'bg-[#2563eb] text-white shadow-sm' : 'text-[#45556e] hover:text-[#0f172a] dark:text-zinc-300 dark:hover:text-white',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function Tip({
  active,
  payload,
  view,
  date,
}: {
  active?: boolean;
  payload?: { payload: { t: string; ports: number } }[];
  view: PortView;
  date: string;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const end = view === 'hour' ? `${point.t.slice(0, 2)}:59` : null;
  return (
    <div className="min-w-[200px] rounded-xl border border-[#e4eaf2] bg-white px-4 py-3 shadow-[0_10px_30px_rgba(15,23,42,0.12)] dark:border-white/[0.08] dark:bg-[#13213a]">
      <div className="mb-2 text-[13px] text-[#6b7a90] dark:text-zinc-400">
        {date}, {point.t}
        {end && ` – ${end}`}
      </div>
      <div className="flex items-center justify-between gap-6 text-[14px]">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: BLUE }} />
          <span className="text-[#1f2b45] dark:text-zinc-100">Ports in use</span>
        </span>
        <span className="font-semibold tabular-nums text-[#0f172a] dark:text-white">{nf.format(point.ports)}</span>
      </div>
    </div>
  );
}
