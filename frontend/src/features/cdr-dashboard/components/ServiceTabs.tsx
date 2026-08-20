import clsx from 'clsx';
import { LayoutGrid, PhoneCall, Users, PhoneForwarded, SlidersHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CdrService } from '../api';

/**
 * `custom` is a UI mode, not a service — picking it drops the service
 * constraint and hands the narrowing filters over to the filter bar.
 *
 * Conference and multicall are the two services that cost the backend a CODR
 * join, being indistinguishable in CDR alone. Nothing here needs to know that,
 * but it is why switching to them can be slower than the others.
 */
export type ServiceTab = CdrService | 'custom';

const TABS: { id: ServiceTab; label: string; icon: LucideIcon }[] = [
  { id: 'all', label: 'All', icon: LayoutGrid },
  { id: 'voicedrop', label: 'Voicedrop', icon: PhoneCall },
  { id: 'conference', label: 'Conference', icon: Users },
  { id: 'multicall', label: 'Multicall', icon: PhoneForwarded },
  { id: 'custom', label: 'Custom', icon: SlidersHorizontal },
];

interface ServiceTabsProps {
  value: ServiceTab;
  onChange: (tab: ServiceTab) => void;
}

export function ServiceTabs({ value, onChange }: ServiceTabsProps) {
  return (
    <div className="flex items-center gap-1 bg-zinc-100 dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 p-1 h-[46px] rounded-md w-fit transition-colors duration-300">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          aria-pressed={value === tab.id}
          className={clsx(
            'flex items-center gap-2 px-5 py-2 rounded-md text-sm font-medium transition-all',
            value === tab.id
              ? 'bg-white text-blue-600 shadow-sm dark:bg-blue-600/10 dark:text-blue-500 dark:shadow-none'
              : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200',
          )}
        >
          <tab.icon className="w-4 h-4" />
          {tab.label}
        </button>
      ))}
    </div>
  );
}
