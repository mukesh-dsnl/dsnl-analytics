import type { DailyColumn } from '../summary/components/DailyStatement';
import type { StatementColumn } from '../summary/statement';
import type { ConferenceDayTotals, ConferenceStatementLine } from './api';

const sum = (lines: ConferenceStatementLine[], key: keyof ConferenceStatementLine) =>
  lines.reduce((total, l) => total + (Number(l[key]) || 0), 0);
const rate = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

/** Conference: rooms, parties and minutes per account per month. */
export const CONFERENCE_COLUMNS: StatementColumn<ConferenceStatementLine>[] = [
  { key: 'conferences', label: 'Conferences' },
  { key: 'active_days', label: 'Active days' },
  { key: 'ringed', label: 'Ringed' },
  { key: 'connected', label: 'Connected' },
  { key: 'connect_rate', label: 'Connect %', percent: true, total: (l) => rate(sum(l, 'connected'), sum(l, 'ringed')) },
  { key: 'empty_rooms', label: 'Empty rooms' },
  { key: 'attended_minutes', label: 'Attended minutes' },
  { key: 'call_minutes', label: 'Call minutes' },
  { key: 'peak_port', label: 'Peak port', total: (l) => Math.max(0, ...l.map((x) => x.peak_port)) },
];

/** A day as the daily statement prints it: the day's totals and its connect rate. */
export type DayLine = ConferenceDayTotals & { connect_rate: number };
const daySum = (days: DayLine[], key: keyof DayLine) => days.reduce((t, d) => t + (Number(d[key]) || 0), 0);
export const withConnectRate = (d: ConferenceDayTotals): DayLine => ({ ...d, connect_rate: rate(d.connected, d.ringed) });

/** The daily statement's columns; an account's own statement leaves out Accounts. */
export const CONFERENCE_DAILY_COLUMNS: DailyColumn<DayLine>[] = [
  { key: 'conferences', label: 'Conferences' },
  { key: 'accounts', label: 'Accounts', total: () => NaN },
  { key: 'ringed', label: 'Ringed' },
  { key: 'connected', label: 'Connected' },
  { key: 'connect_rate', label: 'Connect %', percent: true, total: (d) => rate(daySum(d, 'connected'), daySum(d, 'ringed')) },
  { key: 'empty_rooms', label: 'Empty rooms' },
  { key: 'attended_minutes', label: 'Attended minutes' },
  { key: 'call_minutes', label: 'Call minutes' },
  { key: 'peak_port', label: 'Peak port', total: (d) => Math.max(0, ...d.map((x) => x.peak_port)) },
];
