import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ChevronRight, House, Server } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { SERVICES as SERVICE_META, SERVICE_ORDER } from '../../../components/services';
import type { ServiceId } from '../../../components/services';
import { useHeaderSlot } from '../../../components/HeaderSlot';
import { useAuthStore, useUIStore } from '../../../store';
import { HoverTooltipProvider } from '../../cdr-dashboard/components/attempt-analytics/HoverTooltip';
import { compact, fmt } from '../../cdr-dashboard/components/attempt-analytics/design';
import { useCdrStatus } from '../../campaign-metrics/hooks';
import { analyzePorts } from '../../port-analyzer/api';
import { DEFAULT_FROM, DEFAULT_TO, clock, defaultDay } from '../../port-analyzer/params';
import { DailyVolume } from '../../summary/components/DailyVolume';
import { dayLabel } from '../../summary/format';
import { homeApi } from '../api';
import type { ServiceCard } from '../api';

/** What each card's figures are, in its service's words. */
const FIGURES: Record<ServiceId, { units: string; total: string; barDays: number }> = {
  voicedrop: { units: 'campaigns', total: 'dialed out', barDays: 30 },
  conference: { units: 'conferences', total: 'parties ringed', barDays: 30 },
  // The lake rollup is a few days only.
  multicall: { units: 'conferences', total: 'dial attempts', barDays: 5 },
};

const PORT_TILE = 'bg-[#e6f4fb] text-[#0284c7] dark:bg-sky-500/15 dark:text-sky-300';

/**
 * Home, the app's landing page: four cards — the three services and Port
 * Analyzer — each with its latest figure, a small chart of the days before,
 * and a plain list of links straight to its pages. Kept quiet on purpose:
 * white cards, one accent colour, text links that underline on hover.
 */
export function HomePage() {
  const headerSlot = useHeaderSlot();
  return (
    <HoverTooltipProvider>
      {headerSlot &&
        createPortal(
          <div className="flex min-w-0 items-center gap-2">
            <House className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
            <h1 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">Home</h1>
          </div>,
          headerSlot,
        )}
      <div className="mx-auto max-w-[1500px] px-8 py-9 font-sans">
        <Overview />
      </div>
    </HoverTooltipProvider>
  );
}

/** "admin" → "Admin". */
const displayName = (name: string | null) =>
  (name ?? '').replace(/[._]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();

function Overview() {
  const username = useAuthStore((s) => s.username);
  const overview = useQuery({ queryKey: ['home', 'overview'], queryFn: homeApi.overview, staleTime: 5 * 60_000 });
  const multicall = useQuery({ queryKey: ['home', 'multicall'], queryFn: homeApi.multicall, staleTime: 5 * 60_000 });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name = displayName(username);

  const cards: Record<ServiceId, { card?: ServiceCard; isLoading: boolean; error: Error | null }> = {
    voicedrop: { card: overview.data?.voicedrop, isLoading: overview.isPending, error: overview.error },
    conference: { card: overview.data?.conference, isLoading: overview.isPending, error: overview.error },
    multicall: { card: multicall.data, isLoading: multicall.isPending, error: multicall.error },
  };

  return (
    <>
      <div className="mb-7">
        <p className="text-[13px] text-[#5f6b7c] dark:text-zinc-400">{name ? `${greeting}, ${name}` : greeting}</p>
        <h1 className="mt-1 text-[26px] font-semibold tracking-[-0.4px] text-[#111827] dark:text-white">Welcome to DSNL Analytics</h1>
        <p className="mt-1.5 text-[14px] text-[#5f6b7c] dark:text-zinc-400">Pick a service to see its latest activity, or jump straight to a page.</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-4">
        {SERVICE_ORDER.map((id) => (
          <ServiceCardView key={id} id={id} {...cards[id]} />
        ))}
        <PortCard />
      </div>
    </>
  );
}

// ── The card frame ───────────────────────────────────────────────────────────

function Frame({
  icon: Icon,
  tile,
  title,
  asOf,
  children,
  links,
}: {
  icon: LucideIcon;
  tile: string;
  title: string;
  asOf?: string | null;
  children: ReactNode;
  links: ReactNode;
}) {
  return (
    <article className="flex min-w-0 flex-col rounded-xl border border-[#e3e8ef] bg-white transition-[border-color,box-shadow] hover:border-[#cfd8e3] hover:shadow-[0_4px_16px_rgba(17,24,39,0.06)] dark:border-[#1c2a42] dark:bg-[#0e192c] dark:hover:border-[#2b4266]">
      <header className="flex items-center gap-3 px-5 pt-5">
        <span className={clsx('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', tile)}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[#111827] dark:text-white">{title}</h2>
        {asOf && <span className="shrink-0 text-[11.5px] text-[#6b7685] dark:text-zinc-500">{dayLabel(asOf)}</span>}
      </header>
      <div className="px-5 pt-5 pb-4">{children}</div>
      {/* Straight to each page: plain links, underlined on hover. */}
      <nav className="mt-auto border-t border-[#edf0f4] px-5 py-3.5 dark:border-white/[0.06]">
        <ul className="space-y-0.5">{links}</ul>
      </nav>
    </article>
  );
}

function PageLink({ to, icon: Icon, label, onClick }: { to: string; icon: LucideIcon; label: string; onClick?: () => void }) {
  return (
    <li>
      <Link
        to={to}
        onClick={onClick}
        className="group/link -mx-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13.5px] font-medium text-[#1a56db] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#93b8f3] dark:text-sky-300"
      >
        <Icon className="h-4 w-4 shrink-0 text-[#6b7685] group-hover/link:text-[#1a56db] dark:text-zinc-500 dark:group-hover/link:text-sky-300" />
        <span className="underline-offset-[3px] group-hover/link:underline">{label}</span>
        <ChevronRight className="ml-auto h-4 w-4 text-[#c3cad5] opacity-0 transition-opacity group-hover/link:opacity-100 dark:text-zinc-600" />
      </Link>
    </li>
  );
}

function Headline({ value, label, side, sideLabel }: { value: string; label: string; side?: string; sideLabel?: string }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[30px] font-semibold leading-none tracking-[-0.8px] tabular-nums text-[#111827] dark:text-white">{value}</p>
        <p className="mt-2 text-[12.5px] text-[#5f6b7c] dark:text-zinc-400">{label}</p>
      </div>
      {side && (
        <div className="shrink-0 text-right">
          <p className="text-[17px] font-semibold leading-none tabular-nums text-[#1a56db] dark:text-sky-300">{side}</p>
          <p className="mt-2 text-[11.5px] text-[#6b7685] dark:text-zinc-500">{sideLabel}</p>
        </div>
      )}
    </div>
  );
}

function Problem({ message }: { message: string }) {
  return (
    <p className="flex min-h-[150px] items-start gap-2 text-[12.5px] text-red-600 dark:text-red-400">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="break-words">{message}</span>
    </p>
  );
}

function Skeleton() {
  return (
    <div className="min-h-[150px] animate-pulse space-y-3" aria-hidden>
      <div className="h-8 w-28 rounded-md bg-[#eef1f5] dark:bg-white/[0.06]" />
      <div className="h-3 w-40 rounded bg-[#eef1f5] dark:bg-white/[0.06]" />
      <div className="h-14 rounded-md bg-[#f3f5f8] dark:bg-white/[0.04]" />
    </div>
  );
}

// ── A service ────────────────────────────────────────────────────────────────

function ServiceCardView({ id, card, isLoading, error }: { id: ServiceId; card?: ServiceCard; isLoading: boolean; error: Error | null }) {
  const meta = SERVICE_META[id];
  const info = FIGURES[id];
  const setNavService = useUIStore((s) => s.setNavService);
  const problem = error?.message ?? card?.error;
  const day = card?.day;
  const period = card?.period;

  return (
    <Frame
      icon={meta.icon}
      tile={meta.tile}
      title={meta.name}
      asOf={card?.as_of}
      links={meta.pages.map((p) => (
        <PageLink key={p.key} to={p.path} icon={p.icon} label={p.label} onClick={() => setNavService(id)} />
      ))}
    >
      {isLoading ? (
        <Skeleton />
      ) : problem ? (
        <Problem message={problem} />
      ) : !card?.as_of || !day || !period ? (
        <p className="min-h-[150px] text-[12.5px] leading-relaxed text-[#6b7685] dark:text-zinc-500">
          {card?.window_days
            ? `No ${meta.name} calls in the CDR export's last ${card.window_days} days.`
            : 'No data yet.'}
        </p>
      ) : (
        <>
          <Headline value={compact(day.total)} label={`${info.total} on the latest day`} side={`${day.connect_rate}%`} sideLabel="connected" />
          <div className="mt-5">
            <DailyVolume days={card.series ?? []} asOf={card.as_of} span={info.barDays} totalLabel={info.total} compact />
          </div>
          <p className="mt-3 text-[12px] text-[#6b7685] dark:text-zinc-500">
            {period.label === 'month' ? 'This month' : `The ${period.label}`}:{' '}
            <span className="font-medium text-[#374151] dark:text-zinc-300">
              {fmt(period.units)} {info.units} · {fmt(period.accounts)} accounts
            </span>
          </p>
        </>
      )}
    </Frame>
  );
}

// ── Port Analyzer ────────────────────────────────────────────────────────────

const PORT_LINKS: { label: string; service?: ServiceId }[] = [
  { label: 'Open Port Analyzer' },
  { label: 'Voicedrop ports', service: 'voicedrop' },
  { label: 'Audio Conference ports', service: 'conference' },
  { label: 'MultiCall ports', service: 'multicall' },
];

/** Yesterday's ports in use, 9 AM to 9 PM, every service — the Port Analyzer's own opening view. */
function PortCard() {
  const status = useCdrStatus();
  const maxDate = status.data?.cdr?.date_max ?? null;
  const day = maxDate ? defaultDay(status.data?.cdr?.date_min ?? null, maxDate) : null;
  const ports = useQuery({
    queryKey: ['home', 'ports', day],
    queryFn: () =>
      analyzePorts({
        date: day!,
        service: 'all',
        time_from: DEFAULT_FROM,
        time_to: DEFAULT_TO,
        resolution: '1m',
        group_by: 'none',
        service_providers: [],
        accounts: [],
        locations: [],
        top: 8,
        capacity: null,
      }),
    enabled: !!day,
    staleTime: 10 * 60_000,
  });
  const problem = status.error?.message ?? (status.data && !maxDate ? 'The CDR lake has no days yet.' : null) ?? ports.error?.message;
  const summary = ports.data?.summary;

  return (
    <Frame
      icon={Server}
      tile={PORT_TILE}
      title="Port Analyzer"
      asOf={day}
      links={PORT_LINKS.map((l) => (
        <PageLink key={l.label} to={l.service ? `/analytics/ports?service=${l.service}` : '/analytics/ports'} icon={Server} label={l.label} />
      ))}
    >
      {problem ? (
        <Problem message={problem} />
      ) : status.isPending || ports.isPending || !summary ? (
        <Skeleton />
      ) : (
        <>
          <Headline
            value={fmt(summary.peak)}
            label="peak ports in use, 9 AM – 9 PM"
            side={clock(summary.peak_at).slice(0, 5)}
            sideLabel="at the peak"
          />
          <div className="mt-5">
            <Sparkline values={ports.data?.total ?? []} />
          </div>
          <p className="mt-3 text-[12px] text-[#6b7685] dark:text-zinc-500">
            Average <span className="font-medium text-[#374151] dark:text-zinc-300">{fmt(Math.round(summary.avg_ports))} ports</span> ·{' '}
            <span className="font-medium text-[#374151] dark:text-zinc-300">{compact(summary.calls)} calls</span>
          </p>
        </>
      )}
    </Frame>
  );
}

/** A minute-by-minute line folded to its highest point per slot, drawn to fit the card. */
function Sparkline({ values }: { values: number[] }) {
  const { line, area } = useMemo(() => {
    const slots = 72;
    const size = Math.max(1, Math.ceil(values.length / slots));
    const folded: number[] = [];
    for (let i = 0; i < values.length; i += size) folded.push(Math.max(...values.slice(i, i + size)));
    const top = Math.max(1, ...folded);
    const points = folded.map((v, i) => [(i / Math.max(1, folded.length - 1)) * 100, 54 - (v / top) * 50] as const);
    const path = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    return { line: path, area: `${path} L100,56 L0,56 Z` };
  }, [values]);
  return (
    <svg viewBox="0 0 100 56" preserveAspectRatio="none" className="h-14 w-full" aria-hidden>
      <path d={area} className="fill-[#0284c7]/10 dark:fill-sky-400/10" />
      <path d={line} fill="none" className="stroke-[#0284c7] dark:stroke-sky-400" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
