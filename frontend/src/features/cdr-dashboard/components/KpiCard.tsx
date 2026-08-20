import { Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';

interface KpiCardProps {
  label: string;
  value: string;
  unit?: string;
  icon: LucideIcon;
  isLoading: boolean;
  error?: Error | null;
  /** Tailwind classes for the icon tile — the only colour on the card. */
  accent?: string;
}

/**
 * A stat tile: one figure, no plot.
 *
 * The value wears text ink rather than a series colour — the icon tile beside
 * it carries whatever identity the tile needs. Figures stay proportional
 * (these don't align into a column), which is what keeps a large number
 * looking typeset rather than tabulated.
 */
export function KpiCard({
  label,
  value,
  unit,
  icon: Icon,
  isLoading,
  error,
  accent = 'bg-blue-500/10 border-blue-500/20 text-blue-500',
}: KpiCardProps) {
  return (
    <div className="bg-white dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800/60 rounded-md shadow-sm dark:shadow-lg px-5 py-4 flex items-center gap-4 transition-colors duration-300">
      <div
        className={clsx(
          'w-11 h-11 rounded-md border flex items-center justify-center shrink-0',
          accent,
        )}
      >
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider truncate">
          {label}
        </p>
        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin text-zinc-400 mt-1.5" />
        ) : error ? (
          <p className="text-sm text-zinc-400 dark:text-zinc-500 mt-1">Unavailable</p>
        ) : (
          <p className="text-2xl font-bold text-zinc-900 dark:text-white mt-0.5 truncate">
            {value}
            {unit && (
              <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400 ml-1.5">
                {unit}
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
