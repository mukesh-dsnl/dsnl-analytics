import { Download } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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
  onExport: () => void;
  canExport: boolean;
}

/**
 * The bar above the table: the view tabs, centred, with Export at the right.
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
  onExport,
  canExport,
}: MetricsToolbarProps<T>) {
  return (
    <div className="border-b border-zinc-200 dark:border-zinc-800/60">
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
        <span aria-hidden="true" />

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

        <div className="flex justify-end pb-1.5">
          <button
            type="button"
            onClick={onExport}
            disabled={!canExport}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-surface-dark text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
