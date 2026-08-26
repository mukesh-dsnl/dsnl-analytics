import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, ChevronRight, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { campaignApi } from '../api';
import type { CampaignFilter, AccountMetricsRow } from '../api';
import type { SortState } from '../useSortableRows';
import { usePagination } from '../usePagination';
import { ConnectedBar } from './ConnectedBar';
import { SortableHeader, TableCard, TablePager, TableStatus, TH_CLASS } from './TableChrome';
import { AccountInsightDialog } from './AccountInsightDialog';

type SortKey = keyof AccountMetricsRow;

interface AccountWiseTableProps {
  filters: CampaignFilter;
  rows: AccountMetricsRow[] | undefined;
  isLoading: boolean;
  error: Error | null;
  sort: SortState<SortKey>;
  onSort: (key: SortKey) => void;
}

const COLUMNS: { key: SortKey; label: string; align: 'left' | 'right' }[] = [
  { key: 'account', label: 'Account', align: 'left' },
  { key: 'total_size', label: 'Total Size', align: 'right' },
  { key: 'connected_size', label: 'Connected Size', align: 'right' },
  { key: 'not_connected_size', label: 'Not Connected Size', align: 'right' },
  { key: 'connected_percentage', label: 'Connected %', align: 'right' },
  { key: 'total_minutes', label: 'Total Minutes', align: 'right' },
];

/** Numeric cells share one class so the two row levels align on the decimal. */
const NUM = 'px-4 py-3 text-right text-sm tabular-nums';
const NUM_PARENT = `${NUM} font-semibold text-zinc-900 dark:text-white`;
const NUM_CHILD = `${NUM} text-zinc-500 dark:text-zinc-400`;

/**
 * The Account Wise table.
 *
 * Each account row is the exact sum of the CRN rows it expands into — the
 * backend aggregates per CRN and then rolls up, so the figures visibly add up
 * once a row is open. Those CRN rows are fetched only on first expand rather
 * than upfront for every account, since most rows are never opened.
 */
export function AccountWiseTable({
  filters,
  rows,
  isLoading,
  error,
  sort,
  onSort,
}: AccountWiseTableProps) {
  // Paged from the already-sorted list, so sorting reorders the whole table
  // rather than shuffling only the page in view.
  const { pageRows, page, pageCount, total, setPage, isPaged } = usePagination(rows);
  // Which row's chart popup is open, if any. Null keeps the dialog unmounted,
  // which is also what keeps its request from firing.
  const [charting, setCharting] = useState<{ account: string; crn?: string } | null>(null);

  const isEmpty = !isLoading && !error && (rows?.length ?? 0) === 0;

  return (
    <>
      <TableCard>
        <TableStatus isLoading={isLoading} error={error} isEmpty={isEmpty} />
        {!isLoading && !error && !isEmpty && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800/60">
                  <th className={`${TH_CLASS} w-10`} />
                  {COLUMNS.map((column) => (
                    <SortableHeader
                      key={column.key}
                      label={column.label}
                      sortKey={column.key}
                      sort={sort}
                      onSort={onSort}
                      align={column.align}
                    />
                  ))}
                  <th className={`${TH_CLASS} w-14`} />
                </tr>
              </thead>
              <tbody>
                {pageRows!.map((row) => (
                  <AccountRow
                    key={row.account}
                    filters={filters}
                    row={row}
                    onChart={(crn) => setCharting({ account: row.account, crn })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!isLoading && !error && !isEmpty && isPaged && (
          <TablePager page={page} pageCount={pageCount} total={total} onPage={setPage} />
        )}
      </TableCard>

      {charting && (
        <AccountInsightDialog
          filters={filters}
          account={charting.account}
          crn={charting.crn}
          onClose={() => setCharting(null)}
        />
      )}
    </>
  );
}

interface AccountRowProps {
  filters: CampaignFilter;
  row: AccountMetricsRow;
  onChart: (crn?: string) => void;
}

function AccountRow({ filters, row, onChart }: AccountRowProps) {
  const [isOpen, setIsOpen] = useState(false);

  const { data, isPending, error } = useQuery({
    queryKey: ['campaign-account-crn', filters.date, filters.service, row.account],
    queryFn: () => campaignApi.accountCrn(filters, row.account),
    enabled: isOpen,
    staleTime: 60_000,
  });

  const children = data?.rows ?? [];
  // An open account and its CRNs read as one tinted block, so the drill-down is
  // visibly bounded rather than blending into the rows after it.
  const openCell = isOpen ? 'bg-blue-50/60 dark:bg-blue-500/[0.07]' : '';

  return (
    <>
      {/* The whole row toggles — the chevron is an affordance, not the only
          target. The chart button stops propagation so it doesn't also expand. */}
      <tr
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        className={clsx(
          'cursor-pointer transition-colors',
          isOpen
            ? 'border-t border-blue-200 dark:border-blue-500/30'
            : 'border-b border-zinc-100 dark:border-zinc-800/40 hover:bg-zinc-50 dark:hover:bg-zinc-800/30',
        )}
      >
        <td className={clsx('pl-4 py-3', openCell)}>
          <ChevronRight
            className={clsx(
              'w-4 h-4 text-zinc-400 transition-transform',
              isOpen && 'rotate-90 text-blue-500',
            )}
          />
        </td>
        <td className={clsx('px-4 py-3', openCell)}>
          <span className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className={clsx(
                'inline-flex items-center justify-center w-7 h-7 rounded-lg text-[10px] font-bold shrink-0',
                isOpen
                  ? 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400'
                  : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
              )}
            >
              AC
            </span>
            <span className="text-sm font-semibold text-zinc-900 dark:text-white">
              {row.account}
            </span>
          </span>
        </td>
        <td className={clsx(NUM_PARENT, openCell)}>{row.total_size.toLocaleString()}</td>
        <td className={clsx(NUM_PARENT, openCell)}>{row.connected_size.toLocaleString()}</td>
        <td className={clsx(NUM_PARENT, openCell)}>{row.not_connected_size.toLocaleString()}</td>
        <td className={clsx('px-4 py-3', openCell)}>
          <ConnectedBar value={row.connected_percentage} />
        </td>
        <td className={clsx(NUM_PARENT, openCell)}>{row.total_minutes.toLocaleString()}</td>
        <td className={clsx('px-4 py-3 text-right', openCell)}>
          <ChartButton
            label={`View charts for account ${row.account}`}
            onClick={() => onChart(undefined)}
          />
        </td>
      </tr>

      {isOpen && (
        <>
          {/* The sub-header renames only the first column — the other five are
              the same measures as above, so repeating their names is what makes
              the drill-down read as a continuation rather than a new table. */}
          <tr className="bg-blue-50/60 dark:bg-blue-500/[0.07]">
            <td />
            <td className="pl-12 pr-4 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              CRN
            </td>
            {COLUMNS.slice(1).map((column) => (
              <td
                key={column.key}
                className="px-4 pt-2 pb-1.5 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500"
              >
                {column.label}
              </td>
            ))}
            <td />
          </tr>

          {isPending && <SubRowMessage loading>Loading CRNs…</SubRowMessage>}
          {error && <SubRowMessage tone="error">{(error as Error).message}</SubRowMessage>}
          {!isPending && !error && children.length === 0 && (
            <SubRowMessage>No CRNs for this account.</SubRowMessage>
          )}

          {children.map((child, index) => (
            <tr
              key={child.crn}
              className="bg-blue-50/60 dark:bg-blue-500/[0.07] hover:bg-blue-100/50 dark:hover:bg-blue-500/[0.12] transition-colors"
            >
              <td />
              <td className="pl-8 pr-4 py-2.5">
                <span className="flex items-stretch">
                  {/* Tree elbow: the trunk stops at the last child rather than
                      running past it into the rows below. */}
                  <span aria-hidden="true" className="relative w-4 shrink-0 self-stretch">
                    <span
                      className={clsx(
                        'absolute left-0 w-px bg-zinc-300 dark:bg-zinc-700',
                        index === children.length - 1 ? 'top-0 h-1/2' : 'inset-y-0',
                      )}
                    />
                    <span className="absolute left-0 top-1/2 w-3 h-px bg-zinc-300 dark:bg-zinc-700" />
                  </span>
                  <span className="pl-2 text-sm text-zinc-600 dark:text-zinc-400">{child.crn}</span>
                </span>
              </td>
              <td className={NUM_CHILD}>{child.total_size.toLocaleString()}</td>
              <td className={NUM_CHILD}>{child.connected_size.toLocaleString()}</td>
              <td className={NUM_CHILD}>{child.not_connected_size.toLocaleString()}</td>
              <td className="px-4 py-2.5">
                <ConnectedBar value={child.connected_percentage} dim />
              </td>
              <td className={NUM_CHILD}>{child.total_minutes.toLocaleString()}</td>
              <td className="px-4 py-2.5 text-right">
                <ChartButton
                  label={`View charts for CRN ${child.crn}`}
                  onClick={() => onChart(child.crn)}
                />
              </td>
            </tr>
          ))}

          {/* Closes the tinted block so the next account starts cleanly. */}
          <tr className="border-b border-blue-200 dark:border-blue-500/30">
            <td colSpan={8} className="h-1.5 bg-blue-50/60 dark:bg-blue-500/[0.07]" />
          </tr>
        </>
      )}
    </>
  );
}

/**
 * The row's "open the charts" control.
 *
 * A standing bordered button rather than an icon that only materialises on
 * hover: the row is already clickable for expand/collapse, so the one control
 * that does something *else* has to look like a control at rest, or it reads as
 * part of the row and gets found by accident.
 */
function ChartButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title="View charts"
      className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 hover:text-blue-600 hover:border-blue-400 hover:bg-blue-50 dark:hover:text-blue-400 dark:hover:border-blue-500/50 dark:hover:bg-blue-500/10 transition-colors"
    >
      <BarChart3 className="w-4 h-4" />
    </button>
  );
}

function SubRowMessage({
  children,
  tone,
  loading,
}: {
  children: React.ReactNode;
  tone?: 'error';
  loading?: boolean;
}) {
  return (
    <tr className="bg-blue-50/60 dark:bg-blue-500/[0.07]">
      <td />
      <td
        colSpan={7}
        className={clsx(
          'pl-12 pr-4 py-2.5 text-xs',
          tone === 'error' ? 'text-red-600 dark:text-red-400' : 'text-zinc-400',
        )}
      >
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {children}
          </span>
        ) : (
          children
        )}
      </td>
    </tr>
  );
}
