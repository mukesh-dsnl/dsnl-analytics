import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import clsx from 'clsx';
import { ChevronRight, Search, X } from 'lucide-react';

import { compact, fmt } from '../../cdr-dashboard/components/attempt-analytics/design';
import { dayLabel, daysAgo } from '../format';
import { AccountName } from './AccountName';

export interface DirectoryRow {
  account_id: number;
  /** From the account master list (accounts.parquet). */
  name: string | null;
  /** The lifetime figure the list is sorted by: dialed (Voicedrop), attended minutes (Conference). */
  total: number;
  /** Shown under the total: "1,873 campaigns". */
  detail: string;
  last_date: string;
  days_idle: number;
}

const QUIET_AFTER = 15;

/**
 * The Account tab with no account chosen: every account, one per line —
 * id, name, lifetime total and last use — with a search on id or name.
 * Typing filters as it goes; the search icon (or Enter) records the term in
 * the URL (`?q=`), so a search can be shared and survives a reload.
 */
export function AccountDirectory({
  rows,
  totalLabel,
  query,
  onQuery,
  onAccount,
}: {
  rows: DirectoryRow[];
  totalLabel: string;
  query: string;
  onQuery: (q: string) => void;
  onAccount: (id: number) => void;
}) {
  const [draft, setDraft] = useState(query);
  const [synced, setSynced] = useState(query);
  // The URL moved underneath (back/forward): follow it.
  if (query !== synced) {
    setSynced(query);
    setDraft(query);
  }
  const term = draft.trim().toLowerCase();
  const shown = useMemo(
    () => (term ? rows.filter((r) => String(r.account_id).includes(term) || (r.name ?? '').toLowerCase().includes(term)) : rows),
    [rows, term],
  );
  const top = Math.max(1, ...rows.map((r) => r.total));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onQuery(draft.trim());
  };

  return (
    <div className="mx-auto max-w-5xl">
      <form onSubmit={submit} role="search" className="mb-4 flex items-center gap-2">
        <div className="field-focus-within flex h-11 flex-1 items-center gap-2 rounded-xl border border-[#dfe7f1] bg-white pl-3.5 pr-1.5 shadow-[0_1px_2px_#1c305408] dark:border-white/[0.08] dark:bg-[#0e192c]">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search by account id or name…"
            aria-label="Search accounts"
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-[#16213a] outline-none placeholder:text-[#9aa7b8] dark:text-zinc-100"
          />
          {draft && (
            <button
              type="button"
              onClick={() => {
                setDraft('');
                onQuery('');
              }}
              aria-label="Clear search"
              className="rounded-md p-1.5 text-[#9aa7b8] hover:bg-zinc-100 hover:text-[#45556e] dark:hover:bg-white/[0.06]"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <button
            type="submit"
            aria-label="Search"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#2563eb] text-white transition-colors hover:bg-[#1d4ed8]"
          >
            <Search className="h-4 w-4" />
          </button>
        </div>
      </form>

      <div className="overflow-hidden rounded-2xl border border-[#e9eef5] bg-white shadow-[0_6px_20px_#1c305408] dark:border-[#1c2a42] dark:bg-[#0e192c]">
        <div className="grid grid-cols-[minmax(0,1fr)_170px_150px_20px] gap-4 border-b border-[#eef2f7] bg-[#f6f9fd] px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.6px] text-[#5b6a82] dark:border-white/[0.06] dark:bg-[#13213a] dark:text-zinc-400">
          <span>Account</span>
          <span className="text-right">{totalLabel}</span>
          <span className="text-right">Last used</span>
          <span />
        </div>
        {shown.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-[#8a99ad]">No account matches “{draft.trim()}”.</p>
        ) : (
          <ul className="max-h-[calc(100vh-300px)] min-h-[200px] divide-y divide-[#eef2f7] overflow-y-auto [scrollbar-width:thin] dark:divide-white/[0.05]">
            {shown.map((row) => (
              <li key={row.account_id}>
                <button
                  type="button"
                  onClick={() => onAccount(row.account_id)}
                  className="group grid w-full grid-cols-[minmax(0,1fr)_170px_150px_20px] items-center gap-4 px-5 py-3 text-left transition-colors hover:bg-[#f5f9fe] focus-visible:bg-[#f5f9fe] focus-visible:outline-none dark:hover:bg-white/[0.03]"
                >
                  <span className="flex min-w-0">
                    <AccountName id={row.account_id} name={row.name} />
                  </span>
                  <span className="text-right">
                    <span className="block text-sm font-semibold tabular-nums text-[#1f2b45] dark:text-zinc-100" title={fmt(row.total)}>
                      {compact(row.total)}
                    </span>
                    <span className="mt-1 ml-auto block h-1 w-24 overflow-hidden rounded-full bg-[#eef2f7] dark:bg-white/[0.06]">
                      <span className="block h-full rounded-full bg-[#50a6d5]" style={{ width: `${(row.total / top) * 100}%`, minWidth: 3 }} />
                    </span>
                    <span className="mt-0.5 block text-[10px] text-[#8a99ad]">{row.detail}</span>
                  </span>
                  <span className="text-right">
                    <span className="block text-[13px] tabular-nums text-[#35415a] dark:text-zinc-200">{dayLabel(row.last_date)}</span>
                    <span
                      className={clsx(
                        'mt-0.5 inline-block rounded-full px-1.5 py-px text-[10px] font-medium',
                        row.days_idle >= QUIET_AFTER
                          ? 'bg-[#fdeedd] text-[#c2620f] dark:bg-orange-500/15 dark:text-orange-300'
                          : 'bg-[#e2f6ef] text-[#1f9a77] dark:bg-emerald-500/15 dark:text-emerald-300',
                      )}
                    >
                      {daysAgo(row.days_idle)}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-[#b5c1d1] transition-transform group-hover:translate-x-0.5 group-hover:text-[#5b6a82]" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="border-t border-[#eef2f7] px-5 py-2 text-[11px] text-[#8a99ad] dark:border-white/[0.06]">
          {shown.length === rows.length ? `${rows.length} accounts` : `${shown.length} of ${rows.length} accounts`} · busiest first ·
          quiet {QUIET_AFTER}+ days in orange
        </p>
      </div>
    </div>
  );
}
