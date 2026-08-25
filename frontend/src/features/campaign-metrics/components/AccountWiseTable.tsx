import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, ChevronRight, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { campaignApi } from '../api';
import type { CampaignFilter, AccountMetricsRow } from '../api';
import { useSortableRows } from '../useSortableRows';
import { PercentagePill } from './PercentagePill';
import {
  SortableHeader,
  TableCard,
  TableStatus,
  TH_CLASS,
  TD_CLASS,
  TD_CLASS_RIGHT,
} from './TableChrome';
import { AccountInsightDialog } from './AccountInsightDialog';

interface AccountWiseTableProps {
  filters: CampaignFilter;
  rows: AccountMetricsRow[] | undefined;
  isLoading: boolean;
  error: Error | null;
}

type SortKey = keyof AccountMetricsRow;

const COLUMNS: { key: SortKey; label: string; align: 'left' | 'right' }[] = [
  { key: 'account', label: 'Account', align: 'left' },
  { key: 'total_size', label: 'Total Size', align: 'right' },
  { key: 'connected_size', label: 'Connected Size', align: 'right' },
  { key: 'not_connected_size', label: 'Not Connected Size', align: 'right' },
  { key: 'connected_percentage', label: 'Connected %', align: 'right' },
  { key: 'total_minutes', label: 'Total Minutes', align: 'right' },
];

/**
 * The Account Wise table.
 *
 * Each account row is the exact sum of the CRN rows it expands into — the
 * backend aggregates per CRN and then rolls up, so the figures visibly add up
 * once a row is open. Those CRN rows are fetched only on first expand rather
 * than upfront for every account, since most rows are never opened.
 */
export function AccountWiseTable({ filters, rows, isLoading, error }: AccountWiseTableProps) {
  const { rows: sorted, sort, toggle } = useSortableRows<AccountMetricsRow, SortKey>(rows, {
    key: 'total_size',
    direction: 'desc',
  });
  // Which row's chart popup is open, if any. Null keeps the dialog unmounted,
  // which is also what keeps its request from firing.
  const [charting, setCharting] = useState<{ account: string; crn?: string } | null>(null);

  const isEmpty = !isLoading && !error && (sorted?.length ?? 0) === 0;

  return (
    <>
      <TableCard>
        <TableStatus isLoading={isLoading} error={error} isEmpty={isEmpty} />
        {!isLoading && !error && !isEmpty && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800/60">
                  <th className={`${TH_CLASS} w-8`} />
                  {COLUMNS.map((column) => (
                    <SortableHeader
                      key={column.key}
                      label={column.label}
                      sortKey={column.key}
                      sort={sort}
                      onSort={toggle}
                      align={column.align}
                    />
                  ))}
                  <th className={`${TH_CLASS} w-10`} />
                </tr>
              </thead>
              <tbody>
                {sorted!.map((row) => (
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

  return (
    <>
      {/* The whole row toggles — the chevron is an affordance, not the only
          target. The chart button stops propagation so it doesn't also expand. */}
      <tr
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        className={clsx(
          'border-b border-zinc-100 dark:border-zinc-800/40 cursor-pointer transition-colors',
          isOpen
            ? 'bg-zinc-50 dark:bg-zinc-800/40'
            : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/30',
        )}
      >
        <td className={TD_CLASS}>
          <ChevronRight
            className={clsx(
              'w-4 h-4 text-zinc-400 transition-transform',
              isOpen && 'rotate-90',
            )}
          />
        </td>
        {/* Parent rows carry the weight; the CRN rows below are deliberately
            lighter, so the two levels never read as one flat list. */}
        <td className={`${TD_CLASS} font-bold text-zinc-900 dark:text-white`}>{row.account}</td>
        <td className={`${TD_CLASS_RIGHT} font-bold text-zinc-900 dark:text-white`}>
          {row.total_size.toLocaleString()}
        </td>
        <td className={`${TD_CLASS_RIGHT} font-bold text-zinc-900 dark:text-white`}>
          {row.connected_size.toLocaleString()}
        </td>
        <td className={`${TD_CLASS_RIGHT} font-bold text-zinc-900 dark:text-white`}>
          {row.not_connected_size.toLocaleString()}
        </td>
        <td className={TD_CLASS_RIGHT}>
          <PercentagePill value={row.connected_percentage} />
        </td>
        <td className={`${TD_CLASS_RIGHT} font-bold text-zinc-900 dark:text-white`}>
          {row.total_minutes.toLocaleString()}
        </td>
        <td className={TD_CLASS_RIGHT}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChart(undefined);
            }}
            aria-label={`View charts for account ${row.account}`}
            title="View charts"
            className="p-1.5 rounded-md text-zinc-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:text-blue-400 dark:hover:bg-blue-500/10 transition-colors"
          >
            <BarChart3 className="w-4 h-4" />
          </button>
        </td>
      </tr>

      {isOpen && isPending && (
        <SubRowMessage>
          <span className="inline-flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading CRNs…
          </span>
        </SubRowMessage>
      )}
      {isOpen && error && (
        <SubRowMessage tone="error">{(error as Error).message}</SubRowMessage>
      )}
      {isOpen && !isPending && !error && children.length === 0 && (
        <SubRowMessage>No CRNs for this account.</SubRowMessage>
      )}

      {/* No repeated header here: the columns line up with the parent's, so a
          second header row would only add noise between the two levels. */}
      {isOpen &&
        children.map((child) => (
          <tr
            key={child.crn}
            className="border-b border-zinc-100 dark:border-zinc-800/40 bg-zinc-50/60 dark:bg-zinc-900/40 hover:bg-zinc-100/70 dark:hover:bg-zinc-800/40 transition-colors"
          >
            <td className={TD_CLASS} />
            <td className={`${TD_CLASS} pl-8 text-zinc-500 dark:text-zinc-500`}>{child.crn}</td>
            <td className={`${TD_CLASS_RIGHT} text-zinc-500 dark:text-zinc-500`}>
              {child.total_size.toLocaleString()}
            </td>
            <td className={`${TD_CLASS_RIGHT} text-zinc-500 dark:text-zinc-500`}>
              {child.connected_size.toLocaleString()}
            </td>
            <td className={`${TD_CLASS_RIGHT} text-zinc-500 dark:text-zinc-500`}>
              {child.not_connected_size.toLocaleString()}
            </td>
            <td className={`${TD_CLASS_RIGHT} text-zinc-500 dark:text-zinc-500`}>
              {child.connected_percentage.toFixed(1)}%
            </td>
            <td className={`${TD_CLASS_RIGHT} text-zinc-500 dark:text-zinc-500`}>
              {child.total_minutes.toLocaleString()}
            </td>
            <td className={TD_CLASS_RIGHT}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChart(child.crn);
                }}
                aria-label={`View charts for CRN ${child.crn}`}
                title="View charts"
                className="p-1.5 rounded-md text-zinc-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:text-blue-400 dark:hover:bg-blue-500/10 transition-colors"
              >
                <BarChart3 className="w-3.5 h-3.5" />
              </button>
            </td>
          </tr>
        ))}
    </>
  );
}

function SubRowMessage({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: 'error';
}) {
  return (
    <tr className="border-b border-zinc-100 dark:border-zinc-800/40 bg-zinc-50/60 dark:bg-zinc-900/40">
      <td
        colSpan={8}
        className={clsx(
          'px-4 py-2.5 pl-12 text-xs',
          tone === 'error' ? 'text-red-600 dark:text-red-400' : 'text-zinc-400',
        )}
      >
        {children}
      </td>
    </tr>
  );
}
