import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';

/**
 * The section strip across the top of a Summary page — the same underline
 * tabs as Campaign Metrics, centred over the content they switch.
 */
export function SectionTabs<T extends string>({
  tabs,
  active,
  onTab,
}: {
  tabs: { id: T; label: string; icon: LucideIcon }[];
  active: T;
  onTab: (id: T) => void;
}) {
  return (
    <div className="mb-6 border-b border-zinc-200 dark:border-zinc-800/60">
      <div className="flex items-center justify-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist">
        {tabs.map((tab) => {
          const on = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onTab(tab.id)}
              className={clsx(
                'relative flex items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors',
                on ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200',
              )}
            >
              <tab.icon className="h-4 w-4 shrink-0" />
              {tab.label}
              {on && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-blue-600 dark:bg-blue-400" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
