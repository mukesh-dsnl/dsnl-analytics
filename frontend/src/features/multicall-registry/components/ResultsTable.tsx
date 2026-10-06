import clsx from 'clsx';
import { format } from 'date-fns';
import { AlertTriangle, ChevronRight, Download, Filter, SearchX, X } from 'lucide-react';
import { downloadCsv } from '../../campaign-metrics/exportCsv';
import type { RegistrationMatch, SearchCriteria } from '../api';
import { dateLabel, focus, sourceLabel, surface } from '../lookup';
import { Avatar, Hit } from './shared';

const TH = 'sticky top-0 z-10 bg-white px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-500 shadow-[inset_0_-1px_0_theme(colors.zinc.200)] dark:bg-surface-dark dark:text-zinc-400 dark:shadow-[inset_0_-1px_0_theme(colors.zinc.800)]';
const TD = 'px-4 py-3 align-middle text-sm text-zinc-700 dark:text-zinc-300';

interface ResultsTableProps {
  rows: RegistrationMatch[];
  totalRows: number;
  truncated: boolean;
  criteria: SearchCriteria;
  filter: string;
  onFilter: (value: string) => void;
  onOpen: (row: RegistrationMatch) => void;
  /** The account last opened, so returning to the list lands on it. */
  recent: string | null;
}

function exportedAt(value: string | null): string {
  if (!value) return '';
  const date = new Date(value.replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? value : format(date, 'yyyy-MM-dd HH:mm:ss');
}

/** Exports exactly what the table shows: every row, with the quick filter applied. */
function exportAccounts(rows: RegistrationMatch[]) {
  downloadCsv(
    `multicall-accounts-${format(new Date(), 'yyyyMMdd-HHmm')}.csv`,
    ['Reg Num', 'Phone', 'Email', 'Last Updated'],
    rows.map((row) => [row.reg_num, row.phone, row.email, exportedAt(row.updated_at)]),
  );
}

export function ResultsTable({ rows, totalRows, truncated, criteria, filter, onFilter, onOpen, recent }: ResultsTableProps) {
  const phones = new Set(criteria.phones);
  const emails = new Set(criteria.emails.map((value) => value.toLowerCase()));
  const regNums = new Set(criteria.reg_nums);

  return <section className={clsx(surface, 'mc-rise overflow-hidden')} aria-label="Matching accounts">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3 sm:px-5 dark:border-zinc-800">
      <div className="flex min-w-0 items-center gap-3">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Accounts</h2>
        <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {filter ? `${rows.length} of ${totalRows}` : totalRows}
        </span>
        {truncated && <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300"><AlertTriangle className="h-3.5 w-3.5" /> Showing the first {totalRows} — narrow the search to see the rest.</span>}
      </div>
      <div className="flex w-full items-center gap-2 sm:w-auto">
      {totalRows > 1 && <label className="relative block min-w-0 flex-1 sm:w-64 sm:flex-none">
        <span className="sr-only">Filter these results</span>
        <Filter className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
        <input value={filter} onChange={(event) => onFilter(event.target.value)} placeholder="Filter these results" autoComplete="off"
          className={clsx('h-9 w-full rounded-lg border border-zinc-200 bg-white pl-8 pr-8 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-white', focus)} />
        {filter && <button type="button" onClick={() => onFilter('')} aria-label="Clear filter" className={clsx('absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200', focus)}><X className="h-3.5 w-3.5" /></button>}
      </label>}
      <button type="button" onClick={() => exportAccounts(rows)} disabled={rows.length === 0}
        title={filter ? `Download the ${rows.length} filtered accounts as CSV` : 'Download these accounts as CSV'}
        className={clsx('inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-transparent dark:text-zinc-200 dark:hover:bg-zinc-800', focus)}>
        <Download className="h-4 w-4" /> Export
      </button>
      </div>
    </div>

    {rows.length === 0 ? <div className="flex flex-col items-center px-6 py-14 text-center">
      <SearchX className="h-8 w-8 text-zinc-300 dark:text-zinc-600" />
      <p className="mt-3 text-sm font-medium text-zinc-700 dark:text-zinc-200">No account in these results matches “{filter}”.</p>
    </div> :
    <div className="max-h-[calc(100vh-290px)] min-h-48 overflow-auto scrollbar-subtle">
      <table className="w-full min-w-[920px] border-separate border-spacing-0">
        <thead><tr>
          <th className={TH}>Account</th>
          <th className={TH}>Phone</th>
          <th className={TH}>Email</th>
          <th className={TH}>Profiles</th>
          <th className={TH}>Source</th>
          <th className={TH}>Last updated</th>
          <th className={clsx(TH, 'text-right')}><span className="sr-only">Actions</span></th>
        </tr></thead>
        <tbody>
          {rows.map((row) => {
            const reg = String(row.reg_num);
            return <tr key={reg} id={`mc-row-${reg}`} onClick={() => onOpen(row)}
              className={clsx('group cursor-pointer transition-colors [&>td]:border-b [&>td]:border-zinc-100 last:[&>td]:border-b-0 dark:[&>td]:border-zinc-800/80',
                recent === reg ? 'bg-blue-50/70 dark:bg-blue-500/10' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/30')}>
              <td className={TD}>
                <div className="flex items-center gap-3">
                  <Avatar name={row.name} />
                  <div className="min-w-0">
                    <p className="max-w-[220px] truncate font-semibold text-zinc-900 dark:text-white">{row.name || 'Unnamed account'}</p>
                    <p className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">Reg <Hit hit={regNums.has(reg)}>#{reg}</Hit></p>
                  </div>
                </div>
              </td>
              <td className={clsx(TD, 'whitespace-nowrap tabular-nums')}>{row.phone ? <Hit hit={phones.has(row.phone)}>{row.phone}</Hit> : '—'}</td>
              <td className={TD}><span className="block max-w-[280px] truncate" title={row.email ?? undefined}>{row.email ? <Hit hit={emails.has(row.email.toLowerCase())}>{row.email}</Hit> : '—'}</span></td>
              <td className={TD}><ProfileMeter active={row.active_profile_count} total={row.profile_count} /></td>
              <td className={clsx(TD, 'whitespace-nowrap text-xs')}>{sourceLabel(row.source)}</td>
              <td className={clsx(TD, 'whitespace-nowrap text-xs tabular-nums')}>{dateLabel(row.updated_at, false)}</td>
              <td className={clsx(TD, 'text-right')}>
                <button type="button" onClick={(event) => { event.stopPropagation(); onOpen(row); }}
                  className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 transition-colors group-hover:border-blue-600 group-hover:bg-blue-600 group-hover:text-white dark:border-blue-500/30 dark:bg-transparent dark:text-blue-300 dark:group-hover:bg-blue-600 dark:group-hover:text-white', focus)}>
                  View profiles <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>}
  </section>;
}

function ProfileMeter({ active, total }: { active: number; total: number }) {
  if (!total) return <span className="text-xs text-zinc-400">No profiles</span>;
  return <div className="w-28">
    <p className="text-xs tabular-nums"><span className="font-semibold text-zinc-900 dark:text-white">{total}</span> <span className="text-zinc-500 dark:text-zinc-400">· {active} active</span></p>
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(active / total) * 100}%` }} />
    </div>
  </div>;
}
