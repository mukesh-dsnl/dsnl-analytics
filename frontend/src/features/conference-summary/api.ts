/**
 * Conference › Summary API — GET /api/conference-summary/*, read from
 * q100_dump.conference_summary and conference_daily_summary on .117.
 * Every figure is the tables' own (app/cdr/conference_summary.py).
 */

const API_BASE = '/api/conference-summary';

export interface ConferenceStatus {
  first_date: string | null;
  last_date: string | null;
  conferences: number;
  /** conference_daily_summary's row count — zero while that table is unfilled. */
  daily_table_days: number;
  daily_table_last: string | null;
}

/** One conference (CRN + Conf Num) on one day. */
export interface ConferenceRecord {
  date: string;
  account_id: number;
  account_name: string | null;
  crn: number;
  conf_num: string;
  conference_name: string | null;
  pin: number | null;
  dids: string[];
  start_time: string | null;
  end_time: string | null;
  length_minutes: number | null;
  /** Distinct conferees dialled into the room. */
  ringed: number;
  /** Of those, how many joined. */
  connected: number;
  call_minutes: number;
  attended_minutes: number;
  peak_port: number;
}

export interface ConferenceDay {
  date: string;
  conferences: number;
  accounts: number;
  ringed: number;
  connected: number;
  call_minutes: number;
  attended_minutes: number;
  peak_port: number;
  party_0: number;
  party_1: number;
  party_2: number;
  party_3: number;
  party_above_3: number;
  /** conference_daily_summary only: CODR records, all and by module type. */
  total_count: number | null;
  acs_count: number | null;
  proxy_count: number | null;
  multicall_count: number | null;
  /** Which table the party counts came from. */
  source: 'conference_summary' | 'conference_daily_summary';
}

/** The figures summed for any slice — a day, a month, an account. */
export interface ConferenceTotals {
  conferences: number;
  ringed: number;
  connected: number;
  call_minutes: number;
  attended_minutes: number;
  /** Rooms nobody joined. */
  empty_rooms: number;
  /** The highest port number used (a maximum, not a sum). */
  peak_port: number;
}

export interface ConferenceDayTotals extends ConferenceTotals {
  date: string;
  /** All-accounts days only. */
  accounts?: number;
}

export interface ConferencePeriod extends ConferenceTotals {
  active_days: number;
  connect_rate: number;
  empty_rate: number;
  parties_per_conference: number;
}

export interface ConferenceMonth extends ConferencePeriod {
  month: string;
}

export interface ConferenceWeekdayHour {
  weekday: number;
  hour: number;
  conferences: number;
  connected: number;
}

export interface ConferenceAccountSummary {
  account_id: number;
  name: string | null;
  first_date: string;
  last_date: string;
  days_idle: number;
  conferences: number;
  active_days: number;
  connected: number;
  attended_minutes: number;
  attended_last_90_active: number;
}

export interface ConferenceOverview {
  as_of: string | null;
  first_date: string | null;
  kpis: {
    active_accounts_30d: number;
    active_accounts_prev_30d: number;
    this_month: ConferencePeriod;
    last_month_same_days: ConferencePeriod;
  };
  daily: ConferenceDayTotals[];
  weekday_hour: ConferenceWeekdayHour[];
  accounts: ConferenceAccountSummary[];
  movers: {
    current_from: string;
    current_to: string;
    previous_from: string;
    previous_to: string;
    accounts: {
      account_id: number;
      current: number;
      previous: number;
      current_conferences: number;
      previous_conferences: number;
      change: number;
    }[];
  };
  new_accounts: { month: string; accounts: number[]; is_table_start: boolean }[];
  months: string[];
}

export interface ConferenceHabits {
  scope: '90d' | 'all';
  active_days_this_month: number;
  active_days_last_month: number;
  conferences_per_active_day: number;
  parties_per_conference: number;
  median_length_minutes: number | null;
  usual_start: string | null;
  busiest_hour: number | null;
  last_active: string;
  days_since_active: number;
}

export interface ConferenceAccountHistory {
  account_id: number;
  name: string | null;
  as_of: string;
  first_date: string;
  last_date: string;
  daily: ConferenceDayTotals[];
  monthly: ConferenceMonth[];
  habits: ConferenceHabits;
  weekday_hour: ConferenceWeekdayHour[];
}

export interface ConferenceStatementLine extends ConferenceMonth {
  account_id: number;
  name: string | null;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}/${path}`);
  if (!res.ok) {
    let detail = `Failed to load ${path}`;
    try {
      const body = await res.json();
      if (typeof body?.detail === 'string') detail = body.detail;
    } catch {
      // Not JSON: keep the generic message.
    }
    throw new Error(detail);
  }
  return res.json();
}

/** One room in full, from that day's CODR booking and CDR legs (the Campaigns details panel). */
export interface ConferenceRoom {
  date: string;
  account_id: number;
  account_name: string | null;
  client_id: number | null;
  client_name: string | null;
  conference_name: string | null;
  start_time: string | null;
  end_time: string | null;
  room_duration_mins: number | null;
  crn: number;
  conf_num: string;
  chair_pin: number | null;
  /** The chairperson named on the booking. */
  chair_name: string | null;
  dids: number[];
  /** Every chairperson who called in, one line per name and number. */
  chairpersons: { name: string | null; phone: string | null; legs: number; joined: boolean; first_call: string | null }[];
  /** Set when the day's CDR export couldn't be read: the booking shows without DIDs or chairpersons. */
  cdr_note: string | null;
}

/** The key a room is known by: a CRN is reused across rooms, the Conf Num tells them apart. */
export const roomKey = (row: { crn: number; conf_num: string }) => `${row.crn}-${row.conf_num}`;

export const conferenceSummaryApi = {
  room: (r: { date: string; account: number; crn: number; conf_num: string }) =>
    get<ConferenceRoom>(
      `room?date=${r.date}&account=${r.account}&crn=${r.crn}&conf_num=${encodeURIComponent(r.conf_num)}`,
    ),
  status: () => get<ConferenceStatus>('status'),
  records: (date: string) => get<{ date: string; rows: ConferenceRecord[] }>(`records?date=${date}`),
  daily: (end: string, days: number) =>
    get<{ end: string; days: number; rows: ConferenceDay[] }>(`daily?end=${end}&days=${days}`),
  overview: () => get<ConferenceOverview>('overview'),
  account: (accountId: number) => get<ConferenceAccountHistory>(`account/${accountId}`),
  statement: (month: string | null) =>
    get<{ month: string | null; rows: ConferenceStatementLine[] }>(
      `statement${month ? `?month=${encodeURIComponent(month)}` : ''}`,
    ),
};
