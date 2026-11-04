import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';

import { compact, fmt } from '../../cdr-dashboard/components/attempt-analytics/design';
import { dayLabel, daysAgo, weekdayDay } from '../format';
import { AccountName, Change } from './ui';

const ROW =
  'group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[12px] transition-colors hover:bg-[#f3f7fc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#42b9e9] dark:hover:bg-white/[0.04]';
const HEAD = 'px-2.5 pb-1.5 text-[10px] font-medium uppercase tracking-[0.6px] text-[#8a99ad] dark:text-zinc-500';
const NUM = 'shrink-0 text-right tabular-nums text-[#405a7a] dark:text-zinc-200';

/** An account that has gone quiet: when it last ran, and what it used to do. */
export interface QuietAccount {
  account_id: number;
  name?: string | null;
  client_ids?: number[];
  last_date: string;
  days_idle: number;
  /** Its volume over the 90 days up to its last active day. */
  recent: number;
}

/**
 * Accounts that were active before and have gone quiet — the churn warning.
 * Sorted by what each used to do, so the biggest losses come first.
 */
export function SleepingAccounts({
  accounts,
  idleDays,
  unit,
  onAccount,
}: {
  accounts: QuietAccount[];
  idleDays: number;
  /** What `recent` counts, for the column's hover: "dialed", "attended minutes". */
  unit: string;
  onAccount: (id: number) => void;
}) {
  const quiet = accounts.filter((a) => a.days_idle >= idleDays).sort((a, b) => b.recent - a.recent);
  if (!quiet.length) {
    return <p className="py-10 text-center text-[12px] text-[#8a99ad]">Every account has been active in the last {idleDays} days.</p>;
  }
  const top = quiet[0].recent || 1;
  return (
    <div className="max-h-[360px] overflow-y-auto [scrollbar-width:thin]">
      <div className={clsx(HEAD, 'flex gap-3')}>
        <span className="flex-1">Account</span>
        <span className="w-28 text-right">Last active</span>
        <span className="w-36 text-right">Used to</span>
        <span className="w-4" />
      </div>
      {quiet.map((a) => (
        <button key={a.account_id} type="button" onClick={() => onAccount(a.account_id)} className={ROW}>
          <span className="flex min-w-0 flex-1 items-center">
            <AccountName id={a.account_id} clients={a.client_ids} name={a.name} />
          </span>
          <span className="w-28 shrink-0 text-right">
            <span className="block text-[#405a7a] dark:text-zinc-200">{dayLabel(a.last_date)}</span>
            <span className="block text-[10px] text-[#e07d2c]">{daysAgo(a.days_idle)}</span>
          </span>
          <span className="w-36 shrink-0">
            <span className={clsx(NUM, 'block')} title={`${fmt(a.recent)} ${unit} in the 90 days up to the last active day`}>
              {compact(a.recent)}
              <span className="ml-1 text-[10px] text-[#8a99ad]">/ 90 days</span>
            </span>
            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-[#eef2f7] dark:bg-white/[0.06]">
              <span
                className="block h-full rounded-full bg-[#ee8a3c]"
                style={{ width: `${(a.recent / top) * 100}%`, minWidth: a.recent ? 3 : 0 }}
              />
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-[#b5c1d1] group-hover:text-[#5b6a82]" />
        </button>
      ))}
    </div>
  );
}

/** One account this month so far against the same days of last month. */
export interface MoverRow {
  account_id: number;
  name?: string | null;
  current: number;
  previous: number;
  change: number;
}

/** The five biggest gains and the five biggest drops, side by side. */
export function Movers({ movers, unit, onAccount }: { movers: MoverRow[]; unit: string; onAccount: (id: number) => void }) {
  const rising = movers.filter((m) => m.change > 0).sort((a, b) => b.change - a.change).slice(0, 5);
  const falling = movers.filter((m) => m.change < 0).sort((a, b) => a.change - b.change).slice(0, 5);
  const scale = Math.max(1, ...[...rising, ...falling].map((m) => Math.abs(m.change)));
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <MoverList title="Rising" movers={rising} scale={scale} unit={unit} color="#2fb58f" onAccount={onAccount} />
      <MoverList title="Falling" movers={falling} scale={scale} unit={unit} color="#ee8a3c" onAccount={onAccount} />
    </div>
  );
}

function MoverList({
  title,
  movers,
  scale,
  unit,
  color,
  onAccount,
}: {
  title: string;
  movers: MoverRow[];
  scale: number;
  unit: string;
  color: string;
  onAccount: (id: number) => void;
}) {
  return (
    <div className="min-w-0">
      <div className={HEAD}>{title}</div>
      {!movers.length && <p className="px-2.5 py-4 text-[12px] text-[#8a99ad]">None this month.</p>}
      {movers.map((m) => (
        <button
          key={m.account_id}
          type="button"
          onClick={() => onAccount(m.account_id)}
          title={m.name ?? undefined}
          className={clsx(ROW, 'flex-wrap gap-y-1')}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <AccountName id={m.account_id} />
            <Change now={m.current} before={m.previous} />
          </span>
          <span className={NUM} title={`${fmt(m.previous)} → ${fmt(m.current)} ${unit}`}>
            {compact(m.previous)} → <span className="font-medium">{compact(m.current)}</span>
          </span>
          <span className="block h-1 w-full overflow-hidden rounded-full bg-[#eef2f7] dark:bg-white/[0.06]">
            <span className="block h-full rounded-full" style={{ width: `${(Math.abs(m.change) / scale) * 100}%`, minWidth: 3, background: color }} />
          </span>
        </button>
      ))}
    </div>
  );
}

/** The ten heaviest days across every account — what peak load really is. */
export function BusiestDays<T extends { date: string }>({
  days,
  valueOf,
  describe,
  onDay,
}: {
  days: T[];
  valueOf: (day: T) => number;
  /** The day's hover line. */
  describe: (day: T) => string;
  onDay: (iso: string) => void;
}) {
  const top = [...days].sort((a, b) => valueOf(b) - valueOf(a)).slice(0, 10);
  const max = top[0] ? valueOf(top[0]) || 1 : 1;
  return (
    <div className="min-w-0">
      <div className={clsx(HEAD, 'px-0')}>Busiest days</div>
      <ol className="space-y-0.5">
        {top.map((d, i) => (
          <li key={d.date}>
            <button
              type="button"
              onClick={() => onDay(d.date)}
              title={describe(d)}
              className="group w-full rounded-md px-1.5 py-1 text-left text-[12px] hover:bg-[#f3f7fc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#42b9e9] dark:hover:bg-white/[0.04]"
            >
              <span className="flex items-baseline gap-2">
                <span className="w-4 shrink-0 text-[10px] tabular-nums text-[#8a99ad]">{i + 1}</span>
                <span className="flex-1 truncate text-[#405a7a] dark:text-zinc-200">{weekdayDay(d.date)}</span>
                <span className={NUM}>{compact(valueOf(d))}</span>
              </span>
              <span className="ml-6 mt-1 block h-1 overflow-hidden rounded-full bg-[#eef2f7] dark:bg-white/[0.06]">
                <span className="block h-full rounded-full bg-[#50a6d5]" style={{ width: `${(valueOf(d) / max) * 100}%` }} />
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
