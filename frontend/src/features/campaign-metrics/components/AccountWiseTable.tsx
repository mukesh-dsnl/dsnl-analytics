import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { campaignApi } from '../api';
import type { CampaignFilter, AccountMetricsRow } from '../api';
import type { SortState } from '../useSortableRows';
import { usePagination } from '../usePagination';
import { SummaryLink } from './SummaryLink';
import { summaryPath } from '../links';
import { ConnectedBar } from './ConnectedBar';
import {
  SortableHeader,
  TableCard,
  TablePager,
  TableStatus,
  TH_CLASS,
  TOTAL_CELL,
} from './TableChrome';
import { AccountInsightDialog } from './AccountInsightDialog';
import { ChartButton } from './ChartButton';
import { SMALL_GROUP, isNoAccount } from '../labels';
import type { MeasureLabels } from '../labels';

type SortKey = keyof AccountMetricsRow;

interface AccountWiseTableProps {
  filters: CampaignFilter;
  rows: AccountMetricsRow[] | undefined;
  isLoading: boolean;
  error: Error | null;
  sort: SortState<SortKey>;
  onSort: (key: SortKey) => void;
  /**
   * Whether to reserve the CPIN column. True for Conference and Multicall,
   * where CODR supplies a chairperson PIN per CRN; false for Voicedrop, which
   * has none and would otherwise carry a column empty on every row.
   */
  showCpin: boolean;
  /** The measure columns' names, in the service's own words. */
  labels: MeasureLabels;
  /**
   * Where a row leads instead of expanding: Voicedrop and Conference open the
   * account's campaigns on the Campaigns tab. Unset (MultiCall), a row
   * expands into its CRNs as before.
   */
  onOpenAccount?: (account: string) => void;
}

/** The five measures, shared by the account rows and the CRN rows beneath them. */
const measureColumns = (labels: MeasureLabels): { key: SortKey; label: string; title?: string }[] => [
  { key: 'total_size', label: labels.total },
  { key: 'connected_size', label: labels.connected },
  { key: 'not_connected_size', label: labels.notConnected },
  { key: 'connected_percentage', label: labels.percent, title: labels.percentNote },
  { key: 'total_minutes', label: 'Minutes' },
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
  showCpin,
  labels,
  onOpenAccount,
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
          // The only scrolling element: rows move under a pinned header rather
          // than the whole card sliding up the page.
          <div className="flex-1 min-h-0 overflow-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={`${TH_CLASS} w-10`} />
                  <SortableHeader
                    label="Account"
                    sortKey="account"
                    sort={sort}
                    onSort={onSort}
                    align="left"
                  />
                  {/* Reserved but unlabelled: a CPIN belongs to a room, not an
                      account, so nothing on this level of the table ever fills
                      it. The column still has to exist here to keep the CRN
                      rows aligned with the account row above them, and the
                      sub-header names it where it actually carries values. */}
                  {showCpin && <th className={`${TH_CLASS} w-32`} />}
                  {measureColumns(labels).map((column) => (
                    <SortableHeader
                      key={column.key}
                      label={column.label}
                      sortKey={column.key}
                      sort={sort}
                      onSort={onSort}
                      align="right"
                      title={column.title}
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
                    showCpin={showCpin}
                    labels={labels}
                    onChart={(crn) => setCharting({ account: row.account, crn })}
                    onOpen={onOpenAccount}
                  />
                ))}
              </tbody>
              {rows && rows.length > 1 && <AccountTotalRow rows={rows} showCpin={showCpin} />}
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
  showCpin: boolean;
  labels: MeasureLabels;
  onChart: (crn?: string) => void;
  onOpen?: (account: string) => void;
}

function AccountRow({ filters, row, showCpin, labels, onChart, onOpen }: AccountRowProps) {
  const [expanded, setIsOpen] = useState(false);
  // ACCOUNTID 0 is "no account", not an account called 0 — nearly all of MultiCall.
  const noAccount = isNoAccount(row.account);
  const who = noAccount ? 'calls with no account' : `account ${row.account}`;
  // A row that leads elsewhere never expands.
  const isOpen = !onOpen && expanded;

  const { data, isPending, error } = useQuery({
    queryKey: ['campaign-account-crn', filters.date, filters.service, row.account],
    queryFn: () => campaignApi.accountCrn(filters, row.account),
    enabled: isOpen,
    staleTime: 60_000,
  });

  const children = data?.rows ?? [];
  // Chevron + account + optional CPIN + five measures + chart button.
  const columnCount = 8 + (showCpin ? 1 : 0);
  // An open account and its CRNs read as one tinted block, so the drill-down is
  // visibly bounded rather than blending into the rows after it.
  const openCell = isOpen ? 'bg-blue-50/60 dark:bg-blue-500/[0.07]' : '';

  return (
    <>
      {/* The whole row toggles — the chevron is an affordance, not the only
          target. The chart button stops propagation so it doesn't also expand. */}
      <tr
        onClick={() => (onOpen ? onOpen(row.account) : setIsOpen((v) => !v))}
        aria-expanded={onOpen ? undefined : isOpen}
        title={onOpen ? `Show the ${labels.campaignWord} of ${who}` : undefined}
        className={clsx(
          'cursor-pointer transition-colors',
          isOpen
            ? 'border-t border-blue-200 dark:border-blue-500/30'
            : 'border-b border-[#eef2f8] dark:border-zinc-800/40 hover:bg-[#f4f8fd] dark:hover:bg-white/[0.03]',
        )}
      >
        <td className={clsx('pl-4 py-3', openCell)}>
          {!onOpen && (
            <ChevronRight
              className={clsx(
                'w-4 h-4 text-zinc-400 transition-transform',
                isOpen && 'rotate-90 text-blue-500',
              )}
            />
          )}
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
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-zinc-900 dark:text-white">
                {noAccount ? (
                  <span title="Calls that carry no account (ACCOUNTID 0)">No account</span>
                ) : summaryPath(filters.service, row.account) ? (
                  <SummaryLink to={summaryPath(filters.service, row.account)!} title={`Open account ${row.account}'s summary`}>
                    {row.account}
                  </SummaryLink>
                ) : (
                  row.account
                )}
              </span>
              {row.account_name && (
                <span
                  className="block max-w-[340px] truncate text-xs font-normal text-zinc-500 dark:text-zinc-400"
                  title={row.account_name}
                >
                  {row.account_name}
                </span>
              )}
            </span>
          </span>
        </td>
        {/* Empty on the account row: a CPIN belongs to a room, not an account. */}
        {showCpin && <td className={clsx('px-4 py-3', openCell)} />}
        <td className={clsx(NUM_PARENT, openCell)}>{row.total_size.toLocaleString()}</td>
        <td className={clsx(NUM_PARENT, openCell)}>{row.connected_size.toLocaleString()}</td>
        <td className={clsx(NUM_PARENT, openCell)}>{row.not_connected_size.toLocaleString()}</td>
        <td className={clsx('px-4 py-3', openCell)}>
          <ConnectedBar value={row.connected_percentage} muted={row.total_size < SMALL_GROUP} unit={labels.unit} />
        </td>
        <td className={clsx(NUM_PARENT, openCell)}>{row.total_minutes.toLocaleString()}</td>
        <td className={clsx('px-4 py-3 text-right', openCell)}>
          <ChartButton
            label={`View charts for ${who}`}
            onClick={() => onChart(undefined)}
          />
        </td>
      </tr>

      {isOpen && (
        <>
          {/* The sub-header renames only the identity columns — the five
              measures are the same ones above, so repeating their names is what
              makes the drill-down read as a continuation rather than a new
              table. */}
          <tr className="bg-blue-50/60 dark:bg-blue-500/[0.07]">
            <td />
            <td className="pl-12 pr-4 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              CRN
            </td>
            {showCpin && (
              <td className="px-4 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                CPIN
              </td>
            )}
            {measureColumns(labels).map((column) => (
              <td
                key={column.key}
                className="px-4 pt-2 pb-1.5 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500"
              >
                {column.label}
              </td>
            ))}
            <td />
          </tr>

          {isPending && <SubRowMessage span={columnCount - 1} loading>Loading CRNs…</SubRowMessage>}
          {error && (
            <SubRowMessage span={columnCount - 1} tone="error">
              {(error as Error).message}
            </SubRowMessage>
          )}
          {!isPending && !error && children.length === 0 && (
            <SubRowMessage span={columnCount - 1}>No CRNs for this account.</SubRowMessage>
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
              {showCpin && (
                <td className="px-4 py-2.5 text-sm text-zinc-600 dark:text-zinc-400 tabular-nums">
                  {/* On MultiCall a CPIN opens its registrations, searched for it. */}
                  {child.cpin && filters.service === 'multicall' ? (
                    <SummaryLink
                      to={`/analytics/multicall/registry?cpins=${encodeURIComponent(child.cpin)}`}
                      title={`Look up CPIN ${child.cpin} in the registration lookup`}
                    >
                      {child.cpin}
                    </SummaryLink>
                  ) : (
                    (child.cpin ?? '—')
                  )}
                </td>
              )}
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
            <td colSpan={columnCount} className="h-1.5 bg-blue-50/60 dark:bg-blue-500/[0.07]" />
          </tr>
        </>
      )}
    </>
  );
}

/**
 * The day's totals, pinned under the rows. An account's row is its own CRNs
 * and nothing else, so unlike the provider table these do add up: the Total is
 * the plain sum of every row (all pages, not only the one in view).
 */
function AccountTotalRow({ rows, showCpin }: { rows: AccountMetricsRow[]; showCpin: boolean }) {
  const total = rows.reduce((t, r) => t + r.total_size, 0);
  const connected = rows.reduce((t, r) => t + r.connected_size, 0);
  const minutes = rows.reduce((t, r) => t + r.total_minutes, 0);
  return (
    <tfoot>
      <tr>
        <td className={TOTAL_CELL} />
        <td className={clsx(TOTAL_CELL, 'px-4 py-3 text-sm font-semibold text-zinc-900 dark:text-white')}>
          Total
          <span className="font-normal text-zinc-500 dark:text-zinc-400"> · {rows.length.toLocaleString()} accounts</span>
        </td>
        {showCpin && <td className={TOTAL_CELL} />}
        <td className={clsx(TOTAL_CELL, NUM_PARENT)}>{total.toLocaleString()}</td>
        <td className={clsx(TOTAL_CELL, NUM_PARENT)}>{connected.toLocaleString()}</td>
        <td className={clsx(TOTAL_CELL, NUM_PARENT)}>{(total - connected).toLocaleString()}</td>
        <td className={clsx(TOTAL_CELL, 'px-4 py-3')}>
          <ConnectedBar value={total ? (connected / total) * 100 : 0} />
        </td>
        <td className={clsx(TOTAL_CELL, NUM_PARENT)}>{minutes.toLocaleString()}</td>
        <td className={TOTAL_CELL} />
      </tr>
    </tfoot>
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
function SubRowMessage({
  children,
  span,
  tone,
  loading,
}: {
  children: React.ReactNode;
  span: number;
  tone?: 'error';
  loading?: boolean;
}) {
  return (
    <tr className="bg-blue-50/60 dark:bg-blue-500/[0.07]">
      <td />
      <td
        colSpan={span}
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
