import { Download, Search, X } from 'lucide-react';
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
  search: string;
  onSearch: (value: string) => void;
  searchPlaceholder: string;
  onExport: () => void;
  canExport: boolean;
}

/**
 * The bar above the table: view tabs on the left, search and export on the right.
 *
 * Each tab is its own card rather than a segment of one control, which is what
 * lets the active tab read as raised against the page instead of merely tinted.
 */
export function MetricsToolbar<T extends string>({
  tabs,
  active,
  onTab,
  search,
  onSearch,
  searchPlaceholder,
  onExport,
  canExport,
}: MetricsToolbarProps<T>) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTab(tab.id)}
              aria-pressed={isActive}
              className={clsx(
                'inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors',
                isActive
                  ? 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-600/10 dark:text-blue-400 dark:border-blue-500/30'
                  : 'bg-white dark:bg-[#09090B] text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
              )}
            >
              <tab.icon className="w-4 h-4 shrink-0" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="w-56 lg:w-64 pl-9 pr-8 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#09090B] text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearch('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onExport}
          disabled={!canExport}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#09090B] text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 disabled:opacity-40 disabled:pointer-events-none transition-colors"
        >
          <Download className="w-4 h-4" />
          Export
        </button>
      </div>
    </div>
  );
}
