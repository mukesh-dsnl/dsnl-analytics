import type { CSSProperties, ReactNode } from 'react';
import { AlertTriangle, Hash, Layers, Loader2, Phone, Timer, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';

import type { CdrDashboard } from '../../api';
import { fmt, pct } from './design';
import { TipBody } from './HoverTooltip';
import { useHover } from './tooltipContext';

interface AttemptKpisProps {
  data: CdrDashboard | undefined;
  isLoading: boolean;
  error: Error | null;
  /**
   * Whether to show Total conferences — one room (CRN + CONF_NUM), which only
   * means something for Conference and MultiCall.
   */
  showConferences: boolean;
}

const isNotConnected = (label: string) => /\b(not|un)[\s_-]*connected/i.test(label);

/**
 * The attempt-metrics headline figures in the redesign: tinted cards, each with
 * the figure, a bar and one line saying what the figure means — connect rate,
 * dial direction, average call length, DTMF uptake, and for Conference and
 * MultiCall the rooms. Hover shows the detail.
 */
export function AttemptKpis({ data, isLoading, error, showConferences }: AttemptKpisProps) {
  const attempts = data?.summary.total_calls ?? 0;
  const participants = data?.summary.total_participants ?? 0;
  const minutes = data?.summary.minutes_usage ?? 0;
  const dtmf = data?.dtmf ?? 0;
  const conferences = data?.summary.total_conferences ?? 0;

  const connected = (data?.connection_status ?? [])
    .filter((r) => !isNotConnected(r.label))
    .reduce((t, r) => t + r.value, 0);
  const directions = data?.call_direction ?? [];
  const dialled = directions.reduce((t, r) => t + r.value, 0);
  const dialOut = directions.find((r) => /out/i.test(r.label))?.value ?? 0;
  const dialIn = directions.find((r) => /in/i.test(r.label) && !/out/i.test(r.label))?.value ?? 0;
  const avgMinutes = connected ? minutes / connected : 0;
  const durations = data?.call_duration ?? [];
  const over30 = durations.filter((d) => d.label === '31-60' || d.label === '60+').reduce((t, d) => t + d.value, 0);

  const state = { isLoading, error };

  return (
    <div className={clsx('vd-design grid grid-cols-1 gap-4 sm:grid-cols-2', showConferences ? 'xl:grid-cols-5' : 'xl:grid-cols-4')}>
      <Kpi
        {...state}
        tone={TONES.blue}
        icon={Phone}
        label="Total attempts"
        value={fmt(attempts)}
        bar={attempts ? (connected / attempts) * 100 : 0}
        note={
          <>
            <strong>{pct(connected, attempts)}</strong> connection rate
          </>
        }
        tip={() => (
          <TipBody
            eyebrow="Total attempts"
            title="Every dial attempt"
            value={attempts}
            sections={[
              {
                title: 'Outcome',
                rows: [
                  { label: 'Connected', value: connected },
                  { label: 'Not connected', value: attempts - connected },
                ],
              },
            ]}
          />
        )}
      />
      <Kpi
        {...state}
        tone={TONES.violet}
        icon={Users}
        label="Total participants"
        value={fmt(participants)}
        bar={dialled ? (dialOut / dialled) * 100 : 0}
        note={
          <>
            <strong>{pct(dialOut, dialled)}</strong> dial out · {pct(dialIn, dialled)} dial in
          </>
        }
        tip={() => (
          <TipBody
            eyebrow="Total participants"
            title="Distinct participants"
            value={participants}
            sections={[
              {
                title: 'Phone numbers',
                rows: [{ label: 'Total phone numbers', value: data?.summary.total_phone_numbers ?? 0, share: '' }],
              },
              {
                title: 'Call direction (attempts)',
                base: dialled,
                rows: [
                  { label: 'Dial out', value: dialOut },
                  { label: 'Dial in', value: dialIn },
                ],
              },
            ]}
          />
        )}
      />
      {showConferences && (
        <Kpi
          {...state}
          tone={TONES.sky}
          icon={Layers}
          label="Total conferences"
          value={fmt(conferences)}
          note={
            <>
              <strong>{conferences ? (participants / conferences).toFixed(1) : '0'}</strong> participants per conference
            </>
          }
          tip={() => (
            <TipBody
              eyebrow="Total conferences"
              title="Distinct rooms (CRN + conference number)"
              value={conferences}
              share={`${conferences ? (participants / conferences).toFixed(1) : '0'} participants each`}
              sections={[
                {
                  title: 'Averages per conference',
                  rows: [
                    { label: 'Participants', value: conferences ? Math.round(participants / conferences) : 0, share: '' },
                    { label: 'Attempts', value: conferences ? Math.round(attempts / conferences) : 0, share: '' },
                  ],
                },
              ]}
            />
          )}
        />
      )}
      <Kpi
        {...state}
        tone={TONES.teal}
        icon={Timer}
        label="Total minutes"
        value={fmt(minutes)}
        bar={connected ? (over30 / connected) * 100 : 0}
        note={
          <>
            <strong>{avgMinutes.toFixed(2)} min</strong> avg per connected call
          </>
        }
        tip={() => (
          <TipBody
            eyebrow="Total minutes"
            title="Billable minutes"
            value={minutes}
            share={`${avgMinutes.toFixed(2)} min per connected call`}
            sections={[
              {
                // Shares of the locations' own total: that breakdown rounds per
                // location, the headline rounds per call, so the two totals differ.
                title: 'By location',
                base: (data?.minutes_by_location ?? []).reduce((t, l) => t + l.minutes, 0),
                rows: (data?.minutes_by_location ?? []).map((l) => ({
                  label: l.label,
                  value: l.minutes,
                  children: [
                    { label: 'Dial in', value: l.dial_in },
                    { label: 'Dial out', value: l.dial_out },
                  ],
                })),
              },
              {
                title: 'Bar · connected calls over 30 s',
                base: connected,
                rows: [
                  { label: 'Over 30 s', value: over30 },
                  { label: '30 s or less', value: connected - over30 },
                ],
              },
            ]}
          />
        )}
      />
      <Kpi
        {...state}
        tone={TONES.orange}
        icon={Hash}
        label="DTMF count"
        value={fmt(dtmf)}
        bar={connected ? (dtmf / connected) * 100 : 0}
        note={
          <>
            <strong>{pct(dtmf, connected)}</strong> of connected calls
          </>
        }
        tip={() => (
          <TipBody
            eyebrow="DTMF count"
            title="Key presses captured"
            value={dtmf}
            share={`${pct(dtmf, connected)} of ${fmt(connected)} connected calls`}
          />
        )}
      />
    </div>
  );
}

interface Tone {
  card: string;
  tile: string;
  bar: string;
  /** The dark-mode gradient edge, start and end. */
  edge: [string, string];
}

// Each card's tint, icon tile and bar — the light values from the mockup,
// with dark equivalents.
const TONES: Record<'blue' | 'violet' | 'sky' | 'teal' | 'orange', Tone> = {
  blue: {
    card: 'border-[#cfe1f6] from-white to-[#f1f7fe] dark:border-sky-500/25 dark:from-[#0d1729] dark:to-sky-500/[0.06]',
    tile: 'bg-[#e6f1fd] text-[#3a86d8] dark:bg-sky-500/15 dark:text-sky-300',
    bar: 'bg-[#3a86d8]',
    edge: ['rgba(59,130,246,0.45)', 'rgba(34,211,238,0.28)'],
  },
  violet: {
    card: 'border-[#e2d7f6] from-white to-[#faf4fd] dark:border-violet-500/25 dark:from-[#0d1729] dark:to-violet-500/[0.06]',
    tile: 'bg-[#f1eafd] text-[#8b6fd8] dark:bg-violet-500/15 dark:text-violet-300',
    bar: 'bg-gradient-to-r from-[#8b6fd8] to-[#e35d92]',
    edge: ['rgba(139,92,246,0.45)', 'rgba(236,72,153,0.32)'],
  },
  sky: {
    card: 'border-[#c8e4f4] from-white to-[#eff8fd] dark:border-cyan-500/25 dark:from-[#0d1729] dark:to-cyan-500/[0.06]',
    tile: 'bg-[#e0f2fb] text-[#1f93c4] dark:bg-cyan-500/15 dark:text-cyan-300',
    bar: 'bg-[#29a3d6]',
    edge: ['rgba(14,165,233,0.45)', 'rgba(99,102,241,0.28)'],
  },
  teal: {
    card: 'border-[#c9ece2] from-white to-[#f0fbf7] dark:border-emerald-500/25 dark:from-[#0d1729] dark:to-emerald-500/[0.06]',
    tile: 'bg-[#e2f6ef] text-[#25a883] dark:bg-emerald-500/15 dark:text-emerald-300',
    bar: 'bg-[#2fb58f]',
    edge: ['rgba(16,185,129,0.45)', 'rgba(34,211,238,0.28)'],
  },
  orange: {
    card: 'border-[#f6dcc4] from-white to-[#fff6ee] dark:border-orange-500/25 dark:from-[#0d1729] dark:to-orange-500/[0.06]',
    tile: 'bg-[#fdeedd] text-[#e07d2c] dark:bg-orange-500/15 dark:text-orange-300',
    bar: 'bg-[#ee8a3c]',
    edge: ['rgba(249,115,22,0.45)', 'rgba(234,179,8,0.28)'],
  },
};

function Kpi({
  tone,
  icon: Icon,
  label,
  value,
  bar,
  note,
  tip,
  isLoading,
  error,
}: {
  tone: Tone;
  icon: LucideIcon;
  label: string;
  value: string;
  /** 0–100; omitted when the figure has no proportion to show. */
  bar?: number;
  note: ReactNode;
  tip: () => ReactNode;
  isLoading: boolean;
  error: Error | null;
}) {
  const hover = useHover(tip);
  const ready = !isLoading && !error;

  return (
    <div
      {...(ready ? hover : {})}
      className={clsx(
        'vd-edge relative rounded-2xl border bg-gradient-to-br px-4 py-3.5 shadow-[0_1px_3px_#1c305408] outline-none transition-shadow hover:shadow-[0_3px_10px_#1c30540d] focus-visible:ring-2 focus-visible:ring-[#42b9e9]',
        'dark:border-transparent dark:shadow-[0_4px_14px_-10px_var(--edge-from)] dark:hover:shadow-[0_6px_18px_-10px_var(--edge-from)]',
        tone.card,
      )}
      style={{ '--edge-from': tone.edge[0], '--edge-via': tone.edge[1], '--edge-to': tone.edge[1] } as CSSProperties}
    >
      <div className="flex items-center gap-3">
        <span className={clsx('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', tone.tile)}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.6px] text-[#4d5d76] dark:text-zinc-400">
          {label}
        </span>
      </div>
      {isLoading ? (
        <Loader2 className="mt-4 h-6 w-6 animate-spin text-[#50a6d5]" />
      ) : error ? (
        <p className="mt-4 flex items-center gap-1.5 text-[12px] text-red-600 dark:text-red-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          Unavailable
        </p>
      ) : (
        <>
          <p className="mt-2.5 text-[24px] font-semibold leading-none tracking-[-0.4px] tabular-nums text-[#16213a] dark:text-white">
            {value}
          </p>
          {bar === undefined ? (
            <div className="mt-2.5 h-1.5" />
          ) : (
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[#e9eef5] dark:bg-white/[0.07]">
              <div
                className={clsx('h-full rounded-full', tone.bar)}
                style={{ width: `${Math.min(Math.max(bar, 0), 100)}%`, minWidth: bar > 0 ? 3 : 0 }}
              />
            </div>
          )}
          <p className="mt-1.5 text-[12px] text-[#5b6a82] dark:text-zinc-400 [&_strong]:font-semibold [&_strong]:text-[#16213a] dark:[&_strong]:text-white">
            {note}
          </p>
        </>
      )}
    </div>
  );
}
