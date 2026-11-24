import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import clsx from 'clsx';

export interface ToolbarTab<T extends string> {
  id: T;
  label: string;
  icon: LucideIcon;
}

interface MetricsToolbarProps<T extends string> {
  tabs: ToolbarTab<T>[];
  active: T;
  onTab: (id: T) => void;
  /** The colour key for the table below, shown at the left. */
  legend?: ReactNode;
  /** How many rows the open tab's table lists; shown beside that tab only. Null while loading. */
  count?: number | null;
}

/**
 * The bar above the table: the view tabs, centred.
 *
 * Same underline tab strip the analytics charts use — these are mutually
 * exclusive views of one page, which is what a tab bar means and what the card
 * pills it replaces did not.
 *
 * Laid out as three columns rather than a flex row with `justify-between`, so
 * the tabs are centred on the table beneath them rather than on whatever space
 * Export happens to leave over.
 */
export function MetricsToolbar<T extends string>({
  tabs,
  active,
  onTab,
  legend,
  count,
}: MetricsToolbarProps<T>) {
  return (
    <div className="border-b border-zinc-200 dark:border-zinc-800/60">
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
        <div className="min-w-0 self-center">{legend}</div>

        <div className="flex items-center gap-1 justify-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((tab) => {
            const isActive = tab.id === active;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTab(tab.id)}
                role="tab"
                aria-selected={isActive}
                className={clsx(
                  'relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
                  isActive
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200',
                )}
              >
                <tab.icon className="w-4 h-4 shrink-0" />
                {tab.label}
                {isActive && count != null && (
                  <span className="tabular-nums opacity-80">({count.toLocaleString()})</span>
                )}
                {/* Drawn as a span rather than a border on the button so it can
                    sit flush on the strip's own rule and cover it exactly — a
                    border would land a pixel above and read as a double line. */}
                {isActive && (
                  <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-blue-600 dark:bg-blue-400" />
                )}
              </button>
            );
          })}
        </div>

        {/* Export lives in the app header now (Excel / PDF of every tab). */}
        <span aria-hidden="true" />
      </div>
    </div>
  );
}
