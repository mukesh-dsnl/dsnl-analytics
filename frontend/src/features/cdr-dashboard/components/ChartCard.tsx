import type { ReactNode } from 'react';
import { AlertTriangle, Loader2, Inbox } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface ChartCardProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  isLoading: boolean;
  error?: Error | null;
  /** True when the endpoint answered but had nothing to plot. */
  isEmpty?: boolean;
  /** Plot height in px — kept fixed so the grid doesn't reflow as charts land. */
  height?: number;
  /** Rendered at the right of the header — a headline figure, usually. */
  headerSlot?: ReactNode;
  children: ReactNode;
}

/**
 * One panel of the dashboard grid.
 *
 * Each of the eight endpoints resolves independently, so loading is scoped to
 * the panel rather than blocking the page. The plot area keeps its height in
 * every state — loading, empty, error and loaded all occupy the same box, so
 * charts don't shuffle position as their requests land.
 */
export function ChartCard({
  title,
  subtitle,
  icon: Icon,
  isLoading,
  error,
  isEmpty,
  height = 260,
  headerSlot,
  children,
}: ChartCardProps) {
  return (
    <div className="bg-white dark:bg-surface-dark border border-zinc-200 dark:border-zinc-800/60 rounded-md shadow-sm dark:shadow-lg flex flex-col transition-colors duration-300">
      <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-zinc-200 dark:border-zinc-800/60">
        <div className="flex items-center gap-2.5 min-w-0">
          {Icon && <Icon className="w-4 h-4 shrink-0 text-zinc-400 dark:text-zinc-500" />}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-200 truncate">{title}</h3>
            {subtitle && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>
        {headerSlot}
      </div>

      <div className="p-5" style={{ minHeight: height }}>
        {isLoading ? (
          <div className="flex items-center justify-center" style={{ height }}>
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : error ? (
          <div
            className="flex flex-col items-center justify-center gap-2 text-center"
            style={{ height }}
          >
            <AlertTriangle className="w-6 h-6 text-amber-500" />
            <p className="text-sm text-zinc-600 dark:text-zinc-300">Couldn't load this chart.</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-xs">{error.message}</p>
          </div>
        ) : isEmpty ? (
          <div
            className="flex flex-col items-center justify-center gap-2 text-center"
            style={{ height }}
          >
            <div className="w-11 h-11 rounded-md bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400">
              <Inbox className="w-5 h-5" />
            </div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No data for the current filters.
            </p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
