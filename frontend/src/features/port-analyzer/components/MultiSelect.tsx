import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Check, ChevronDown, Search, X } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { FilterOption } from '../api';

const nf = new Intl.NumberFormat('en-US');

/**
 * A filter that picks any number of values — providers, accounts,
 * locations — from what the day actually has, busiest first, with a search
 * for the long lists. Nothing chosen means "all".
 */
export function MultiSelect({
  label,
  options,
  value,
  onChange,
  placeholder = 'All',
}: {
  label: string;
  options: FilterOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const chosen = new Set(value);
  const term = query.trim().toLowerCase();
  const shown = useMemo(
    () => (term ? options.filter((o) => o.label.toLowerCase().includes(term) || o.key.toLowerCase().includes(term)) : options),
    [options, term],
  );
  const toggle = (key: string) => onChange(chosen.has(key) ? value.filter((v) => v !== key) : [...value, key]);
  const summary =
    value.length === 0
      ? placeholder
      : value.length === 1
        ? (options.find((o) => o.key === value[0])?.label ?? value[0])
        : `${value.length} selected`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={clsx(
            'field-focus inline-flex h-9 min-w-0 max-w-[260px] items-center gap-2 rounded-lg border bg-white px-3 text-left text-[13px] transition-colors dark:bg-[#0e192c]',
            value.length
              ? 'border-[#93b8f3] text-[#1d4ed8] dark:border-sky-500/50 dark:text-sky-300'
              : 'border-[#dfe7f1] text-[#35415a] hover:border-[#c9daf2] dark:border-white/[0.08] dark:text-zinc-200',
          )}
        >
          <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.4px] text-[#8a99ad]">{label}</span>
          <span className="min-w-0 flex-1 truncate font-medium">{summary}</span>
          {value.length > 0 ? (
            <span
              role="button"
              tabIndex={0}
              aria-label={`Clear ${label}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.stopPropagation();
                  onChange([]);
                }
              }}
              className="rounded p-0.5 text-[#8a99ad] hover:bg-zinc-100 hover:text-[#35415a] dark:hover:bg-white/[0.08]"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#8a99ad]" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] p-0">
        <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2 dark:border-white/[0.06]">
          <Search className="h-4 w-4 text-[#8a99ad]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}…`}
            className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[#9aa7b8]"
          />
        </div>
        <ul className="max-h-[300px] overflow-y-auto py-1 [scrollbar-width:thin]">
          {shown.length === 0 && <li className="px-3 py-6 text-center text-[12px] text-[#8a99ad]">Nothing matches.</li>}
          {shown.map((option) => {
            const on = chosen.has(option.key);
            return (
              <li key={option.key}>
                <button
                  type="button"
                  onClick={() => toggle(option.key)}
                  className={clsx(
                    'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors',
                    on ? 'bg-[#eef4fd] dark:bg-sky-500/10' : 'hover:bg-zinc-50 dark:hover:bg-white/[0.04]',
                  )}
                >
                  <span
                    className={clsx(
                      'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      on ? 'border-[#2563eb] bg-[#2563eb] text-white' : 'border-zinc-300 dark:border-zinc-600',
                    )}
                  >
                    {on && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={option.label}>
                    {option.label}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-[#8a99ad]">{nf.format(option.calls)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {value.length > 0 && (
          <div className="flex items-center justify-between border-t border-zinc-100 px-3 py-2 text-[12px] dark:border-white/[0.06]">
            <span className="text-[#8a99ad]">{value.length} selected</span>
            <button type="button" onClick={() => onChange([])} className="font-medium text-[#2563eb] hover:underline dark:text-sky-300">
              Clear
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
