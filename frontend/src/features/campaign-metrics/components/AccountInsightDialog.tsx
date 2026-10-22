import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  AudioLines,
  BarChart3,
  CalendarDays,
  ChevronDown,
  CloudUpload,
  Download,
  FileText,
  Loader2,
  MousePointer2,
  Phone,
  PieChart,
  RadioTower,
  Table2,
  Users,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';

import { useContentPanel } from '../../../components/ContentPanelSlot';
import { campaignApi } from '../api';
import type { AccountInsight, CampaignFilter, InsightAid } from '../api';
import { downloadCsv } from '../exportCsv';
import { HoverTooltipProvider, TipBody } from '../../cdr-dashboard/components/attempt-analytics/HoverTooltip';
import { useHover } from '../../cdr-dashboard/components/attempt-analytics/tooltipContext';

interface AccountInsightDialogProps {
  filters: CampaignFilter;
  account: string;
  /** Set when the popup was opened from a CRN sub-row rather than an account row. */
  crn?: string | null;
  onClose: () => void;
}

// ── The redesign's palette for this popup ─────────────────────────────────

const C = {
  navy: '#212665',
  blue: '#5aa9ec',
  orange: '#ef9a5f',
  green: '#2cc29b',
  red: '#ec6f72',
  violet: '#8f8ff0',
  pale: '#bcc9dc',
};

const STAGES = [
  { key: 'proceeded', label: 'Started', color: C.blue },
  { key: 'alert', label: 'Ringing', color: C.orange },
  { key: 'connected', label: 'Connected', color: C.green },
  { key: 'ended', label: 'Ended', color: C.red },
] as const;

const SERVICE: Record<CampaignFilter['service'], { label: string; icon: LucideIcon }> = {
  voicedrop: { label: 'VoiceDrop', icon: AudioLines },
  conference: { label: 'Conference', icon: Users },
  multicall: { label: 'MultiCall', icon: Phone },
};

const nf = new Intl.NumberFormat('en-US');
const fmt = (n: number) => nf.format(Math.round(n || 0));
const compact = (n: number) =>
  n >= 1e6 ? `${Number((n / 1e6).toFixed(1))}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : fmt(n);
const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const CARD = 'rounded-[14px] border border-[#e7ebf2] bg-white dark:border-zinc-800/60 dark:bg-surface-dark';
const INK = 'text-[#1c2a40] dark:text-white';
const MUTED = 'text-[#6f7d93] dark:text-zinc-400';

/**
 * The per-account (or per-CRN) campaign analytics popup, in the redesign:
 * four headline figures, then failed attempts, disconnect reasons and carrier
 * performance as separate cards, then the blast and AID breakdown.
 */
export function AccountInsightDialog({ filters, account, crn, onClose }: AccountInsightDialogProps) {
  const panel = useContentPanel();
  const { data, isPending, error } = useQuery({
    queryKey: ['campaign-insight', filters.date, filters.service, account, crn ?? null],
    queryFn: () => campaignApi.accountInsight(filters, account, crn),
    staleTime: 60_000,
  });

  // Escape closes, and the page behind stops scrolling while this is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const service = SERVICE[filters.service];
  const ServiceIcon = service.icon;

  const overlay = (
    // Centred on the floating content panel, not on the window: the backdrop is
    // absolute inside the panel so it stops at the card's edges.
    <div
      className={clsx(
        'inset-0 z-50 flex items-center justify-center bg-[#11234240] p-4 backdrop-blur-[2px]',
        panel ? 'absolute' : 'fixed',
      )}
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Campaign analytics for account ${account}`}
        onClick={(e) => e.stopPropagation()}
        className={clsx(
          'vd-design flex w-full max-w-5xl flex-col overflow-hidden rounded-[18px] bg-white shadow-[0_20px_60px_#142b4330] dark:bg-canvas-dark',
          panel ? 'max-h-full' : 'max-h-[92vh]',
        )}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[#eef1f6] px-6 pt-5 pb-4 dark:border-zinc-800/60">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[1.6px] text-[#0a9ed5]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#0a9ed5]" />
              CAMPAIGN ANALYTICS
            </p>
            <h2 className={clsx('mt-1.5 truncate text-[22px] font-semibold leading-tight tracking-[-0.4px]', INK)}>
              Account {account}
              {crn && <span className="text-[#8a96aa] dark:text-zinc-500"> · CRN {crn}</span>}
            </h2>
            <p className={clsx('mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]', MUTED)}>
              <span className="flex items-center gap-2 font-medium text-[#3b4a63] dark:text-zinc-300">
                <ServiceIcon className="h-4 w-4 text-[#0a9ed5]" />
                {service.label}
              </span>
              <span className="h-4 w-px bg-[#d9dfe8] dark:bg-zinc-700" />
              <span className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4" />
                {longDate(filters.date)}
              </span>
              {/* Conference and Multicall only — from the CODR join. */}
              {data?.cpin && <span>CPIN {data.cpin}</span>}
              {data?.conf_num && <span>Conf Num {data.conf_num}</span>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={() => data && exportReport(data, filters, account, crn)}
              disabled={!data}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#212665] px-4 text-[13px] font-medium text-white shadow-[0_3px_6px_#21266520] transition-colors hover:bg-[#303b7e] disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Export report
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#e3e8f0] text-[#7d8aa0] transition-colors hover:bg-[#f3f6fa] hover:text-[#212665] dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto bg-[#f8fafc] px-5 py-5 dark:bg-canvas-dark">
          {isPending ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-7 w-7 animate-spin text-[#5aa9ec]" />
            </div>
          ) : error ? (
            <div className="flex items-start gap-3 py-6 text-sm text-red-600 dark:text-red-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="break-words">{(error as Error).message}</p>
            </div>
          ) : (
            <HoverTooltipProvider>
              <InsightBody insight={data!} />
            </HoverTooltipProvider>
          )}
        </div>
      </div>
    </div>
  );

  return panel ? createPortal(overlay, panel) : overlay;
}

function InsightBody({ insight }: { insight: AccountInsight }) {
  return (
    <div className="space-y-4">
      <HeadlineCards summary={insight.summary} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <FailedCard failed={insight.failed} />
        <ReasonsCard reasons={insight.disconnect_reasons} />
        <CarrierCard carriers={insight.carriers} />
      </div>
      {insight.blasts.length > 0 && <BlastCard blasts={insight.blasts} />}
    </div>
  );
}

// ── Headline figures ──────────────────────────────────────────────────────

// The headline cards keep the main branch's design — the app's own font
// (font-sans, not the redesign's Dashboard face), an 11px label, a 24px bold
// figure and a 10px note beside a coloured icon tile — which reads more easily
// than the larger redesign tiles did.
function HeadlineCards({ summary }: { summary: AccountInsight['summary'] }) {
  const perUploaded = summary.total_uploaded > 0 ? (summary.dial_attempts / summary.total_uploaded).toFixed(2) : '—';

  return (
    <div className="grid grid-cols-1 gap-3 font-sans sm:grid-cols-2 xl:grid-cols-4">
      <Stat
        icon={CloudUpload}
        tile="bg-blue-50 text-blue-500 dark:bg-blue-500/15 dark:text-blue-400"
        label="Total uploaded"
        value={summary.total_uploaded.toLocaleString()}
        note="Numbers uploaded"
      />
      <Stat
        icon={Phone}
        tile="bg-violet-50 text-violet-500 dark:bg-violet-500/15 dark:text-violet-400"
        label="Dial attempts"
        value={summary.dial_attempts.toLocaleString()}
        note={`${perUploaded} attempts per uploaded`}
      />
      <Stat
        icon={Users}
        tile="bg-emerald-50 text-emerald-500 dark:bg-emerald-500/15 dark:text-emerald-400"
        label="Connected users"
        value={summary.connected_users.toLocaleString()}
        // Counted independently, so these can exceed the headline where a
        // conferee connected on both a dial-in and a dial-out leg.
        note={`Dial In: ${summary.connected_dial_in.toLocaleString()} · Dial Out: ${summary.connected_dial_out.toLocaleString()}`}
      />
      <div className="flex h-full items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3.5 dark:border-zinc-800/60 dark:bg-surface-dark">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Connect %</p>
          <p className="text-2xl font-bold leading-tight tabular-nums text-zinc-900 dark:text-white">
            {summary.connect_percentage.toFixed(2)}%
          </p>
          <p className="truncate text-[10px] text-zinc-400 dark:text-zinc-500">of numbers uploaded</p>
        </div>
        <ConnectRing percentage={summary.connect_percentage} />
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  tile,
  label,
  value,
  note,
}: {
  icon: LucideIcon;
  /** Tailwind classes for the icon tile — the only colour on the card. */
  tile: string;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="flex h-full items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3.5 dark:border-zinc-800/60 dark:bg-surface-dark">
      <span className={clsx('inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', tile)}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
        <p className="text-2xl font-bold leading-tight tabular-nums text-zinc-900 dark:text-white">{value}</p>
        <p className="truncate text-[10px] text-zinc-400 dark:text-zinc-500" title={note}>
          {note}
        </p>
      </div>
    </div>
  );
}

/** The main branch's connect-rate ring, in blue rather than green. */
function ConnectRing({ percentage }: { percentage: number }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const filled = (Math.min(Math.max(percentage, 0), 100) / 100) * circumference;

  return (
    <svg width="64" height="64" viewBox="0 0 64 64" className="shrink-0" aria-hidden="true">
      <circle cx="32" cy="32" r={radius} fill="none" strokeWidth="7" className="stroke-blue-500/20" />
      <circle
        cx="32"
        cy="32"
        r={radius}
        fill="none"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference}`}
        // Start the arc at 12 o'clock rather than 3 o'clock.
        transform="rotate(-90 32 32)"
        className="stroke-blue-500"
      />
      <text x="32" y="36" textAnchor="middle" className="fill-blue-600 dark:fill-blue-400" fontSize="14" fontWeight="700">
        {Math.round(percentage)}%
      </text>
    </svg>
  );
}

// ── Failed attempts, disconnect reasons, carriers ─────────────────────────

function CardHeading({
  icon: Icon,
  title,
  subtitle,
  extra,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f1effd] text-[#7c6fe0] dark:bg-violet-500/15 dark:text-violet-300">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <h3 className={clsx('text-[14px] font-medium leading-snug', INK)}>{title}</h3>
          {subtitle && <div className={clsx('mt-0.5 text-[12px]', MUTED)}>{subtitle}</div>}
        </div>
      </div>
      {extra}
    </div>
  );
}

interface BarItem {
  label: string;
  /** Bar length, 0–100. */
  share: number;
  /** The count — shown in the hover readout, not in the row. */
  value: number;
  /** The percentage shown last. */
  percentage: string;
  color: string;
  tip: () => ReactNode;
}

/**
 * One row per item — label, percentage and a bar of that percentage — the
 * layout all three breakdown cards share. The counts are in the hover readout.
 */
function BarRows({ items }: { items: BarItem[] }) {
  return (
    <div className="mt-3 space-y-1">
      {items.map((item) => (
        <BarRowItem key={item.label} item={item} />
      ))}
    </div>
  );
}

function BarRowItem({ item }: { item: BarItem }) {
  const hover = useHover(item.tip);
  return (
    <div
      {...hover}
      className="cursor-default rounded-md px-2 py-2 text-[13px] outline-none transition-colors hover:bg-[#f4f7fb] focus-visible:ring-2 focus-visible:ring-[#5aa9ec] dark:hover:bg-white/[0.04]"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[#3b4a63] dark:text-zinc-300" title={item.label}>
          {item.label}
        </span>
        <span className={clsx('shrink-0 font-medium tabular-nums', INK)}>{item.percentage}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#eef1f6] dark:bg-white/[0.06]">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(Math.min(item.share, 100), item.value > 0 ? 1 : 0)}%`, background: item.color }}
        />
      </div>
    </div>
  );
}

function BreakdownCard({
  icon,
  title,
  subtitle,
  extra,
  items,
  empty,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: ReactNode;
  extra?: ReactNode;
  items: BarItem[];
  empty: string;
}) {
  return (
    <section className={clsx(CARD, 'flex flex-col px-5 py-4')}>
      <CardHeading icon={icon} title={title} subtitle={subtitle} extra={extra} />
      {items.length > 0 ? <BarRows items={items} /> : <p className={clsx('mt-4 text-[13px]', MUTED)}>{empty}</p>}
    </section>
  );
}

function FailedCard({ failed }: { failed: AccountInsight['failed'] }) {
  const rows = [
    { label: 'Never rang', value: failed.never_rang, percentage: failed.never_rang_percentage, color: C.orange },
    {
      label: 'Rang, unanswered',
      value: failed.rang_unanswered,
      percentage: failed.rang_unanswered_percentage,
      color: C.orange,
    },
  ];
  return (
    <BreakdownCard
      icon={FileText}
      title="Failed attempts"
      subtitle={`${fmt(failed.total)} total failures`}
      empty="No failed attempts."
      items={
        failed.total > 0
          ? rows.map((r) => ({
              label: r.label,
              share: r.percentage,
              value: r.value,
              percentage: `${r.percentage.toFixed(1)}%`,
              color: r.color,
              tip: () => (
                <TipBody
                  eyebrow="Failed attempts"
                  title={r.label}
                  value={r.value}
                  share={`${r.percentage.toFixed(1)}% of failures`}
                  sections={[
                    {
                      title: 'All failures',
                      base: failed.total,
                      rows: rows.map((x) => ({ label: x.label, value: x.value })),
                    },
                  ]}
                />
              ),
            }))
          : []
      }
    />
  );
}

const reasonLabel = (reason: string) => (reason === 'Other' ? 'Other' : `Reason ${reason}`);

function ReasonsCard({ reasons }: { reasons: AccountInsight['disconnect_reasons'] }) {
  const total = reasons.reduce((t, r) => t + r.count, 0);
  return (
    <BreakdownCard
      icon={PieChart}
      title="Disconnect reasons"
      subtitle="Share of all failures"
      empty="No failed attempts to break down."
      items={reasons.map((r) => ({
        label: reasonLabel(r.reason),
        share: r.percentage,
        value: r.count,
        percentage: `${r.percentage.toFixed(1)}%`,
        color: C.blue,
        tip: () => (
          <TipBody
            eyebrow="Disconnect reasons"
            title={reasonLabel(r.reason)}
            value={r.count}
            share={`${r.percentage.toFixed(1)}% of failures`}
            sections={[
              {
                title: 'All reasons',
                base: total,
                rows: reasons.map((x) => ({ label: reasonLabel(x.reason), value: x.count })),
              },
            ]}
          />
        ),
      }))}
    />
  );
}

function CarrierCard({ carriers: raw }: { carriers: AccountInsight['carriers'] }) {
  // Tolerates a backend that predates the attempt counts, rather than breaking the popup.
  const carriers = raw.map((c) => ({ ...c, attempts: c.attempts ?? 0, attempt_percentage: c.attempt_percentage ?? 0 }));
  return (
    <BreakdownCard
      icon={RadioTower}
      title="Carrier performance"
      subtitle="Share of all dial attempts"
      empty="No carrier data."
      extra={
        carriers.length > 0 && (
          <span className="shrink-0 rounded-md border border-[#e3e8f0] px-2 py-0.5 text-[12px] text-[#5b6a82] dark:border-zinc-700 dark:text-zinc-400">
            {carriers.length} {carriers.length === 1 ? 'carrier' : 'carriers'}
          </span>
        )
      }
      items={carriers.map((c) => ({
        label: `Carrier ${c.carrier}`,
        share: c.attempt_percentage,
        value: c.attempts,
        percentage: c.attempts > 0 && c.attempt_percentage < 0.1 ? '<0.1%' : `${c.attempt_percentage.toFixed(1)}%`,
        color: C.green,
        tip: () => (
          <TipBody
            eyebrow="Carrier performance"
            title={`Carrier ${c.carrier}`}
            value={c.attempts}
            share={`${c.attempt_percentage.toFixed(2)}% of attempts`}
            sections={[
              {
                title: `Numbers dialled · ${fmt(c.total)}`,
                base: c.total,
                rows: [
                  { label: 'Connected', value: c.connected, share: `${c.connect_percentage.toFixed(2)}%` },
                  {
                    label: 'Not connected',
                    value: c.total - c.connected,
                    share: `${(100 - c.connect_percentage).toFixed(2)}%`,
                  },
                ],
              },
            ]}
          />
        ),
      }))}
    />
  );
}

// ── Blast and AID breakdown ───────────────────────────────────────────────

function BlastCard({ blasts }: { blasts: AccountInsight['blasts'] }) {
  const [blastLabel, setBlastLabel] = useState('all');
  const [aidLabel, setAidLabel] = useState('all');
  const [view, setView] = useState<'chart' | 'table'>('chart');

  // All blasts and all AIDs unless narrowed: one chart (or table) per blast.
  const shown = (blastLabel === 'all' ? blasts : blasts.filter((b) => b.label === blastLabel))
    .map((b) => ({ label: b.label, aids: aidLabel === 'all' ? b.aids : b.aids.filter((a) => a.label === aidLabel) }))
    .filter((b) => b.aids.length > 0);
  // The AID choices are every AID any shown blast has.
  const aidOptions = [
    ...new Set((blastLabel === 'all' ? blasts : blasts.filter((b) => b.label === blastLabel)).flatMap((b) => b.aids.map((a) => a.label))),
  ].sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')));

  return (
    <section className={clsx(CARD, 'px-5 py-4')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <BarChart3 className="mt-1 h-6 w-6 text-[#4b8fdc]" />
          <div>
            <h3 className={clsx('text-[14px] font-medium', INK)}>Blast &amp; AID breakdown</h3>
            <p className={clsx('mt-0.5 text-[12px]', MUTED)}>Compare the call stages across attempts</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={blastLabel}
            onChange={(v) => {
              setBlastLabel(v);
              setAidLabel('all');
            }}
            options={[{ value: 'all', label: 'All blasts' }, ...blasts.map((b) => ({ value: b.label, label: b.label }))]}
          />
          <Select
            value={aidLabel}
            onChange={setAidLabel}
            options={[{ value: 'all', label: 'All AIDs' }, ...aidOptions.map((a) => ({ value: a, label: a }))]}
          />
          <div className="flex rounded-lg border border-[#e3e8f0] p-1 dark:border-zinc-700">
            {(
              [
                ['chart', 'Chart', BarChart3],
                ['table', 'Table', Table2],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                aria-pressed={view === id}
                className={clsx(
                  'inline-flex h-8 items-center gap-1.5 rounded-md px-3.5 text-[13px] font-medium transition-colors',
                  view === id
                    ? 'bg-[#eaf4fd] text-[#2f7fd0] dark:bg-blue-500/15 dark:text-blue-300'
                    : 'text-[#5b6a82] hover:text-[#212665] dark:text-zinc-400 dark:hover:text-white',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === 'chart' ? (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-[#5b6a82] dark:text-zinc-400">
            {STAGES.map((s) => (
              <span key={s.key} className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 rounded" style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
            <span className="flex items-center gap-2">
              <span className="w-6 border-t-2 border-dashed border-[#5b6a82] dark:border-zinc-400" />
              Total initiated (dial-out)
            </span>
          </div>
          {shown.map((b) => (
            <div key={b.label} className="mt-4">
              {shown.length > 1 && <p className={clsx('text-[13px] font-medium', INK)}>{b.label}</p>}
              <BlastChart blast={b.label} aids={b.aids} />
            </div>
          ))}
          <p className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-[#f6f8fb] py-2.5 text-[13px] text-[#7d8aa0] dark:bg-white/[0.03] dark:text-zinc-500">
            <MousePointer2 className="h-4 w-4" />
            Hover over a bar to see the detailed breakdown
          </p>
        </>
      ) : (
        shown.map((b) => (
          <div key={b.label} className="mt-5">
            {shown.length > 1 && <p className={clsx('mb-2 text-[13px] font-medium', INK)}>{b.label}</p>}
            <BlastTable aids={b.aids} />
          </div>
        ))
      )}
    </section>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 min-w-[124px] cursor-pointer appearance-none rounded-lg border border-[#e3e8f0] bg-white pr-9 pl-4 text-[13px] text-[#3b4a63] outline-none focus:border-[#5aa9ec] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-[#7d8aa0]" />
    </label>
  );
}

function niceTicks(max: number): number[] {
  if (max <= 0) return [0];
  const raw = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? magnitude * 10;
  // Up to the first tick at or above the largest value, so no bar runs past
  // the top of the plot.
  const ticks = [0];
  while (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

const W = 1000;
const H = 250;
const PAD = { top: 34, right: 10, bottom: 30, left: 52 };

/**
 * Four bars per AID — started, ringing, connected, ended — under a dashed cap
 * at that AID's dial-out total. Hovering a group highlights it and shows its
 * figures.
 */
function BlastChart({ blast, aids }: { blast: string; aids: InsightAid[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const ticks = useMemo(
    () => niceTicks(Math.max(1, ...aids.map((a) => Math.max(a.total_initiated, a.proceeded, a.alert, a.connected, a.ended)))),
    [aids],
  );
  const top = ticks[ticks.length - 1];
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const groupW = plotW / Math.max(aids.length, 1);
  const barW = Math.min((groupW * 0.72) / 4, 56);
  const gap = Math.min(barW * 0.12, 6);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const active = hovered !== null ? aids[hovered] : null;

  return (
    <div className="relative mt-2" onMouseLeave={() => setHovered(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${blast} by AID`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-[#edf1f6] dark:stroke-white/[0.06]" />
            <text x={PAD.left - 12} y={y(t) + 4} textAnchor="end" fontSize={12} className="fill-[#5b6a82] dark:fill-zinc-500">
              {compact(t)}
            </text>
          </g>
        ))}
        {aids.map((aid, i) => {
          const x0 = PAD.left + i * groupW;
          const barsW = 4 * barW + 3 * gap;
          const start = x0 + (groupW - barsW) / 2;
          return (
            <g key={aid.label} onMouseEnter={() => setHovered(i)}>
              <rect
                x={x0 + groupW * 0.04}
                y={PAD.top - 30}
                width={groupW * 0.92}
                height={plotH + 30}
                className={clsx(hovered === i ? 'fill-[#eef6fd] dark:fill-white/[0.04]' : 'fill-transparent')}
              />
              {STAGES.map((s, j) => {
                const v = aid[s.key];
                const x = start + j * (barW + gap);
                return (
                  <g key={s.key}>
                    <rect x={x} y={y(v)} width={barW} height={Math.max(PAD.top + plotH - y(v), 0)} rx={4} fill={s.color} />
                    <text x={x + barW / 2} y={y(v) - 7} textAnchor="middle" fontSize={11} className="fill-[#3b4a63] dark:fill-zinc-300">
                      {compact(v)}
                    </text>
                  </g>
                );
              })}
              <line
                x1={start}
                x2={start + barsW}
                y1={y(aid.total_initiated)}
                y2={y(aid.total_initiated)}
                strokeDasharray="5 4"
                strokeWidth={1.5}
                className="stroke-[#3b4a63] dark:stroke-zinc-400"
              />
              <text
                x={start + barsW / 2}
                y={y(aid.total_initiated) - 8}
                textAnchor="middle"
                fontSize={11}
                className="fill-[#3b4a63] dark:fill-zinc-300"
              >
                {fmt(aid.total_initiated)}
              </text>
              <text x={x0 + groupW / 2} y={H - 10} textAnchor="middle" fontSize={12} className="fill-[#3b4a63] dark:fill-zinc-400">
                {aid.label}
              </text>
            </g>
          );
        })}
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} className="stroke-[#d9dfe8] dark:stroke-zinc-700" />
      </svg>

      {active && hovered !== null && (
        <div
          className="pointer-events-none absolute z-10 w-[220px] -translate-x-1/2 -translate-y-full rounded-lg bg-[#1f2b45f2] px-3.5 py-3 text-[12px] text-white shadow-[0_12px_35px_#15253d40]"
          // Just above the group's tallest label, so its own bars stay readable.
          style={{
            left: `${((PAD.left + (hovered + 0.5) * groupW) / W) * 100}%`,
            top: `${((y(Math.max(active.total_initiated, ...STAGES.map((s) => active[s.key]))) - 26) / H) * 100}%`,
          }}
        >
          <p className="mb-1.5 font-semibold">
            {active.label} · {blast}
          </p>
          {STAGES.map((s) => (
            <p key={s.key} className="mt-1 flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[#d5dcea]">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="font-semibold tabular-nums">{fmt(active[s.key])}</span>
            </p>
          ))}
          <p className="mt-2 flex items-center justify-between gap-3 border-t border-white/10 pt-2">
            <span className="flex items-center gap-2 text-[#d5dcea]">
              <span className="w-3 border-t-[1.5px] border-dashed border-[#d5dcea]" />
              Total initiated
            </span>
            <span className="font-semibold tabular-nums">{fmt(active.total_initiated)}</span>
          </p>
          <span className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 bg-[#1f2b45f2]" />
        </div>
      )}
    </div>
  );
}

function BlastTable({ aids }: { aids: InsightAid[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[#eef1f6] dark:border-zinc-800/60">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-[#f9fbfd] dark:bg-white/[0.02]">
            <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.8px] text-[#7d8aa0]">AID</th>
            {STAGES.map((s) => (
              <th key={s.key} className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-[0.8px] text-[#7d8aa0]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                  {s.label}
                </span>
              </th>
            ))}
            <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-[0.8px] text-[#7d8aa0]">Total initiated</th>
          </tr>
        </thead>
        <tbody>
          {aids.map((aid) => (
            <tr key={aid.label} className="border-t border-[#eef1f6] dark:border-zinc-800/60">
              <td className={clsx('px-4 py-3 font-medium', INK)}>{aid.label}</td>
              {STAGES.map((s) => (
                <td key={s.key} className="px-4 py-3 text-right tabular-nums text-[#3b4a63] dark:text-zinc-300">
                  {fmt(aid[s.key])}
                </td>
              ))}
              <td className={clsx('px-4 py-3 text-right font-semibold tabular-nums', INK)}>{fmt(aid.total_initiated)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Export ────────────────────────────────────────────────────────────────

/** Everything the popup shows, as one CSV: section, item, value, share. */
function exportReport(insight: AccountInsight, filters: CampaignFilter, account: string, crn?: string | null) {
  const { summary, failed, disconnect_reasons, blasts } = insight;
  const carriers = insight.carriers.map((c) => ({ ...c, attempts: c.attempts ?? 0, attempt_percentage: c.attempt_percentage ?? 0 }));
  const rows: (string | number)[][] = [
    ['Summary', 'Total uploaded', summary.total_uploaded, ''],
    ['Summary', 'Dial attempts', summary.dial_attempts, ''],
    ['Summary', 'Connected users', summary.connected_users, ''],
    ['Summary', 'Connected dial in', summary.connected_dial_in, ''],
    ['Summary', 'Connected dial out', summary.connected_dial_out, ''],
    ['Summary', 'Connection rate', '', `${summary.connect_percentage.toFixed(2)}%`],
    ['Failed attempts', 'Total', failed.total, ''],
    ['Failed attempts', 'Never rang', failed.never_rang, `${failed.never_rang_percentage.toFixed(1)}%`],
    ['Failed attempts', 'Rang, unanswered', failed.rang_unanswered, `${failed.rang_unanswered_percentage.toFixed(1)}%`],
    ...disconnect_reasons.map((r) => [
      'Disconnect reasons',
      r.reason === 'Other' ? 'Other' : `Reason ${r.reason}`,
      r.count,
      `${r.percentage.toFixed(1)}%`,
    ]),
    ...carriers.flatMap((c) => [
      ['Carrier performance', `Carrier ${c.carrier} · attempts`, c.attempts, `${c.attempt_percentage.toFixed(2)}%`],
      ['Carrier performance', `Carrier ${c.carrier} · connected`, `${c.connected} of ${c.total}`, `${c.connect_percentage.toFixed(2)}%`],
    ]),
    ...blasts.flatMap((b) =>
      b.aids.flatMap((a) => [
        ...STAGES.map((s) => [`${b.label} · ${a.label}`, s.label, a[s.key], '']),
        [`${b.label} · ${a.label}`, 'Total initiated', a.total_initiated, ''],
      ]),
    ),
  ];
  const name = `campaign-${filters.service}-${account}${crn ? `-${crn}` : ''}-${filters.date}.csv`;
  downloadCsv(name, ['Section', 'Item', 'Value', 'Share'], rows);
}
