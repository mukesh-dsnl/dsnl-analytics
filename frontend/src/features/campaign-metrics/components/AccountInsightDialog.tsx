import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BarChart3, CalendarDays, Loader2, RadioTower, Table2, X } from 'lucide-react';
import clsx from 'clsx';

import { useContentPanel } from '../../../components/ContentPanelSlot';
import { campaignApi } from '../api';
import type { AccountInsight, CampaignFilter } from '../api';
import { useChartTooltip } from '../useChartTooltip';
import { useInsightPalette } from '../insightPalette';
import { BlastAidChart, BlastAidLegend, BlastAidTable } from './BlastAidChart';
import { ChartTooltip } from './ChartTooltip';
import { InsightStats } from './InsightStats';

interface AccountInsightDialogProps {
  filters: CampaignFilter;
  account: string;
  /** Set when the popup was opened from a CRN sub-row rather than an account row. */
  crn?: string | null;
  onClose: () => void;
}

/**
 * The per-row chart popup.
 *
 * Its data is a request of its own (campaignApi.accountInsight), fired only
 * once this dialog mounts — which is the whole reason the icon opens a dialog
 * rather than an inline panel. React Query caches it per row, so reopening the
 * same row is free while a different row is a fresh, narrowly-filtered read.
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

  const overlay = (
    // Centred on the floating content panel, not on the window: the backdrop is
    // absolute inside the panel (which is the containing block) so it stops at
    // the card's edges and leaves the sidebar and the gutter untouched. Until
    // the panel node exists — one render, or a page mounted outside Layout —
    // this falls back to the viewport-fixed behaviour.
    <div
      className={clsx(
        'inset-0 z-50 flex items-center justify-center p-4 bg-black/50',
        panel ? 'absolute' : 'fixed',
      )}
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Campaign insight for account ${account}`}
        onClick={(e) => e.stopPropagation()}
        className={clsx(
          'w-full max-w-5xl flex flex-col bg-zinc-50 dark:bg-[#0c0c0e] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl overflow-hidden',
          // Inside the panel the padded box is already the bound, so the dialog
          // just takes what is there; free-floating it still needs a viewport cap.
          panel ? 'max-h-full' : 'max-h-[90vh]',
        )}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 bg-white dark:bg-[#09090B] border-b border-zinc-200 dark:border-zinc-800/60 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-zinc-900 dark:text-white truncate">
              Account {account}
              {crn && <span className="text-zinc-400 dark:text-zinc-500"> · CRN {crn}</span>}
            </h2>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              <span className="flex items-center gap-1.5">
                <CalendarDays className="w-3.5 h-3.5" />
                {filters.date}
              </span>
              {/* Only Conference and Multicall have these — they come from the
                  CODR join, which Voicedrop never makes. */}
              {data?.cpin && <span>CPIN {data.cpin}</span>}
              {data?.conf_num && <span>Conf Num {data.conf_num}</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800/50 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          {isPending ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          ) : error ? (
            <div className="flex items-start gap-3 py-6 text-sm text-red-600 dark:text-red-400">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="break-words">{(error as Error).message}</p>
            </div>
          ) : (
            <InsightBody insight={data!} />
          )}
        </div>
      </div>
    </div>
  );

  return panel ? createPortal(overlay, panel) : overlay;
}

function InsightBody({ insight }: { insight: AccountInsight }) {
  const { summary, failed, disconnect_reasons, carriers, blasts } = insight;

  return (
    <>
      <InsightStats summary={summary} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title={`Failed attempts (${failed.total.toLocaleString()} total)`}>
          <SplitBar
            segments={[
              {
                label: 'Never rang',
                value: failed.never_rang,
                percentage: failed.never_rang_percentage,
                slot: 0,
              },
              {
                label: 'Rang, unanswered',
                value: failed.rang_unanswered,
                percentage: failed.rang_unanswered_percentage,
                slot: 1,
              },
            ]}
          />
        </Card>

        <Card title="Disconnect reasons (share of all failures)">
          {disconnect_reasons.length > 0 ? (
            <SplitBar
              segments={disconnect_reasons.map((r, index) => ({
                label: r.reason === 'Other' ? 'Other' : `Reason ${r.reason}`,
                value: r.count,
                percentage: r.percentage,
                slot: index,
              }))}
            />
          ) : (
            <p className="text-xs text-zinc-400">No failed attempts to break down.</p>
          )}
        </Card>
      </div>

      {carriers.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4">
          <Card title={`Connect % by carrier (used: ${carriers.map((c) => c.carrier).join(' + ')})`}>
            <CarrierBars carriers={carriers} />
          </Card>
          <div className="flex items-center gap-3 px-5 py-4 rounded-xl border border-zinc-200 dark:border-zinc-800/60 bg-white dark:bg-[#09090B] lg:w-56">
            <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-sky-50 text-sky-500 dark:bg-sky-500/15 dark:text-sky-400 shrink-0">
              <RadioTower className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                Total carriers used
              </p>
              <p className="text-2xl font-bold text-zinc-900 dark:text-white leading-tight tabular-nums">
                {carriers.length}
              </p>
            </div>
          </div>
        </div>
      )}

      {blasts.length > 0 && <BlastSection blasts={blasts} />}
    </>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="px-5 py-4 rounded-xl border border-zinc-200 dark:border-zinc-800/60 bg-white dark:bg-[#09090B]">
      <h3 className="text-xs font-semibold text-zinc-900 dark:text-white mb-3">{title}</h3>
      {children}
    </section>
  );
}

/** Bar chart or the same numbers as a table — the non-visual path to the figures. */
type BlastView = 'chart' | 'table';

function BlastSection({ blasts }: { blasts: AccountInsight['blasts'] }) {
  const [view, setView] = useState<BlastView>('chart');

  return (
    <section className="px-5 py-4 rounded-xl border border-zinc-200 dark:border-zinc-800/60 bg-white dark:bg-[#09090B]">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-xs font-semibold text-zinc-900 dark:text-white mb-2">
            Blast and AID breakdown
          </h3>
          {view === 'chart' && <BlastAidLegend />}
        </div>

        <div className="flex items-center gap-1 p-0.5 rounded-lg border border-zinc-200 dark:border-zinc-800 shrink-0">
          <ViewToggle
            active={view === 'chart'}
            onClick={() => setView('chart')}
            icon={BarChart3}
            label="Bar Chart"
          />
          <ViewToggle
            active={view === 'table'}
            onClick={() => setView('table')}
            icon={Table2}
            label="Table"
          />
        </div>
      </div>

      <div className="space-y-4">
        {blasts.map((blast) => (
          <div key={blast.label}>
            <p className="text-xs font-semibold text-zinc-900 dark:text-white mb-1">
              {blast.label}
            </p>
            {view === 'chart' ? (
              <BlastAidChart aids={blast.aids} />
            ) : (
              <BlastAidTable aids={blast.aids} />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function ViewToggle({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof BarChart3;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
        active
          ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400'
          : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50',
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

interface Segment {
  label: string;
  value: number;
  percentage: number;
  /** Index into the popup's own softened palette — see insightPalette.ts. */
  slot: number;
}

/**
 * A single 100%-wide bar split into labelled segments, with the legend below.
 *
 * Percentages are printed inside each segment and counts sit in the legend, so
 * the split is fully readable without hovering; the tooltip is the precise
 * reading on top of that, not the only one.
 */
function SplitBar({ segments }: { segments: Segment[] }) {
  const palette = useInsightPalette();
  const { tooltip, show, hide } = useChartTooltip();
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) return <p className="text-xs text-zinc-400">Nothing to show.</p>;

  const colorOf = (slot: number) => palette.split[slot] ?? palette.split[palette.split.length - 1];

  return (
    <div className="space-y-3">
      <div className="relative" data-tooltip-root>
        <ChartTooltip state={tooltip} />
        <div className="flex w-full h-8 rounded-lg overflow-hidden gap-0.5" onMouseLeave={hide}>
          {segments
            .filter((s) => s.value > 0)
            .map((segment) => (
              <div
                key={segment.label}
                className="flex items-center justify-center min-w-0 transition-opacity"
                style={{
                  width: `${(segment.value / total) * 100}%`,
                  backgroundColor: colorOf(segment.slot),
                  // Everything except the hovered segment recedes.
                  opacity: tooltip !== null && tooltip.title !== segment.label ? 0.35 : 1,
                }}
                onMouseMove={(e) =>
                  show(e, {
                    title: segment.label,
                    lines: [
                      {
                        label: 'Count',
                        value: segment.value.toLocaleString(),
                        color: colorOf(segment.slot),
                      },
                      { label: 'Share', value: `${segment.percentage.toFixed(1)}%` },
                    ],
                  })
                }
              >
                <span className="text-[11px] font-bold text-white truncate px-1">
                  {segment.percentage >= 8 ? `${segment.percentage.toFixed(1)}%` : ''}
                </span>
              </div>
            ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
        {segments.map((segment) => (
          <div key={segment.label} className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-400 truncate">
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: colorOf(segment.slot) }}
              />
              {segment.label}
            </p>
            <p className="text-xs font-semibold text-zinc-900 dark:text-white tabular-nums mt-0.5">
              {segment.value.toLocaleString()}{' '}
              <span className="font-normal text-zinc-400 dark:text-zinc-500">
                ({segment.percentage.toFixed(1)}%)
              </span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CarrierBars({ carriers }: { carriers: AccountInsight['carriers'] }) {
  const palette = useInsightPalette();
  const { tooltip, show, hide } = useChartTooltip();
  // Scaled against the best performer, not against 100%, so single-digit
  // connect rates stay comparable to each other instead of all reading as
  // slivers against an empty track.
  const peak = Math.max(...carriers.map((c) => c.connect_percentage), 0.01);

  return (
    <div className="relative space-y-2.5" data-tooltip-root onMouseLeave={hide}>
      <ChartTooltip state={tooltip} />
      {carriers.map((carrier, index) => {
        const title = `Carrier ${carrier.carrier}`;
        const color = palette.carrier[index % palette.carrier.length];

        return (
          <div
            key={carrier.carrier}
            className="flex items-center gap-3 transition-opacity"
            style={{ opacity: tooltip !== null && tooltip.title !== title ? 0.35 : 1 }}
          >
            <span className="w-20 shrink-0 text-xs text-zinc-600 dark:text-zinc-400">{title}</span>
            {/* The whole track takes the hover, not just the painted portion —
                a 6% bar is a sliver, and the row is what the reader is aiming at. */}
            <div
              className="flex-1 h-2.5 min-w-0 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden"
              onMouseMove={(e) =>
                show(e, {
                  title,
                  lines: [
                    {
                      label: 'Connected',
                      value: `${carrier.connected.toLocaleString()} of ${carrier.total.toLocaleString()}`,
                      color,
                    },
                    { label: 'Connect %', value: `${carrier.connect_percentage.toFixed(2)}%` },
                  ],
                })
              }
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max((carrier.connect_percentage / peak) * 100, 1)}%`,
                  backgroundColor: color,
                }}
              />
            </div>
            <span className="w-16 shrink-0 text-right text-xs font-semibold text-zinc-900 dark:text-white tabular-nums">
              {carrier.connect_percentage.toFixed(2)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
