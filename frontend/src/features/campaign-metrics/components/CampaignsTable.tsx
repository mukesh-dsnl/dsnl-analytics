import { useState } from 'react';
import { AlertTriangle, Download, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { isIncomplete } from '../campaignRows';
import type { CampaignSortKey, CampaignTableRow } from '../campaignRows';
import type { SortState } from '../useSortableRows';
import { ConnectedBar } from './ConnectedBar';
import { ROW_ACTION_CLASS, ROW_ACTION_IDLE_CLASS, SortableHeader, TableCard, TableStatus, TH_CLASS } from './TableChrome';
import { campaignApi } from '../api';
import { downloadCsv } from '../exportCsv';

interface CampaignsTableProps {
  rows: CampaignTableRow[] | undefined;
  isLoading: boolean;
  error: Error | null;
  sort: SortState<CampaignSortKey>;
  onSort: (key: CampaignSortKey) => void;
}

/** The numeric columns, in reading order: what was loaded, what was dialled, how it went. */
const MEASURES: { key: CampaignSortKey; label: string }[] = [
  { key: 'phone_number_count', label: 'Numbers' },
  { key: 'dnd_count', label: 'DND' },
  { key: 'dialout_count', label: 'Dial Out' },
  { key: 'blast_count', label: 'Blast' },
  { key: 'unblast_count', label: 'Unblast' },
  { key: 'connected', label: 'Connected' },
  { key: 'not_connected', label: 'Not Conn.' },
];

const CELL = 'px-3 py-2.5 align-middle';
const NUM = `${CELL} text-right text-sm tabular-nums whitespace-nowrap`;

/**
 * The Campaigns table — Voicedrop only: one row per campaign (CRN) on the
 * selected day, as q100_dump.voicedrop_summary records it.
 *
 * Built to be read at a glance rather than paged through: a day holds at most
 * a couple of hundred campaigns, so every row is on one scrolling list under a
 * pinned header. A campaign with numbers left unblasted did not finish — its
 * row is tinted red, so it stands out without being searched for.
 */
export function CampaignsTable({ rows, isLoading, error, sort, onSort }: CampaignsTableProps) {
  const isEmpty = !isLoading && !error && (rows?.length ?? 0) === 0;
  const ready = !isLoading && !error && !isEmpty && rows;

  return (
    <TableCard>
      <TableStatus isLoading={isLoading} error={error} isEmpty={isEmpty} />
      {ready && (
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <SortableHeader label="Time" sortKey="start_time" sort={sort} onSort={onSort} />
                <SortableHeader label="Campaign" sortKey="name" sort={sort} onSort={onSort} />
                <SortableHeader label="CRN" sortKey="crn" sort={sort} onSort={onSort} />
                {MEASURES.map((m) => (
                  <SortableHeader
                    key={m.key}
                    label={m.label}
                    sortKey={m.key}
                    sort={sort}
                    onSort={onSort}
                    align="right"
                  />
                ))}
                <SortableHeader
                  label="Connected %"
                  sortKey="connected_percentage"
                  sort={sort}
                  onSort={onSort}
                  align="right"
                />
                <SortableHeader
                  label="Duration"
                  sortKey="connected_duration"
                  sort={sort}
                  onSort={onSort}
                  align="right"
                />
                <th className={`${TH_CLASS} w-14`} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <CampaignRow key={`${row.account_id}-${row.client_id}-${row.crn}`} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TableCard>
  );
}

function CampaignRow({ row }: { row: CampaignTableRow }) {
  const incomplete = isIncomplete(row);

  return (
    <tr
      className={clsx(
        'border-b transition-colors',
        incomplete
          ? 'bg-red-50 hover:bg-red-100/70 border-red-100 dark:bg-red-500/[0.09] dark:hover:bg-red-500/[0.14] dark:border-red-500/20'
          : 'border-[#eef2f8] hover:bg-[#f4f8fd] dark:border-zinc-800/40 dark:hover:bg-white/[0.03]',
      )}
    >
      {/* The red stripe on the leading edge keeps an incomplete row findable
          even while scanning only the left of the table. */}
      <td
        className={clsx(
          CELL,
          'whitespace-nowrap',
          incomplete && 'shadow-[inset_3px_0_0_theme(colors.red.500)]',
        )}
      >
        <span className="block text-sm font-medium tabular-nums text-zinc-900 dark:text-white">
          {short(row.start_time)} – {short(row.end_time)}
        </span>
        <span className="block text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
          {span(row.start_time, row.end_time)}
        </span>
      </td>

      <td className={clsx(CELL, 'min-w-[220px] max-w-[340px]')}>
        <span className="flex items-center gap-2">
          <span
            className="truncate text-sm font-semibold text-zinc-900 dark:text-white"
            title={row.name ?? undefined}
          >
            {row.name ?? '—'}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
          AC {row.account_id} · Client {row.client_id}
          {row.booking_reference != null && ` · Ref ${row.booking_reference}`}
        </span>
      </td>

      <td className={clsx(CELL, 'whitespace-nowrap text-sm font-medium tabular-nums text-zinc-700 dark:text-zinc-300')}>
        {row.crn}
      </td>

      {MEASURES.map((m) => {
        const value = row[m.key] as number;
        const isUnblast = m.key === 'unblast_count';
        return (
          <td
            key={m.key}
            title={isUnblast && value > 0 ? `${value.toLocaleString()} numbers were never blasted` : undefined}
            className={clsx(
              NUM,
              isUnblast && value > 0
                ? 'font-bold text-red-600 dark:text-red-400'
                : value === 0
                  ? 'text-zinc-300 dark:text-zinc-600'
                  : m.key === 'connected'
                    ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                    : 'text-zinc-700 dark:text-zinc-300',
            )}
          >
            {value.toLocaleString()}
          </td>
        );
      })}

      <td className={CELL}>
        <ConnectedBar value={row.connected_percentage} />
      </td>
      <td className={clsx(NUM, 'text-zinc-700 dark:text-zinc-300')}>
        {row.connected_duration.toLocaleString()}
      </td>
      <td className={clsx(CELL, 'text-right')}>
        <RecordsDownload row={row} />
      </td>
    </tr>
  );
}

/** "09:15:59" → "09:15": seconds are noise at a glance. */
function short(time: string | null): string {
  return time ? time.slice(0, 5) : '—';
}

/** How long the campaign ran, from its start and end times — "7h 15m". */
function span(start: string | null, end: string | null): string {
  if (!start || !end) return '';
  const seconds = (t: string) => {
    const [h, m, s] = t.split(':').map(Number);
    return h * 3600 + m * 60 + (s || 0);
  };
  const minutes = Math.max(Math.round((seconds(end) - seconds(start)) / 60), 0);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

/**
 * Downloads one campaign's call records as CSV — the reporting team's
 * per-number query for this row's date, account and CRN, every row.
 */
function RecordsDownload({ row }: { row: CampaignTableRow }) {
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const [problem, setProblem] = useState<string | null>(null);

  const download = async () => {
    if (!row.date || state === 'loading') return;
    setState('loading');
    setProblem(null);
    try {
      const { columns, rows } = await campaignApi.campaignRecords(row.date, row.account_id, row.crn);
      if (rows.length === 0) throw new Error('No call records for this campaign in the CDR export.');
      downloadCsv(`campaign-${row.crn}-${row.account_id}-${row.date}.csv`, columns, rows);
      setState('idle');
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The download failed.');
      setState('failed');
    }
  };

  return (
    <button
      type="button"
      onClick={download}
      disabled={state === 'loading'}
      aria-label={`Download call records for CRN ${row.crn} as CSV`}
      title={
        state === 'loading'
          ? 'Preparing CSV…'
          : state === 'failed'
            ? `${problem} Click to retry.`
            : 'Download call records (CSV)'
      }
      className={clsx(
        ROW_ACTION_CLASS,
        'disabled:cursor-wait',
        state === 'failed'
          ? 'border-red-300 text-red-600 dark:border-red-500/50 dark:text-red-400'
          : ROW_ACTION_IDLE_CLASS,
      )}
    >
      {state === 'loading' ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : state === 'failed' ? (
        <AlertTriangle className="w-4 h-4" />
      ) : (
        <Download className="w-4 h-4" />
      )}
    </button>
  );
}
