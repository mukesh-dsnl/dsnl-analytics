import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2, X } from 'lucide-react';

import { campaignApi } from '../api';
import type { AccountInsight, CampaignFilter } from '../api';
import { useChartTheme } from '../../cdr-dashboard/chartTheme';
import { BlastAidChart, BlastAidLegend } from './BlastAidChart';

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Campaign insight for account ${account}`}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl max-h-[88vh] flex flex-col bg-white dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800/60 shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-white truncate">
              Account {account}
              {crn && <span className="text-zinc-400 dark:text-zinc-500"> · CRN {crn}</span>}
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{filters.date}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800/50 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-6">
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
}

function InsightBody({ insight }: { insight: AccountInsight }) {
  const { summary, failed, disconnect_reasons, carriers, blasts } = insight;

  return (
    <>
      <StatStrip summary={summary} />

      <Section title={`Failed attempts (${failed.total.toLocaleString()} total)`}>
        <SplitBar
          segments={[
            {
              label: `Never rang (no ALERT) — ${failed.never_rang.toLocaleString()}`,
              value: failed.never_rang,
              percentage: failed.never_rang_percentage,
              slot: 7,
            },
            {
              label: `Rang, unanswered — ${failed.rang_unanswered.toLocaleString()}`,
              value: failed.rang_unanswered,
              percentage: failed.rang_unanswered_percentage,
              slot: 3,
            },
          ]}
        />
      </Section>

      {disconnect_reasons.length > 0 && (
        <Section title="Disconnect reasons (share of all failures)">
          <SplitBar
            segments={disconnect_reasons.map((r, index) => ({
              label:
                r.reason === 'Other'
                  ? `Other — ${r.count.toLocaleString()}`
                  : `Reason ${r.reason} — ${r.count.toLocaleString()}`,
              value: r.count,
              percentage: r.percentage,
              slot: [7, 3, 4][index] ?? 4,
            }))}
          />
        </Section>
      )}

      {carriers.length > 0 && (
        <Section title={`Connect % by carrier (used: ${carriers.map((c) => c.carrier).join(' + ')})`}>
          <CarrierBars carriers={carriers} />
        </Section>
      )}

      {blasts.length > 0 && (
        <Section title="Blast and AID breakdown">
          <div className="space-y-1">
            <BlastAidLegend />
            {blasts.map((blast) => (
              <div key={blast.label} className="pt-3">
                <p className="text-xs font-semibold text-zinc-900 dark:text-white mb-1">
                  {blast.label}
                </p>
                <BlastAidChart aids={blast.aids} />
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-semibold text-zinc-900 dark:text-white mb-2.5">{title}</h3>
      {children}
    </section>
  );
}

function StatStrip({ summary }: { summary: AccountInsight['summary'] }) {
  const stats = [
    { label: 'Total uploaded', value: summary.total_uploaded.toLocaleString() },
    { label: 'Dial attempts', value: summary.dial_attempts.toLocaleString() },
    { label: 'Connected users', value: summary.connected_users.toLocaleString() },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="px-4 py-3 rounded-md border border-zinc-200 dark:border-zinc-800/60"
        >
          <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 truncate">
            {stat.label}
          </p>
          <p className="text-xl font-bold text-zinc-900 dark:text-white mt-0.5 tabular-nums">
            {stat.value}
          </p>
        </div>
      ))}
      {/* Connect % is the figure the whole popup exists to explain, so it gets
          the one filled tile rather than sitting as a fourth plain number. */}
      <div className="px-4 py-3 rounded-md border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10">
        <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 truncate">
          Connect %
        </p>
        <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400 mt-0.5 tabular-nums">
          {summary.connect_percentage.toFixed(2)}%
        </p>
      </div>
    </div>
  );
}

interface Segment {
  label: string;
  value: number;
  percentage: number;
  /** Index into the app's validated categorical ramp. */
  slot: number;
}

/**
 * A single 100%-wide bar split into labelled segments, with the legend below.
 *
 * Percentages are printed inside each segment, so the split is readable without
 * relying on the colours to carry it.
 */
function SplitBar({ segments }: { segments: Segment[] }) {
  const theme = useChartTheme();
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) return <p className="text-xs text-zinc-400">Nothing to show.</p>;

  return (
    <div className="space-y-2">
      <div className="flex w-full h-7 rounded-md overflow-hidden gap-0.5">
        {segments
          .filter((s) => s.value > 0)
          .map((segment) => (
            <div
              key={segment.label}
              className="flex items-center justify-center min-w-0"
              style={{
                width: `${(segment.value / total) * 100}%`,
                backgroundColor: theme.categorical[segment.slot],
              }}
              title={`${segment.label} (${segment.percentage.toFixed(1)}%)`}
            >
              <span className="text-[11px] font-semibold text-white truncate px-1">
                {segment.percentage >= 8 ? `${segment.percentage.toFixed(1)}%` : ''}
              </span>
            </div>
          ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-600 dark:text-zinc-400">
        {segments.map((segment) => (
          <span key={segment.label} className="inline-flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ backgroundColor: theme.categorical[segment.slot] }}
            />
            {segment.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function CarrierBars({ carriers }: { carriers: AccountInsight['carriers'] }) {
  const theme = useChartTheme();
  // Scaled against the best performer, not against 100%, so single-digit
  // connect rates stay comparable to each other instead of all reading as
  // slivers against an empty track.
  const peak = Math.max(...carriers.map((c) => c.connect_percentage), 0.01);

  return (
    <div className="space-y-2">
      {carriers.map((carrier, index) => (
        <div key={carrier.carrier} className="flex items-center gap-3">
          <span className="w-20 shrink-0 text-xs text-zinc-600 dark:text-zinc-400">
            Carrier {carrier.carrier}
          </span>
          <div className="flex-1 h-5 min-w-0">
            <div
              className="h-full rounded-sm"
              style={{
                width: `${Math.max((carrier.connect_percentage / peak) * 100, 1)}%`,
                backgroundColor: theme.categorical[index % theme.categorical.length],
              }}
              title={`${carrier.connected.toLocaleString()} of ${carrier.total.toLocaleString()} connected`}
            />
          </div>
          <span className="w-14 shrink-0 text-right text-xs font-semibold text-zinc-900 dark:text-white tabular-nums">
            {carrier.connect_percentage.toFixed(2)}%
          </span>
        </div>
      ))}
    </div>
  );
}
