import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ContactRound, Info, SearchX } from 'lucide-react';
import { multicallApi } from '../api';
import type { RegistrationMatch, SearchCriteria, SearchField } from '../api';
import { AccountView } from '../components/AccountView';
import { ResultsTable } from '../components/ResultsTable';
import { SearchPanel } from '../components/SearchPanel';
import { useHeaderSlot } from '../../../components/HeaderSlot';
import { EMPTY_DRAFTS, FIELD_BY_KEY, SEARCH_FIELDS, isDuplicateRegNum, surface, toCriteria } from '../lookup';

function matchesFilter(row: RegistrationMatch, needle: string): boolean {
  return [row.name, row.phone, row.email, row.reg_num]
    .some((value) => value != null && String(value).toLowerCase().includes(needle));
}

/**
 * Registration lookup: a centred search that docks to the top once used,
 * matching accounts below it, and each account's profiles one click away —
 * with previous/next to walk through every account in the results.
 *
 * Nothing reaches the source database until Search is pressed or an account
 * is opened; both are single read-only SELECTs.
 */
export function MulticallRegistryPage() {
  const [drafts, setDrafts] = useState<Record<SearchField, string>>(EMPTY_DRAFTS);
  const [submitted, setSubmitted] = useState<SearchCriteria | null>(null);
  const [filter, setFilter] = useState('');
  const [openReg, setOpenReg] = useState<string | null>(null);
  const [recent, setRecent] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const headerSlot = useHeaderSlot();

  const search = useQuery({
    queryKey: ['multicall', 'search', submitted],
    queryFn: () => multicallApi.search(submitted!),
    enabled: !!submitted,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const allRows = useMemo(() => search.data?.rows ?? [], [search.data]);
  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle ? allRows.filter((row) => matchesFilter(row, needle)) : allRows;
  }, [allRows, filter]);
  // Navigation walks the list as it was shown; an account opened from a
  // filtered list keeps its place even if it is the only one left.
  const openIndex = openReg == null ? -1 : rows.findIndex((row) => String(row.reg_num) === openReg);
  const accountList = openIndex >= 0 ? rows : allRows;
  const accountIndex = openReg == null ? -1 : accountList.findIndex((row) => String(row.reg_num) === openReg);

  function runSearch() {
    const criteria = toCriteria(drafts);
    // The same search again is a deliberate refresh, not a cache hit.
    if (JSON.stringify(criteria) === JSON.stringify(submitted)) void search.refetch();
    else setSubmitted(criteria);
    setFilter('');
    setOpenReg(null);
    setRecent(null);
  }

  function reset() {
    setDrafts(EMPTY_DRAFTS);
    setSubmitted(null);
    setFilter('');
    setOpenReg(null);
    setRecent(null);
  }

  const openAccount = useCallback((reg: string) => {
    setOpenReg(reg);
    setRecent(reg);
  }, []);
  const navigate = useCallback((index: number) => {
    const row = accountList[index];
    if (row) openAccount(String(row.reg_num));
  }, [accountList, openAccount]);
  const back = useCallback(() => setOpenReg(null), []);

  // Switching view keeps the reader oriented: the top of an account, or the
  // row they came back from in the results.
  useEffect(() => {
    if (openReg) topRef.current?.scrollIntoView({ block: 'start' });
    else if (recent) document.getElementById(`mc-row-${recent}`)?.scrollIntoView({ block: 'center' });
  }, [openReg, recent]);

  const docked = submitted !== null;
  const duplicateRegs = submitted ? submitted.reg_nums.filter(isDuplicateRegNum) : [];
  const searchedTotal = submitted ? SEARCH_FIELDS.reduce((sum, field) => sum + submitted[field.key].length, 0) : 0;

  return <div ref={topRef} className="mx-auto max-w-[1600px] scroll-mt-4 p-4 pb-12 sm:p-6 lg:p-8">
    {/* The page's name lives in the layout header, at its left edge. */}
    {headerSlot && createPortal(
      <div className="flex min-w-0 items-center gap-2">
        <ContactRound className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
        <h1 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">MultiCall Registration Lookup</h1>
      </div>,
      headerSlot,
    )}

    {/* One horizontal bar throughout: it waits mid-page, then rises to the top once used. */}
    <div className={clsx('transition-[padding] duration-500 ease-out motion-reduce:transition-none', docked ? 'pt-0' : 'pt-[16vh] sm:pt-[22vh]')}>
      <SearchPanel drafts={drafts} onChange={(field, value) => setDrafts((current) => ({ ...current, [field]: value }))}
        onSubmit={runSearch} onReset={reset} docked={docked} pending={search.isFetching} />
    </div>

    {docked && <div className="mt-5 space-y-4">
      {duplicateRegs.length > 0 && <p role="status" className="mc-rise flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {duplicateRegs.length === 1 ? 'Reg Num' : 'Reg Nums'} <span className="font-semibold tabular-nums">{duplicateRegs.slice(0, 8).join(', ')}{duplicateRegs.length > 8 ? ` +${duplicateRegs.length - 8} more` : ''}</span> {duplicateRegs.length === 1 ? 'is a duplicate' : 'are duplicates'} and {duplicateRegs.length === 1 ? 'is' : 'are'} not shown — only main accounts, whose Reg Num is divisible by 8, appear in results.
        </span>
      </p>}
      {search.isPending ? <ResultsSkeleton />
      : search.isError ? <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-700/40 dark:bg-red-500/10 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>{search.error.message}</p>
        </div>
      : allRows.length === 0 ? <div className={clsx(surface, 'mc-rise flex flex-col items-center px-6 py-16 text-center')}>
          <span className="rounded-2xl bg-zinc-100 p-3 text-zinc-400 dark:bg-zinc-800"><SearchX className="h-6 w-6" /></span>
          <h2 className="mt-4 text-sm font-semibold text-zinc-900 dark:text-white">No account matched {searchedTotal === 1 ? 'this value' : `any of these ${searchedTotal} values`}</h2>
          <p className="mt-1 max-w-md text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            Matching is exact and only main accounts (Reg Num divisible by 8) are listed. Phone and email also check contacts saved on profiles, and CPIN checks every profile's chairperson PIN.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-1.5">
            {SEARCH_FIELDS.filter((field) => submitted![field.key].length).map((field) => <span key={field.key} className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{FIELD_BY_KEY[field.key].label}: {submitted![field.key].length}</span>)}
          </div>
        </div>
      : accountIndex >= 0 ? <AccountView accounts={accountList} index={accountIndex} criteria={submitted!} onNavigate={navigate} onBack={back} />
      : <ResultsTable rows={rows} totalRows={allRows.length} truncated={search.data.truncated} criteria={submitted!}
          filter={filter} onFilter={setFilter} onOpen={(row) => openAccount(String(row.reg_num))} recent={recent} />}
    </div>}
  </div>;
}

function ResultsSkeleton() {
  return <div className={clsx(surface, 'overflow-hidden')} aria-busy="true" aria-label="Searching">
    <div className="border-b border-zinc-100 px-5 py-4 dark:border-zinc-800"><div className="h-4 w-32 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" /></div>
    {Array.from({ length: 6 }, (_, i) => <div key={i} className="flex items-center gap-4 border-b border-zinc-100 px-5 py-4 last:border-b-0 dark:border-zinc-800">
      <div className="h-9 w-9 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
      <div className="flex-1 space-y-2"><div className="h-3.5 w-1/4 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" /><div className="h-3 w-1/6 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" /></div>
      <div className="hidden h-3 w-1/5 animate-pulse rounded bg-zinc-100 sm:block dark:bg-zinc-800" />
      <div className="h-8 w-28 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
    </div>)}
  </div>;
}
