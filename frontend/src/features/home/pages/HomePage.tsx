import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ArrowRight, House } from 'lucide-react';

import { SERVICES as SERVICE_META, SERVICE_ORDER } from '../../../components/services';
import type { ServiceId } from '../../../components/services';
import { useHeaderSlot } from '../../../components/HeaderSlot';
import { useAuthStore, useUIStore } from '../../../store';
import { HoverTooltipProvider } from '../../cdr-dashboard/components/attempt-analytics/HoverTooltip';
import { compact, fmt } from '../../cdr-dashboard/components/attempt-analytics/design';
import { DailyVolume } from '../../summary/components/DailyVolume';
import { dayLabel, shortDay } from '../../summary/format';
import { homeApi } from '../api';
import type { ServiceCard } from '../api';

/** What each card's figures are, in its service's words, and where they come from. */
const FIGURES: Record<ServiceId, { units: string; total: string; minutes: string | null; source: string; barDays: number }> = {
  voicedrop: { units: 'campaigns', total: 'dialed out', minutes: 'connected minutes', source: 'voicedrop_summary', barDays: 30 },
  conference: { units: 'conferences', total: 'parties ringed', minutes: 'attended minutes', source: 'conference_summary', barDays: 30 },
  // The lake rollup is a few days only.
  multicall: { units: 'conferences', total: 'dial attempts', minutes: null, source: 'CDR lake', barDays: 5 },
};

/**
 * Home, the app's landing page: the three services at a glance. Each card
 * opens its service — the sidebar's switcher then lists that service's
 * pages — and links straight to each of them.
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
      <div className="vd-design mx-auto max-w-[1500px] p-8">
        <Overview />
      </div>
    </HoverTooltipProvider>
  );
}

// ── The overview ────────────────────────────────────────────────────────────

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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] text-[#6a7d96] dark:text-zinc-400">{name ? `${greeting}, ${name}` : greeting}</p>
          <h1 className="mt-0.5 text-[22px] font-semibold tracking-[-0.3px] text-[#16213a] dark:text-white">Services overview</h1>
        </div>
        <p className="text-[12px] text-[#7a899f] dark:text-zinc-500">Each card shows its latest day · the bars, the days before it</p>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {SERVICE_ORDER.map((id) => (
          <ServiceTile key={id} id={id} {...cards[id]} />
        ))}
      </div>
    </>
  );
}

function ServiceTile({
  id,
  card,
  isLoading,
  error,
}: {
  id: ServiceId;
  card?: ServiceCard;
  isLoading: boolean;
  error: Error | null;
}) {
  const meta = SERVICE_META[id];
  const info = FIGURES[id];
  const Icon = meta.icon;
  const navigate = useNavigate();
  const setNavService = useUIStore((s) => s.setNavService);
  const open = (path: string) => {
    setNavService(id);
    navigate(path);
  };
  const problem = error?.message ?? card?.error;
  const day = card?.day;
  const period = card?.period;

  return (
    <article className="group flex min-w-0 flex-col rounded-2xl border border-[#e9eef5] bg-white p-5 shadow-[0_6px_20px_#1c305408] transition-[border-color,box-shadow] hover:border-[#c9daf2] hover:shadow-[0_10px_28px_#1c30540d] dark:border-[#1c2a42] dark:bg-[#0e192c] dark:hover:border-[#2b4266]">
      <header className="flex items-center gap-3">
        <span className={clsx('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', meta.tile)}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold text-[#16213a] dark:text-white">{meta.name}</h2>
          <p className="truncate text-[11px] text-[#7a899f] dark:text-zinc-500">{meta.blurb}</p>
        </div>
        <button
          type="button"
          onClick={() => open(meta.pages[0].path)}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-[#2563eb] transition-colors hover:bg-[#eef4fd] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#42b9e9] dark:text-sky-300 dark:hover:bg-sky-500/10"
        >
          Open
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </button>
      </header>

      {isLoading ? (
        <Skeleton />
      ) : problem ? (
        <p className="mt-5 flex items-start gap-2 text-[12px] text-red-600 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="break-words">{problem}</span>
        </p>
      ) : !card?.as_of || !day || !period ? (
        <p className="mt-5 text-[12px] text-[#8a99ad]">No data yet.</p>
      ) : (
        <>
          <div className="mt-5 flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[28px] font-semibold leading-none tracking-[-0.6px] tabular-nums text-[#16213a] dark:text-white">
                {compact(day.total)}
              </p>
              <p className="mt-1.5 text-[12px] text-[#6a7d96] dark:text-zinc-400">
                {info.total} on <span className="font-medium text-[#35415a] dark:text-zinc-200">{dayLabel(card.as_of)}</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-[18px] font-semibold leading-none tabular-nums text-[#2563eb] dark:text-sky-300">{day.connect_rate}%</p>
              <p className="mt-1.5 text-[11px] text-[#7a899f] dark:text-zinc-500">{compact(day.connected)} connected</p>
            </div>
          </div>

          <div className="mt-4">
            <DailyVolume
              days={card.series ?? []}
              asOf={card.as_of}
              span={info.barDays}
              totalLabel={info.total}
              compact
            />
            <div className="mt-1 flex justify-between text-[10px] text-[#9aa7b8] dark:text-zinc-600">
              <span>{shortDay(shiftIso(card.as_of, -(info.barDays - 1)))}</span>
              <span>{shortDay(card.as_of)}</span>
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-[#eef2f7] pt-3.5 dark:border-white/[0.06]">
            <Stat label={info.units} value={fmt(period.units)} />
            <Stat label="accounts" value={fmt(period.accounts)} />
            {info.minutes ? (
              <Stat label={info.minutes.replace(' minutes', ' min')} value={compact(period.minutes)} />
            ) : (
              <Stat label="connect rate" value={`${period.connect_rate}%`} />
            )}
          </dl>
          <p className="mt-2 text-[10px] text-[#9aa7b8] dark:text-zinc-600">
            {period.label === 'month' ? 'This month so far' : `The ${period.label}`} · from {info.source}
          </p>
        </>
      )}

      {/* Straight to any of the service's pages. */}
      <nav className="mt-4 flex flex-wrap gap-1.5 border-t border-[#eef2f7] pt-3.5 dark:border-white/[0.06]" aria-label={`${meta.name} pages`}>
        {meta.pages.map((p) => (
          <Link
            key={p.key}
            to={p.path}
            onClick={() => setNavService(id)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#e3eaf3] px-2.5 py-1 text-[11px] font-medium text-[#45556e] transition-colors hover:border-[#bcd6ef] hover:bg-[#f3f8fd] hover:text-[#1d4ed8] dark:border-white/[0.08] dark:text-zinc-300 dark:hover:bg-white/[0.04] dark:hover:text-sky-300"
          >
            <p.icon className="h-3.5 w-3.5" />
            {p.label}
          </Link>
        ))}
      </nav>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[10px] uppercase tracking-[0.5px] text-[#8a99ad] dark:text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-semibold tabular-nums text-[#1f2b45] dark:text-zinc-100">{value}</dd>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mt-5 animate-pulse space-y-3" aria-hidden>
      <div className="h-7 w-28 rounded-md bg-[#eef2f7] dark:bg-white/[0.06]" />
      <div className="h-3 w-40 rounded bg-[#eef2f7] dark:bg-white/[0.06]" />
      <div className="h-14 rounded-md bg-[#f3f6fa] dark:bg-white/[0.04]" />
      <div className="grid grid-cols-3 gap-2 pt-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-8 rounded bg-[#f3f6fa] dark:bg-white/[0.04]" />
        ))}
      </div>
    </div>
  );
}

const shiftIso = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  const day = new Date(y, m - 1, d + n);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
};
