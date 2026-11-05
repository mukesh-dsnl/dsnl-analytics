import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import clsx from 'clsx';
import { Check, ChevronsUpDown, Search, UserRound } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import { cleanName } from '../format';
import { AccountName } from './AccountName';

export interface AccountOption {
  id: number;
  name: string | null;
  /** The figure on the right of a row: "55M dialed". */
  meta: string;
  days_idle?: number;
}

const QUIET_AFTER = 15;

/**
 * The account picker in an Accounts page's header: a button showing the
 * account in view, opening a searchable list — id or name, arrow keys to
 * move, Enter to open.
 */
export function AccountPicker({
  value,
  options,
  onChange,
}: {
  value: number | null;
  options: AccountOption[];
  onChange: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const current = options.find((o) => o.id === value);

  const q = term.trim().toLowerCase();
  const shown = useMemo(
    () => (q ? options.filter((o) => String(o.id).includes(q) || (o.name ?? '').toLowerCase().includes(q)) : options),
    [options, q],
  );

  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (id: number | null) => {
    onChange(id);
    setOpen(false);
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => Math.max(0, Math.min(shown.length - 1, i + step)));
    } else if (event.key === 'Enter' && shown[active]) {
      event.preventDefault();
      choose(shown[active].id);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setTerm('');
          setActive(Math.max(0, options.findIndex((o) => o.id === value)));
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Choose an account"
          className={clsx(
            'group flex h-9 w-[380px] min-w-0 max-w-full items-center gap-2.5 rounded-xl border bg-white pl-2 pr-2.5 text-left shadow-[0_1px_2px_#1c305408] transition-colors',
            'border-[#dfe7f1] hover:border-[#bcd6ef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#42b9e9]/60',
            'dark:border-white/[0.08] dark:bg-[#0e192c] dark:hover:border-white/[0.16]',
            open && 'border-[#bcd6ef] ring-2 ring-[#42b9e9]/25',
          )}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#e8f0fe] text-[#2563eb] dark:bg-blue-500/15 dark:text-blue-300">
            <UserRound className="h-3.5 w-3.5" />
          </span>
          {current ? (
            <AccountName id={current.id} name={current.name} size="sm" className="flex-1" />
          ) : (
            <span className="flex-1 truncate text-[13px] text-[#8a99ad]">Choose an account</span>
          )}
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-[#9aa7b8] group-hover:text-[#5b6a82]" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[480px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border-[#e3eaf3] p-0 shadow-[0_18px_40px_#1c30541f] dark:border-white/[0.08]"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).querySelector('input')?.focus();
        }}
      >
        <div className="flex items-center gap-2 border-b border-[#eef2f7] px-3.5 dark:border-white/[0.06]">
          <Search className="h-4 w-4 shrink-0 text-[#9aa7b8]" />
          <input
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
            placeholder="Search by account id or name…"
            aria-label="Search accounts"
            className="h-11 min-w-0 flex-1 bg-transparent text-sm text-[#16213a] outline-none placeholder:text-[#9aa7b8] dark:text-zinc-100"
          />
        </div>
        {shown.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-[#8a99ad]">No account matches “{term.trim()}”.</p>
        ) : (
          <ul ref={listRef} role="listbox" aria-label="Accounts" className="max-h-[360px] overflow-y-auto p-1.5 [scrollbar-width:thin]">
            {shown.map((o, i) => {
              const selected = o.id === value;
              const quiet = (o.days_idle ?? 0) >= QUIET_AFTER;
              return (
                <li key={o.id} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(o.id)}
                    className={clsx(
                      'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
                      i === active ? 'bg-[#f1f6fd] dark:bg-white/[0.05]' : 'bg-transparent',
                    )}
                  >
                    <span className="w-[62px] shrink-0 rounded-md bg-[#eef4fd] px-1.5 py-0.5 text-center font-mono text-[11.5px] font-semibold tabular-nums text-[#1d4ed8] dark:bg-sky-500/10 dark:text-sky-300">
                      {o.id}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-[#253350] dark:text-zinc-200" title={o.name ?? undefined}>
                      {cleanName(o.name, o.id) ?? <span className="text-[#9aa7b8]">No name in the account list</span>}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[11px] tabular-nums text-[#5b6a82] dark:text-zinc-400">{o.meta}</span>
                      {quiet && <span className="block text-[10px] text-[#c2620f] dark:text-orange-300">quiet {o.days_idle}d</span>}
                    </span>
                    <Check className={clsx('h-3.5 w-3.5 shrink-0 text-[#2563eb]', selected ? 'opacity-100' : 'opacity-0')} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex items-center justify-between border-t border-[#eef2f7] bg-[#f8fafd] px-3.5 py-2 text-[11px] text-[#8a99ad] dark:border-white/[0.06] dark:bg-white/[0.02]">
          <span>
            {shown.length === options.length ? `${options.length} accounts` : `${shown.length} of ${options.length}`} · ↑↓ to move · Enter to open
          </span>
          {value != null && (
            <button type="button" onClick={() => choose(null)} className="font-medium text-[#2563eb] hover:text-[#1d4ed8] dark:text-sky-300">
              All accounts
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
