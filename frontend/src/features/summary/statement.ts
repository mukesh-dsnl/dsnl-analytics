/** The monthly statement: its line shape, columns, totals and CSV. */

import { downloadCsv } from '../campaign-metrics/exportCsv';

/** What every statement line has: whose month it is. */
export interface StatementBase {
  month: string;
  account_id: number;
  /** Voicedrop: the account's client ids. */
  client_ids?: number[];
  /** Conference: the account's name. */
  name?: string | null;
}

export interface StatementColumn<T> {
  key: keyof T & string;
  label: string;
  /** Printed with a % sign. */
  percent?: boolean;
  /** The Total row's figure; summed when not given. */
  total?: (lines: T[]) => number;
}

const sum = <T,>(lines: T[], key: keyof T) => lines.reduce((total, l) => total + (Number(l[key]) || 0), 0);
const rate = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

export function columnTotal<T>(lines: T[], column: StatementColumn<T>): number {
  return column.total ? column.total(lines) : sum(lines, column.key);
}

/** Voicedrop: campaigns, dialed, connected and minutes per account per month. */
export interface VoicedropStatementLine extends StatementBase {
  campaigns: number;
  active_days: number;
  phone_numbers: number;
  dnd: number;
  dialed: number;
  connected: number;
  connect_rate: number;
  minutes: number;
}

export const VOICEDROP_COLUMNS: StatementColumn<VoicedropStatementLine>[] = [
  { key: 'campaigns', label: 'Campaigns' },
  { key: 'active_days', label: 'Active days' },
  { key: 'phone_numbers', label: 'Phone numbers' },
  { key: 'dnd', label: 'DND' },
  { key: 'dialed', label: 'Dialed' },
  { key: 'connected', label: 'Connected' },
  { key: 'connect_rate', label: 'Connect %', percent: true, total: (l) => rate(sum(l, 'connected'), sum(l, 'dialed')) },
  { key: 'minutes', label: 'Connected minutes' },
];

export function downloadStatement<T extends StatementBase>(filename: string, lines: T[], columns: StatementColumn<T>[]) {
  const byName = lines.some((l) => l.name != null);
  downloadCsv(
    filename,
    ['Month', 'Account', byName ? 'Account Name' : 'Clients', ...columns.map((c) => c.label)],
    lines.map((l) => [
      l.month,
      l.account_id,
      byName ? (l.name ?? '') : (l.client_ids ?? []).join(' '),
      ...columns.map((c) => l[c.key]),
    ]),
  );
}
