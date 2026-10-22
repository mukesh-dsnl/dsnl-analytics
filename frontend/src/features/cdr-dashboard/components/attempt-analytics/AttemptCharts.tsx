import { createElement, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Info,
  Loader2,
  MapPin,
  MousePointer2,
  PhoneOff,
  PhoneOutgoing,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';

import type { CallCubeRow, CategoryDatum, CdrDashboard, DirectionSplitDatum, ReblastAidDatum } from '../../api';
import { cubeDimensionValue } from '../../cubeDimensions';
import type { CubeDimension } from '../../cubeDimensions';
import {
  BLAST_COLORS,
  COLORS,
  DURATION_COLORS,
  LOCATION_COLORS,
  PROVIDER_COLORS,
  REASON_COLORS,
  colorAt,
  compact,
  fmt,
  niceCeiling,
  pct,
} from './design';
import { HoverTooltipProvider, TipBody } from './HoverTooltip';
import type { TipRow } from './HoverTooltip';
import { useHover } from './tooltipContext';

interface AttemptChartsProps {
  data: CdrDashboard | undefined;
  cubeRows: CallCubeRow[];
  isLoading: boolean;
  error: Error | null;
  /**
   * Whether to show Call activity and Call duration. Their stages (initiated,
   * rang) are dial-out concepts, so only Voicedrop shows them.
   */
  dialOutStages: boolean;
}

type Tab = 'all' | 'outcomes' | 'routing' | 'capacity' | 'disconnects';

const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'Overview' },
  { id: 'outcomes', label: 'Call performance' },
  { id: 'routing', label: 'Traffic & routing' },
  { id: 'capacity', label: 'Capacity & retries' },
  { id: 'disconnects', label: 'Disconnects' },
];

const BUCKET_LABEL: Record<string, string> = {
  minute: 'Highest concurrent ports per minute',
  hour: 'Highest concurrent ports per hour',
  day: 'Highest concurrent ports per day',
};

// ── Shared class names: the design's light values, with dark equivalents ──

const INK = 'text-[#35415a] dark:text-zinc-100';
const MUTED = 'text-[#7a899f] dark:text-zinc-400';
const LABEL = 'text-[12px] text-[#657992] dark:text-zinc-400';
const NUMBER = 'text-right text-[12px] font-medium tabular-nums whitespace-nowrap text-[#405a7a] dark:text-zinc-200';
const PERCENT = 'text-right text-[10px] tabular-nums whitespace-nowrap text-[#7e90a9] dark:text-zinc-500';
const TRACK = 'block relative overflow-hidden rounded bg-[#f3f6fa] dark:bg-white/[0.06]';
const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-[#42b9e9] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900';

/**
 * The attempt-metrics charts, in the attempt-analytics redesign — for every
 * service: grouped cards, the design's palette and typeface, and a hover
 * readout on every mark. Hover only — nothing opens on click.
 */
export function AttemptCharts({ data, cubeRows, isLoading, error, dialOutStages }: AttemptChartsProps) {
  const [tab, setTab] = useState<Tab>('all');
  const total = data?.summary.total_calls ?? 0;
  const ready = !isLoading && !error && data;

  const card = { isLoading, error };
  const shows = (t: Tab) => tab === 'all' || tab === t;

  return (
    <HoverTooltipProvider>
      <div className="vd-design">
        {/* Chart groups — a segmented switch */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <nav
            className="flex gap-1 overflow-x-auto rounded-xl bg-[#e9eef5]/80 p-1 [scrollbar-width:none] dark:bg-white/[0.05]"
            aria-label="Metric groups"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-pressed={tab === t.id}
                className={clsx(
                  'whitespace-nowrap rounded-lg px-3.5 py-1.5 text-[12px] font-medium transition-colors',
                  tab === t.id
                    ? 'bg-white text-[#16213a] shadow-[0_1px_3px_#1c305414] dark:bg-zinc-700 dark:text-white'
                    : 'text-[#5b6a82] hover:text-[#16213a] dark:text-zinc-400 dark:hover:text-white',
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <p className="flex items-center gap-1.5 text-[11px] text-[#7d8da2] dark:text-zinc-500">
            <MousePointer2 className="h-3 w-3" />
            Hover a chart to explore
          </p>
        </div>

        {ready && total === 0 ? (
          <div className="mb-[22px] rounded-[14px] border border-[#e7ebf2] bg-white px-6 py-[70px] text-center dark:border-zinc-800/60 dark:bg-surface-dark">
            <h2 className="text-[18px] font-medium text-[#526681] dark:text-zinc-200">No attempts in this scope</h2>
            <p className="mt-1 text-[12px] text-[#95a3b5] dark:text-zinc-500">Try a different date range or fewer filters.</p>
          </div>
        ) : (
          <>
            {shows('outcomes') && (
              <Section title="Call performance">
                {dialOutStages && <ActivityCard {...card} data={data} total={total} />}
                <ConnectionCard {...card} data={data} total={total} cubeRows={cubeRows} span={dialOutStages ? 5 : 6} />
                {dialOutStages && <DurationCard {...card} data={data} />}
                <DirectionCard {...card} data={data} total={total} cubeRows={cubeRows} span={dialOutStages ? 5 : 6} />
              </Section>
            )}
            {shows('routing') && (
              <Section title="Traffic & routing">
                <ProviderCard {...card} data={data} total={total} cubeRows={cubeRows} />
                <LocationCard {...card} data={data} total={total} cubeRows={cubeRows} />
              </Section>
            )}
            {(tab === 'all' || tab === 'capacity') && (
              <Section title="Capacity & follow-up">
                <PeakCard {...card} data={data} />
                {tab === 'capacity' && <RetryCard {...card} data={data} total={total} wide />}
              </Section>
            )}
            {tab === 'all' && (
              <Section title="What happened next">
                <RetryCard {...card} data={data} total={total} />
                <ReasonsCard {...card} data={data} total={total} />
              </Section>
            )}
            {tab === 'disconnects' && (
              <Section title="Disconnect analysis">
                <ReasonsCard {...card} data={data} total={total} wide />
              </Section>
            )}
          </>
        )}
      </div>
    </HoverTooltipProvider>
  );
}

// ── Layout ─────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <div className="mx-px mb-[13px] flex items-center justify-between gap-3">
        <h2 className="m-0 text-[13px] font-medium text-[#576980] dark:text-zinc-300">{title}</h2>
      </div>
      <div className="mb-6 grid grid-cols-12 gap-4">{children}</div>
    </>
  );
}

interface CardStateProps {
  isLoading: boolean;
  error: Error | null;
}

function Card({
  span,
  title,
  subtitle,
  extra,
  footer,
  isLoading,
  error,
  isEmpty,
  bodyClassName,
  children,
}: CardStateProps & {
  span: 5 | 6 | 7 | 12;
  title: string;
  subtitle: string;
  extra?: ReactNode;
  footer?: string;
  isEmpty?: boolean;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <article
      className={clsx(
        'col-span-12 flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[#e9eef5] bg-white shadow-[0_6px_20px_#1c305408] dark:border-[#1c2a42] dark:bg-[#0e192c] dark:shadow-[0_10px_30px_-16px_rgba(0,0,0,0.8)]',
        span === 7 && 'lg:col-span-7',
        span === 5 && 'lg:col-span-5',
        span === 6 && 'lg:col-span-6',
      )}
    >
      <div className="flex items-start justify-between gap-2 px-[18px] pt-4">
        <div className="min-w-0">
          <h3 className={clsx('m-0 text-[13px] font-medium leading-[1.4]', INK)}>{title}</h3>
          <p className={clsx('mt-0.5 mb-0 text-[12px] leading-normal', MUTED)}>{subtitle}</p>
        </div>
        {!isLoading && !error && !isEmpty && extra}
      </div>
      <div className={clsx('flex-1 p-[18px]', bodyClassName)}>
        {isLoading ? (
          <div className="flex h-full min-h-[180px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[#50a6d5]" />
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 text-[12px] text-red-600 dark:text-red-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="break-words">{error.message}</p>
          </div>
        ) : isEmpty ? (
          <div className="flex h-full min-h-[180px] items-center justify-center text-[12px] text-[#95a3b5] dark:text-zinc-500">
            No data for this range.
          </div>
        ) : (
          children
        )}
      </div>
      {footer && !isLoading && !error && !isEmpty && (
        <div className="flex items-center gap-1.5 border-t border-[#eff2f6] px-[18px] py-2.5 text-[10px] text-[#74859d] dark:border-zinc-800/60 dark:text-zinc-500">
          <Info className="h-3 w-3 shrink-0" />
          <span>{footer}</span>
        </div>
      )}
    </article>
  );
}

/** Any element that shows a readout on hover and focus. */
function Hoverable({
  as = 'div',
  tip,
  className,
  style,
  children,
  ...rest
}: {
  as?: 'div' | 'circle' | 'span';
  tip: () => ReactNode;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  [svgAttribute: string]: unknown;
}) {
  const hover = useHover(tip);
  return createElement(as, { ...rest, ...hover, className: clsx(FOCUS, className), style }, children);
}

function Fill({ width, color, className }: { width: number; color: string; className?: string }) {
  return (
    <span
      className={clsx('block h-full rounded transition-[filter] duration-150 group-hover:brightness-[.93]', className)}
      style={{ width: `${Math.min(Math.max(width, 0), 100)}%`, background: color }}
    />
  );
}

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />;
}

// ── Readout content ───────────────────────────────────────────────────────

const DIMENSION_TITLE: Record<CubeDimension, string> = {
  connection: 'Connection',
  direction: 'Call direction',
  location: 'Location',
  provider: 'Service provider',
};

/** How one value of a dimension splits across the others, from the call cube. */
function cubeSections(cubeRows: CallCubeRow[], dimension: CubeDimension, value: string) {
  const matching = cubeRows.filter((row) => cubeDimensionValue(row, dimension) === value);
  const others = (['connection', 'direction', 'location', 'provider'] as CubeDimension[]).filter(
    (d) => d !== dimension,
  );
  return others.map((other) => {
    const totals = new Map<string, number>();
    for (const row of matching) {
      const key = cubeDimensionValue(row, other);
      totals.set(key, (totals.get(key) ?? 0) + row.count);
    }
    const rows: TipRow[] = [...totals]
      .map(([label, count]) => ({ label: other === 'provider' ? `Provider ${label}` : label, value: count }))
      .sort((a, b) => b.value - a.value);
    return { title: DIMENSION_TITLE[other], rows };
  });
}

function directionRows(splits: DirectionSplitDatum[], label: string): TipRow[] {
  const split = splits.find((s) => s.label === label);
  if (!split) return [];
  return [
    { label: 'Dial out', value: split.dial_out },
    { label: 'Dial in', value: split.dial_in },
  ];
}

// ── Call performance ──────────────────────────────────────────────────────

const STAGES: { label: string; title: string; icon: LucideIcon; color: string }[] = [
  { label: 'Call Initiated', title: 'Call initiated', icon: PhoneOutgoing, color: COLORS.blue },
  { label: 'Call Ringed', title: 'Call rang', icon: BellRing, color: COLORS.amber },
  { label: 'Call Connected', title: 'Call connected', icon: CheckCircle2, color: COLORS.green },
  { label: 'Call Ended', title: 'Call ended', icon: PhoneOff, color: COLORS.navy },
];

function ActivityCard({ data, total, ...state }: CardStateProps & { data?: CdrDashboard; total: number }) {
  const funnel = data?.call_funnel ?? [];
  const splits = data?.call_funnel_direction ?? [];
  const value = (label: string) => funnel.find((f) => f.label === label)?.value ?? 0;

  return (
    <Card
      {...state}
      span={7}
      title="Call activity"
      subtitle="A view of each stage in the call lifecycle"
      footer="Event counts can overlap. Each percentage is a share of total attempts."
      isEmpty={funnel.length === 0}
    >
      <div className="flex flex-col gap-3.5 pt-px">
        {STAGES.map((stage) => {
          const n = value(stage.label);
          const Icon = stage.icon;
          return (
            <Hoverable
              key={stage.label}
              tip={() => (
                <TipBody
                  eyebrow="Call activity"
                  title={stage.title}
                  value={n}
                  share={`${pct(n, total)} of attempts`}
                  sections={[{ title: 'Call direction', rows: directionRows(splits, stage.label) }]}
                />
              )}
              className="group grid w-full grid-cols-[115px_minmax(40px,1fr)_89px_45px] items-center gap-3 rounded-md py-[3px] text-left"
            >
              <span className={clsx('flex items-center gap-[9px] group-hover:text-[#1c2a40] dark:group-hover:text-white', LABEL)}>
                <Icon className="h-3.5 w-3.5 shrink-0 text-[#a6b2c6] dark:text-zinc-500" />
                {stage.title}
              </span>
              <span className={clsx(TRACK, 'h-[14px]')}>
                <Fill width={total ? (n / total) * 100 : 0} color={stage.color} />
              </span>
              <span className={NUMBER}>{fmt(n)}</span>
              <span className={PERCENT}>{pct(n, total)}</span>
            </Hoverable>
          );
        })}
      </div>
      <div className="mt-[15px] ml-[127px] mr-[146px] flex justify-between text-[10px] text-[#91a1b7] dark:text-zinc-500">
        <span>0</span>
        <span>{compact(total / 2)}</span>
        <span>{compact(total)}</span>
      </div>
    </Card>
  );
}

const isConnectedLabel = (label: string) => !/\b(not|un)[\s_-]*connected/i.test(label);

function ConnectionCard({
  data,
  total,
  cubeRows,
  span = 5,
  ...state
}: CardStateProps & { data?: CdrDashboard; total: number; cubeRows: CallCubeRow[]; span?: 5 | 6 }) {
  const rows = data?.connection_status ?? [];
  const connected = rows.filter((r) => isConnectedLabel(r.label)).reduce((t, r) => t + r.value, 0);
  const notConnected = rows.filter((r) => !isConnectedLabel(r.label)).reduce((t, r) => t + r.value, 0);
  const base = connected + notConnected || total;
  const rate = base ? (connected / base) * 100 : 0;
  const segments = [
    { label: 'Connected', cube: 'Connected', value: connected, color: COLORS.green },
    { label: 'Not connected', cube: 'Not Connected', value: notConnected, color: COLORS.red },
  ];
  const tip = (s: (typeof segments)[number]) => () => (
    <TipBody
      eyebrow="Connection overview"
      title={s.label}
      value={s.value}
      share={`${pct(s.value, base)} of attempts`}
      sections={cubeSections(cubeRows, 'connection', s.cube)}
    />
  );

  return (
    <Card
      {...state}
      span={span}
      title="Connection overview"
      subtitle="How many attempts reached a participant?"
      footer="Hover an outcome for its direction and location mix."
      isEmpty={rows.length === 0}
      extra={
        <span className="whitespace-nowrap rounded-[5px] border border-[#e5f3ed] bg-[#ecf8f4] px-[7px] py-1 text-[10px] text-[#2b9d85] dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400">
          Connection rate
        </span>
      }
      bodyClassName="flex min-h-[190px] items-center justify-center gap-6 pt-3 pb-3.5"
    >
      <div className="relative h-[136px] w-[136px] shrink-0">
        <svg className="h-full w-full -rotate-90 overflow-visible" viewBox="0 0 180 180" aria-label={`Connection rate ${pct(connected, base)}`}>
          <circle cx="90" cy="90" r="70" fill="none" strokeWidth="15" className="stroke-[#f2f5f9] dark:stroke-white/[0.06]" />
          {segments.map((s, i) => {
            const p = base ? (s.value / base) * 100 : 0;
            const length = Math.max(0, p - (p === 100 ? 0 : 1.1));
            if (p === 0) return null;
            return (
              <Hoverable
                key={s.label}
                as="circle"
                tip={tip(s)}
                cx="90"
                cy="90"
                r="70"
                fill="none"
                stroke={s.color}
                strokeWidth="15"
                pathLength="100"
                strokeDasharray={`${length} ${100 - length}`}
                strokeDashoffset={i ? -rate : 0}
                role="img"
                aria-label={`${s.label}: ${fmt(s.value)}`}
                className="cursor-pointer transition-[stroke-width] duration-200 hover:[stroke-width:19] focus:[stroke-width:19]"
              />
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <strong className="text-[23px] font-semibold tracking-[-0.6px] text-[#263750] dark:text-white">{pct(connected, base)}</strong>
          <small className="mt-px text-[10px] text-[#788da7] dark:text-zinc-500">connection rate</small>
        </div>
      </div>
      <div className="flex min-w-[120px] max-w-[180px] flex-1 flex-col gap-[17px]">
        {segments.map((s) => (
          <Hoverable key={s.label} tip={tip(s)} className="rounded text-left">
            <span className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-[#70829b] dark:text-zinc-400">
              <Dot color={s.color} />
              {s.label}
            </span>
            <span className="mt-[5px] mb-px block pl-3 text-[15px] font-medium tracking-[-0.2px] tabular-nums text-[#4d5d76] dark:text-zinc-100">
              {fmt(s.value)}
            </span>
            <span className="pl-3 text-[10px] text-[#8193ad] dark:text-zinc-500">{pct(s.value, base)} of all attempts</span>
          </Hoverable>
        ))}
      </div>
    </Card>
  );
}

const durationLabel = (label: string) => `${label.replace('-', '–')} s`;

function DurationCard({ data, ...state }: CardStateProps & { data?: CdrDashboard }) {
  const buckets = data?.call_duration ?? [];
  const splits = data?.call_duration_direction ?? [];
  const connected = buckets.reduce((t, b) => t + b.value, 0);
  const max = niceCeiling(Math.max(...buckets.map((b) => b.value), 1));

  return (
    <Card
      {...state}
      span={7}
      title="Call duration"
      subtitle="Connected calls, grouped by call length"
      isEmpty={buckets.length === 0}
    >
      <div className="mb-[5px] grid h-[156px] grid-cols-[35px_1fr] gap-[9px]">
        <div className="flex flex-col justify-between pb-7 text-[10px] text-[#8599b3] dark:text-zinc-500">
          <span>{compact(max)}</span>
          <span>{compact((max / 3) * 2)}</span>
          <span>{compact(max / 3)}</span>
          <span>0</span>
        </div>
        <div className="relative">
          {/* Gridlines at the four tick heights */}
          <div className="absolute inset-x-0 top-0 bottom-7 border-b border-[#e5ebf2] dark:border-zinc-800">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="absolute inset-x-0 block h-px bg-[#eef2f6] dark:bg-white/[0.05]"
                style={{ top: `${(i / 3) * 100}%` }}
              />
            ))}
          </div>
          <div className="relative grid h-full gap-3 px-3" style={{ gridTemplateColumns: `repeat(${buckets.length}, 1fr)` }}>
            {buckets.map((b, i) => {
              const height = (b.value / max) * 100;
              const color = colorAt(DURATION_COLORS, i);
              return (
                <Hoverable
                  key={b.label}
                  tip={() => (
                    <TipBody
                      eyebrow="Call duration"
                      title={durationLabel(b.label)}
                      value={b.value}
                      share={`${pct(b.value, connected)} of connected`}
                      sections={[{ title: 'Call direction', rows: directionRows(splits, b.label) }]}
                    />
                  )}
                  className="group relative flex h-full flex-col items-center justify-end rounded"
                >
                  <div className="relative w-full flex-1">
                    <span
                      className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium tabular-nums text-[#5c7595] dark:text-zinc-300"
                      style={{ bottom: `calc(${height}% + 7px)` }}
                    >
                      {fmt(b.value)}
                    </span>
                    <span
                      className="absolute bottom-0 left-1/2 block w-[55%] max-w-[62px] -translate-x-1/2 rounded-t-[5px] transition-[filter] duration-200 group-hover:brightness-90"
                      style={{ height: `${height}%`, minHeight: b.value ? 2 : 0, background: color }}
                    />
                  </div>
                  <span className="flex h-7 items-end pb-px text-[11px] text-[#768da9] dark:text-zinc-400">{durationLabel(b.label)}</span>
                </Hoverable>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-[15px] flex items-center gap-1.5 pl-11 text-[11px] text-[#7c90ab] dark:text-zinc-500">
        <Dot color={COLORS.blue} />
        {fmt(connected)} connected calls in this scope
      </div>
    </Card>
  );
}

const directionColor = (label: string) =>
  /out/i.test(label) ? COLORS.blue : /in/i.test(label) ? COLORS.violet : COLORS.pale;

function DirectionCard({
  data,
  total,
  cubeRows,
  span = 5,
  ...state
}: CardStateProps & { data?: CdrDashboard; total: number; cubeRows: CallCubeRow[]; span?: 5 | 6 }) {
  const rows = [...(data?.call_direction ?? [])].sort((a, b) => b.value - a.value);
  const base = rows.reduce((t, r) => t + r.value, 0) || total;
  const outbound = rows.find((r) => /out/i.test(r.label))?.value ?? 0;
  const tip = (r: CategoryDatum) => () => (
    <TipBody
      eyebrow="Call direction"
      title={r.label}
      value={r.value}
      share={`${pct(r.value, base)} of attempts`}
      sections={cubeSections(cubeRows, 'direction', r.label)}
    />
  );

  return (
    <Card
      {...state}
      span={span}
      title="Call direction"
      subtitle="The balance between outbound and inbound calls"
      footer="Hover a direction to see its connection and routing mix."
      isEmpty={rows.length === 0}
      bodyClassName="pt-5"
    >
      <div className="text-[24px] font-semibold leading-[1.2] tracking-[-0.5px] text-[#2e4767] dark:text-white">
        {pct(outbound, base)}
        <span className="ml-[7px] text-[12px] font-normal tracking-normal text-[#7b8fab] dark:text-zinc-400">outbound</span>
      </div>
      <div className="my-[18px] flex h-[17px] gap-[3px] overflow-hidden rounded-[5px]">
        {rows.map((r) => (
          <Hoverable
            key={r.label}
            tip={tip(r)}
            className="h-full min-w-[3px] transition-[filter] hover:brightness-[.93]"
            style={{ width: `${base ? (r.value / base) * 100 : 0}%`, background: directionColor(r.label) }}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-[15px]">
        {rows.map((r) => (
          <Hoverable key={r.label} tip={tip(r)} className="rounded text-left">
            <span className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-[#70829b] dark:text-zinc-400">
              <Dot color={directionColor(r.label)} />
              {r.label}
              <span className="text-[10px] text-[#8193ad] dark:text-zinc-500">{pct(r.value, base)}</span>
            </span>
            <span className="mt-1.5 block pl-3 text-[14px] font-medium tabular-nums text-[#4d5d76] dark:text-zinc-100">
              {fmt(r.value)}
            </span>
          </Hoverable>
        ))}
      </div>
    </Card>
  );
}

// ── Traffic & routing ─────────────────────────────────────────────────────

function BarRow({
  label,
  value,
  max,
  base,
  color,
  tip,
  columns = 'grid-cols-[100px_minmax(40px,1fr)_90px_48px]',
  trackHeight = 'h-[9px]',
}: {
  label: string;
  value: number;
  max: number;
  base: number;
  color: string;
  tip: () => ReactNode;
  columns?: string;
  trackHeight?: string;
}) {
  return (
    <Hoverable tip={tip} className={clsx('group grid w-full items-center gap-3 rounded py-[3px] text-left', columns)}>
      <span className={clsx('truncate group-hover:text-[#1c2a40] dark:group-hover:text-white', LABEL)} title={label}>
        {label}
      </span>
      <span className={clsx(TRACK, trackHeight)}>
        <Fill width={max ? (value / max) * 100 : 0} color={color} />
      </span>
      <span className={NUMBER}>{fmt(value)}</span>
      <span className={PERCENT}>{pct(value, base)}</span>
    </Hoverable>
  );
}

function ProviderCard({
  data,
  total,
  cubeRows,
  ...state
}: CardStateProps & { data?: CdrDashboard; total: number; cubeRows: CallCubeRow[] }) {
  const rows = [...(data?.service_provider ?? [])].sort((a, b) => b.value - a.value);
  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <Card
      {...state}
      span={7}
      title="Service providers"
      subtitle="Attempt volume across your provider network"
      footer="Provider IDs are preserved from the source data."
      isEmpty={rows.length === 0}
      bodyClassName="pb-[25px]"
    >
      <div className="flex flex-col gap-[15px]">
        {rows.map((r, i) => (
          <BarRow
            key={r.label}
            label={`Provider ${r.label}`}
            value={r.value}
            max={max}
            base={total}
            color={colorAt(PROVIDER_COLORS, i)}
            tip={() => (
              <TipBody
                eyebrow="Service providers"
                title={`Provider ${r.label}`}
                value={r.value}
                share={`${pct(r.value, total)} of attempts`}
                sections={cubeSections(cubeRows, 'provider', r.label)}
              />
            )}
          />
        ))}
      </div>
    </Card>
  );
}

function LocationCard({
  data,
  total,
  cubeRows,
  ...state
}: CardStateProps & { data?: CdrDashboard; total: number; cubeRows: CallCubeRow[] }) {
  const rows = [...(data?.location ?? [])].sort((a, b) => b.value - a.value);

  return (
    <Card
      {...state}
      span={5}
      title="Location"
      subtitle="How call traffic is distributed"
      footer="Hover for the connection and direction breakdown."
      isEmpty={rows.length === 0}
      bodyClassName="pt-5"
    >
      {rows.map((r, i) => (
        <Hoverable
          key={r.label}
          tip={() => (
            <TipBody
              eyebrow="Location"
              title={`Location ${r.label}`}
              value={r.value}
              share={`${pct(r.value, total)} of attempts`}
              sections={cubeSections(cubeRows, 'location', r.label)}
            />
          )}
          className="group mb-[18px] block w-full rounded text-left"
        >
          <span className="mb-[9px] flex items-center justify-between text-[12px] text-[#8291a6] dark:text-zinc-400">
            <span className="flex items-center gap-1.5 whitespace-nowrap text-[#70829b] dark:text-zinc-400">
              <Dot color={colorAt(LOCATION_COLORS, i)} />
              Location {r.label}
            </span>
            <strong className="text-[12px] font-medium tabular-nums text-[#526680] dark:text-zinc-200">
              {fmt(r.value)}
              <small className="ml-2 text-[10px] font-normal text-[#879ab4] dark:text-zinc-500">{pct(r.value, total)}</small>
            </strong>
          </span>
          <span className={clsx(TRACK, 'h-[9px]')}>
            <Fill width={total ? (r.value / total) * 100 : 0} color={colorAt(LOCATION_COLORS, i)} />
          </span>
        </Hoverable>
      ))}
      <div className="mt-7 flex items-center gap-1.5 text-[11px] text-[#8396ae] dark:text-zinc-500">
        <MapPin className="h-[13px] w-[13px]" />
        Location codes: {rows.map((r) => r.label).join(', ')}
      </div>
    </Card>
  );
}

// ── Capacity & follow-up ──────────────────────────────────────────────────

function PeakCard({ data, ...state }: CardStateProps & { data?: CdrDashboard }) {
  const points = data?.peak_ports ?? [];
  const peak = Math.max(0, ...points.map((p) => p.peak));
  const tick = { fill: '#8193ad', fontSize: 10, fontFamily: 'Dashboard, sans-serif' };

  return (
    <Card
      {...state}
      span={12}
      title="Peak ports"
      subtitle={BUCKET_LABEL[data?.coverage.bucket ?? ''] ?? 'Concurrent call activity over the reporting period'}
      isEmpty={points.length === 0}
      bodyClassName="py-3.5"
      extra={
        <div className="text-right">
          <strong className="text-[21px] font-medium leading-[1.1] tracking-[-0.4px] tabular-nums text-[#4d617f] dark:text-zinc-100">
            {fmt(peak)}
          </strong>
          <small className="mt-[5px] block text-[10px] text-[#a1adbe] dark:text-zinc-500">Peak · concurrent ports</small>
        </div>
      }
    >
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={points} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="vd-area-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4aa9d7" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#4aa9d7" stopOpacity={0.025} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#eaf0f6" strokeDasharray="3 5" className="dark:opacity-20" />
          <XAxis dataKey="bucket" tick={tick} tickLine={false} axisLine={false} minTickGap={40} interval="preserveStartEnd" />
          <YAxis tick={tick} tickLine={false} axisLine={false} width={44} allowDecimals={false} tickFormatter={compact} />
          <Tooltip
            cursor={{ stroke: '#8bbbd8', strokeDasharray: '3 3' }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className="vd-design min-w-[220px] rounded-[10px] border border-white/[0.08] bg-[#1f2b45f7] px-3.5 py-3 text-white shadow-[0_12px_35px_#15253d2d]">
                  <TipBody
                    eyebrow="Peak ports"
                    title={String(label)}
                    value={Number(payload[0].value)}
                    share="concurrent ports"
                  />
                </div>
              ) : null
            }
          />
          <Area
            type="monotone"
            dataKey="peak"
            stroke={COLORS.line}
            strokeWidth={2}
            fill="url(#vd-area-fill)"
            dot={false}
            activeDot={{ r: 4, fill: '#298bbf', stroke: '#fff', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
      <div className="mt-2.5 ml-11 flex items-center gap-5 text-[10px] text-[#9aa6b8] dark:text-zinc-500">
        <span className="flex items-center gap-[5px]">
          <Dot color={COLORS.blue} />
          Concurrent ports
        </span>
        <span>Timezone: IST</span>
      </div>
    </Card>
  );
}

const blastNumber = (label: string) => Number(label.match(/(\d+)\s*$/)?.[1] ?? 0);

function aidSections(breakdown: ReblastAidDatum[], label: string) {
  const aids = breakdown.find((b) => b.label === label)?.aid ?? [];
  const connected = aids.reduce((t, a) => t + a.connected, 0);
  const notConnected = aids.reduce((t, a) => t + a.not_connected, 0);
  return [
    {
      title: 'Connection',
      rows: [
        { label: 'Connected', value: connected },
        { label: 'Not connected', value: notConnected },
      ],
    },
    {
      title: 'AID breakdown',
      rows: aids.map((a) => ({
        label: a.label,
        value: a.connected + a.not_connected,
        children: [
          { label: 'Connected', value: a.connected },
          { label: 'Not connected', value: a.not_connected },
        ],
      })),
    },
  ];
}

function RetryCard({
  data,
  total,
  wide,
  ...state
}: CardStateProps & { data?: CdrDashboard; total: number; wide?: boolean }) {
  const stages = [...(data?.reblast.stages ?? [])].sort((a, b) => blastNumber(a.label) - blastNumber(b.label));
  const initial = stages.find((s) => blastNumber(s.label) === 0);
  const retries = stages.filter((s) => blastNumber(s.label) > 0);
  const repeat = data?.reblast.total ?? retries.reduce((t, s) => t + s.value, 0);
  const max = Math.max(...retries.map((s) => s.value), 1);
  const breakdown = data?.reblast_aid ?? [];
  const tip = (s: CategoryDatum) => () => (
    <TipBody
      eyebrow="Repeat attempts"
      title={blastNumber(s.label) === 0 ? 'Initial attempt · Blast 0' : s.label}
      value={s.value}
      share={blastNumber(s.label) === 0 ? `${pct(s.value, total)} of attempts` : `${pct(s.value, repeat)} of retries`}
      sections={aidSections(breakdown, s.label)}
    />
  );

  return (
    <Card
      {...state}
      span={wide ? 12 : 5}
      title="Repeat attempts"
      subtitle="Make every follow-up count"
      footer="Hover a blast for its connection and AID breakdown."
      isEmpty={stages.length === 0}
    >
      <div className="mb-5 flex items-baseline gap-[13px] border-b border-[#e7ebf2] pb-[19px] dark:border-zinc-800/60">
        <strong className="text-[24px] font-semibold tracking-[-0.5px] tabular-nums text-[#445775] dark:text-white">{fmt(repeat)}</strong>
        <span className="text-[11px] text-[#98a4b5] dark:text-zinc-500">reblasted</span>
        <small className="ml-auto rounded bg-[#f2f5fa] px-[7px] py-1 text-[10px] text-[#8d9cb1] dark:bg-white/[0.06] dark:text-zinc-400">
          {pct(repeat, total)} of attempts
        </small>
      </div>
      {retries.length > 0 ? (
        <div className="flex flex-col gap-[15px]">
          {retries.map((s, i) => (
            <BarRow
              key={s.label}
              label={s.label}
              value={s.value}
              max={max}
              base={repeat}
              color={colorAt(BLAST_COLORS, i)}
              tip={tip(s)}
              columns="grid-cols-[78px_1fr_60px_44px]"
            />
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-[#95a3b5] dark:text-zinc-500">No reblasts in this scope.</p>
      )}
      {initial && (
        <Hoverable
          tip={tip(initial)}
          className="mt-6 flex w-full items-center justify-between gap-2 rounded-[7px] border border-[#edf1f6] bg-[#f8fafd] p-[11px] text-[11px] text-[#8a99af] dark:border-zinc-800 dark:bg-white/[0.03] dark:text-zinc-400"
        >
          <span>Initial attempt · Blast 0</span>
          <strong className="text-[11px] font-medium tabular-nums text-[#6e7f97] dark:text-zinc-200">{fmt(initial.value)}</strong>
        </Hoverable>
      )}
      <p className="mt-[13px] mb-0 text-[10px] text-[#8a9cb3] dark:text-zinc-500">
        Reblasts use their own scale so small counts stay visible.
      </p>
    </Card>
  );
}

function ReasonsCard({
  data,
  total,
  wide,
  ...state
}: CardStateProps & { data?: CdrDashboard; total: number; wide?: boolean }) {
  const rows = [...(data?.disconnect_reason ?? [])].sort((a, b) => b.value - a.value);
  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <Card
      {...state}
      span={wide ? 12 : 7}
      title="Disconnect reasons"
      subtitle="Reported reasons across all attempts"
      footer="Reason labels and counts are preserved. “Unknown” is a reported category."
      isEmpty={rows.length === 0}
    >
      <div className="flex flex-col gap-3.5">
        {rows.map((r, i) => (
          <BarRow
            key={r.label}
            label={r.label}
            value={r.value}
            max={max}
            base={total}
            color={colorAt(REASON_COLORS, i)}
            columns="grid-cols-[minmax(150px,250px)_1fr_80px_44px]"
            trackHeight="h-2"
            tip={() => (
              <TipBody eyebrow="Disconnect reasons" title={r.label} value={r.value} share={`${pct(r.value, total)} of attempts`} />
            )}
          />
        ))}
      </div>
    </Card>
  );
}
