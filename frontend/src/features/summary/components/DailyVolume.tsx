import { useMemo } from 'react';
import clsx from 'clsx';

import { useHover } from '../../cdr-dashboard/components/attempt-analytics/tooltipContext';
import { TipBody } from '../../cdr-dashboard/components/attempt-analytics/HoverTooltip';
import { fmt, pct } from '../../cdr-dashboard/components/attempt-analytics/design';
import { addDays, isoDay, parseDay, shortDay, weekdayDay } from '../format';
import { HScroll } from './HScroll';

export interface VolumeDay {
  date: string;
  /** The light bar: dialed out (Voicedrop), parties ringed (Conference), attempts (MultiCall). */
  total: number;
  /** The dark bar inside it: connected. */
  connected: number;
}

const LIGHT = '#bfd3f6';
const DARK = '#2563eb';

/** One day's slot on the full chart: the bar, then its date under it. */
const SLOT = 'w-[34px] shrink-0';

/**
 * One bar per day: the day's total in pale blue with its connected share in
 * solid blue rising inside it — the day's size and how much of it connected,
 * read at once. A day with no data is a gap, not a zero bar. Clicking a bar
 * drills into that day.
 *
 * The full chart runs from the first day with data to `asOf`, a date under
 * every bar, and opens on the latest days; the wheel or a trackpad slides it
 * back through the months before (see HScroll). Its scale is the 95th
 * percentile day, not the single biggest one — one record day would otherwise
 * flatten every other bar — and a day taller than that is drawn to the top
 * with a notch.
 *
 * `compact` is the Home cards' sparkline: the last `span` days, fitted to the
 * card, with no labels.
 */
export function DailyVolume({
  days,
  asOf,
  span = 30,
  totalLabel,
  connectedLabel = 'connected',
  onDay,
  compact = false,
}: {
  days: VolumeDay[];
  asOf: string;
  span?: number;
  totalLabel: string;
  connectedLabel?: string;
  onDay?: (iso: string) => void;
  compact?: boolean;
}) {
  const { slots, scale } = useMemo(() => {
    const byDate = new Map(days.map((d) => [d.date, d]));
    const end = parseDay(asOf);
    const first = compact
      ? addDays(end, -(span - 1))
      : days.reduce((min, d) => (d.date < isoDay(min) ? parseDay(d.date) : min), addDays(end, -(span - 1)));
    const count = Math.round((end.getTime() - first.getTime()) / 86_400_000) + 1;
    const list = Array.from({ length: count }, (_, i) => {
      const iso = isoDay(addDays(first, i));
      return { iso, day: byDate.get(iso) };
    });
    const totals = list.map((s) => s.day?.total ?? 0).filter((v) => v > 0).sort((a, b) => a - b);
    const p95 = totals.length ? totals[Math.min(totals.length - 1, Math.floor(totals.length * 0.95))] : 1;
    return { slots: list, scale: Math.max(1, compact ? totals[totals.length - 1] ?? 1 : p95) };
  }, [days, asOf, span, compact]);

  if (compact) {
    return (
      <div className="flex h-14 items-end gap-[2px]">
        {slots.map((slot) => (
          <Bar key={slot.iso} slot={slot} scale={scale} totalLabel={totalLabel} connectedLabel={connectedLabel} compact />
        ))}
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <HScroll startAtEnd>
        <div className="flex w-max gap-[6px] pr-1">
          {slots.map((slot) => (
            <div key={slot.iso} className={SLOT}>
              <div className="flex h-[150px] items-end">
                <Bar slot={slot} scale={scale} totalLabel={totalLabel} connectedLabel={connectedLabel} onDay={onDay} />
              </div>
              <DateLabel iso={slot.iso} />
            </div>
          ))}
        </div>
      </HScroll>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#6a7d96] dark:text-zinc-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: LIGHT }} />
          {totalLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: DARK }} />
          {connectedLabel}
          {onDay && <span className="text-[#8a99ad] dark:text-zinc-500">· click a bar to drill into that day</span>}
        </span>
        <span className="ml-auto text-[#8a99ad] dark:text-zinc-500">Scroll over the chart for earlier days</span>
      </div>
    </div>
  );
}

/** "5 Oct" under every bar; the 1st of a month in full ink, so months read at a glance. */
function DateLabel({ iso }: { iso: string }) {
  const isFirst = iso.endsWith('-01');
  const [day, month] = shortDay(iso).split(' ');
  return (
    <div
      className={clsx(
        'mt-1.5 text-center text-[10px] leading-[1.15] tabular-nums',
        isFirst ? 'font-semibold text-[#35415a] dark:text-zinc-100' : 'text-[#8a99ad] dark:text-zinc-500',
      )}
    >
      <div>{day}</div>
      <div>{month}</div>
    </div>
  );
}

function Bar({
  slot,
  scale,
  totalLabel,
  connectedLabel,
  compact = false,
  onDay,
}: {
  slot: { iso: string; day?: VolumeDay };
  scale: number;
  totalLabel: string;
  connectedLabel: string;
  compact?: boolean;
  onDay?: (iso: string) => void;
}) {
  const { iso, day } = slot;
  const capital = (s: string) => s[0].toUpperCase() + s.slice(1);
  const hover = useHover(() =>
    day ? (
      <TipBody
        eyebrow={weekdayDay(iso)}
        title={capital(totalLabel)}
        value={day.total}
        sections={[{ title: 'That day', base: day.total, rows: [{ label: capital(connectedLabel), value: day.connected }] }]}
      />
    ) : (
      <>
        <div className="text-[9px] uppercase tracking-[1px] text-[#8398b9]">{weekdayDay(iso)}</div>
        <div className="mt-1 text-[12px] text-[#c5cee0]">No data that day.</div>
      </>
    ),
  );
  // The bar's height is the day's total on the shared scale; the dark part
  // inside is the connected share of that bar.
  const over = !!day && day.total > scale;
  const height = day ? Math.max(Math.min((day.total / scale) * 100, 100), day.total > 0 ? 2 : 0) : 0;
  const share = day?.total ? Math.min(day.connected / day.total, 1) * 100 : 0;
  const className = clsx(
    'group relative flex h-full flex-1 items-end outline-none focus-visible:ring-2 focus-visible:ring-[#42b9e9]',
    compact ? 'rounded-[2px]' : 'rounded-[3px]',
    day && onDay && 'cursor-pointer',
  );
  const bars = day && (
    <span
      className={clsx(
        'relative block w-full overflow-hidden transition-[filter] group-hover:brightness-95',
        compact ? 'rounded-[2px]' : 'rounded-[3px]',
      )}
      style={{ height: `${height}%`, background: LIGHT }}
      aria-hidden
    >
      <span className="absolute inset-x-0 bottom-0 block" style={{ height: `${share}%`, background: DARK }} />
      {over && !compact && <span className="absolute inset-x-0 top-0 block h-[3px] bg-[#1e3a8a]" title={`${fmt(day.total)} — above the chart's scale`} />}
    </span>
  );
  return day && onDay ? (
    <button
      type="button"
      {...hover}
      onClick={() => onDay(iso)}
      aria-label={`${weekdayDay(iso)}: ${fmt(day.total)} ${totalLabel}, ${pct(day.connected, day.total)} ${connectedLabel}`}
      className={className}
    >
      {bars}
    </button>
  ) : (
    <span {...hover} className={className}>
      {bars}
    </span>
  );
}
