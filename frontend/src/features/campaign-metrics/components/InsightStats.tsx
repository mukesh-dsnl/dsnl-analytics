import { CloudUpload, Phone, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AccountInsight } from '../api';

interface StatCardProps {
  label: string;
  value: string;
  note: string;
  icon: LucideIcon;
  /** Tailwind classes for the icon tile — the only colour on the card. */
  accent: string;
}

function StatCard({ label, value, note, icon: Icon, accent }: StatCardProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800/60 bg-white dark:bg-[#09090B]">
      <span
        className={`inline-flex items-center justify-center w-11 h-11 rounded-xl shrink-0 ${accent}`}
      >
        <Icon className="w-5 h-5" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 truncate">{label}</p>
        <p className="text-2xl font-bold text-zinc-900 dark:text-white leading-tight tabular-nums">
          {value}
        </p>
        <p className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate">{note}</p>
      </div>
    </div>
  );
}

/**
 * A ring rather than a fifth number: Connect % is the figure the popup exists
 * to explain, and the arc says "most of the way" or "barely started" before the
 * digits are read.
 */
function ConnectRing({ percentage }: { percentage: number }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const filled = (Math.min(Math.max(percentage, 0), 100) / 100) * circumference;

  return (
    <svg width="64" height="64" viewBox="0 0 64 64" className="shrink-0" aria-hidden="true">
      <circle
        cx="32"
        cy="32"
        r={radius}
        fill="none"
        strokeWidth="7"
        className="stroke-emerald-500/20"
      />
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
        className="stroke-emerald-500"
      />
      <text
        x="32"
        y="36"
        textAnchor="middle"
        className="fill-emerald-700 dark:fill-emerald-400"
        fontSize="14"
        fontWeight="700"
      >
        {Math.round(percentage)}%
      </text>
    </svg>
  );
}

/** Whole numbers to 2dp, for "attempts per number uploaded". */
const ratio = (numerator: number, denominator: number): string =>
  denominator > 0 ? (numerator / denominator).toFixed(2) : '—';

export function InsightStats({ summary }: { summary: AccountInsight['summary'] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      <StatCard
        label="Total uploaded"
        value={summary.total_uploaded.toLocaleString()}
        note="Numbers uploaded"
        icon={CloudUpload}
        accent="bg-blue-50 text-blue-500 dark:bg-blue-500/15 dark:text-blue-400"
      />
      <StatCard
        label="Dial attempts"
        value={summary.dial_attempts.toLocaleString()}
        note={`${ratio(summary.dial_attempts, summary.total_uploaded)} attempts per uploaded`}
        icon={Phone}
        accent="bg-violet-50 text-violet-500 dark:bg-violet-500/15 dark:text-violet-400"
      />
      <StatCard
        label="Connected users"
        value={summary.connected_users.toLocaleString()}
        // Counted independently, so these can exceed the headline where a
        // conferee connected on both a dial-in and a dial-out leg.
        note={`Dial In: ${summary.connected_dial_in.toLocaleString()} · Dial Out: ${summary.connected_dial_out.toLocaleString()}`}
        icon={Users}
        accent="bg-emerald-50 text-emerald-500 dark:bg-emerald-500/15 dark:text-emerald-400"
      />
      <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/70 dark:bg-emerald-500/10">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 truncate">
            Connect %
          </p>
          <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 leading-tight tabular-nums">
            {summary.connect_percentage.toFixed(2)}%
          </p>
          <p className="text-[10px] text-emerald-600/70 dark:text-emerald-500/70 truncate">
            of numbers uploaded
          </p>
        </div>
        <ConnectRing percentage={summary.connect_percentage} />
      </div>
    </div>
  );
}
