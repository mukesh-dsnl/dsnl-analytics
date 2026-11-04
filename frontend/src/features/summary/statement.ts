/** The monthly statement's columns and its CSV. */

import { downloadCsv } from '../campaign-metrics/exportCsv';

/** One statement line: a month for one account. */
export interface StatementLine {
  month: string;
  account_id: number;
  client_ids: number[];
  campaigns: number;
  active_days: number;
  phone_numbers: number;
  dnd: number;
  dialed: number;
  connected: number;
  connect_rate: number;
  minutes: number;
}

export const STATEMENT_COLUMNS: { key: keyof StatementLine; label: string }[] = [
  { key: 'campaigns', label: 'Campaigns' },
  { key: 'active_days', label: 'Active days' },
  { key: 'phone_numbers', label: 'Phone numbers' },
  { key: 'dnd', label: 'DND' },
  { key: 'dialed', label: 'Dialed' },
  { key: 'connected', label: 'Connected' },
  { key: 'connect_rate', label: 'Connect %' },
  { key: 'minutes', label: 'Connected minutes' },
];

export function downloadStatement(filename: string, lines: StatementLine[]) {
  downloadCsv(
    filename,
    ['Month', 'Account', 'Clients', ...STATEMENT_COLUMNS.map((c) => c.label)],
    lines.map((l) => [l.month, l.account_id, l.client_ids.join(' '), ...STATEMENT_COLUMNS.map((c) => l[c.key])]),
  );
}
