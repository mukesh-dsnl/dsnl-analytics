/**
 * Voicedrop Summary API — GET /api/summary/*, read from voicedrop_summary.
 *
 * Every figure is the backend's (app/cdr/voicedrop_insights.py); this page
 * only lays them out. Definitions, as there:
 *   dialed = connected + not connected · connect rate = connected / dialed
 *   DND % = DND / phone numbers · minutes = Connected_Duration
 */

const API_BASE = '/api/summary';

/** The figures summed for any slice — a day, a month, an account. */
export interface Totals {
  campaigns: number;
  phone_numbers: number;
  dnd: number;
  /** The table's own Dialout_Count — what the daily volume bars show. */
  dialout: number;
  connected: number;
  not_connected: number;
  dialed: number;
  minutes: number;
  unblast: number;
}

export interface DayTotals extends Totals {
  date: string;
  /** All-accounts days only: how many accounts ran campaigns that day. */
  accounts?: number;
}

export interface MonthTotals extends Totals {
  month: string;
  active_days: number;
  connect_rate: number;
  dnd_rate: number;
}

export interface WeekdayHour {
  /** 0 = Monday … 6 = Sunday. */
  weekday: number;
  hour: number;
  campaigns: number;
  dialed: number;
}

export interface AccountSummary {
  account_id: number;
  /** From the account master list (accounts.parquet); null when it has none. */
  name: string | null;
  client_ids: number[];
  first_date: string;
  last_date: string;
  days_idle: number;
  campaigns: number;
  active_days: number;
  dialed: number;
  connected: number;
  minutes: number;
  /** Numbers dialed in the 90 days up to its last active day: what it used to send. */
  dialed_last_90_active: number;
}

export interface Mover {
  account_id: number;
  current_dialed: number;
  previous_dialed: number;
  current_minutes: number;
  previous_minutes: number;
  change: number;
  /** Null when there was nothing last month to compare with. */
  change_pct: number | null;
}

export interface PeriodTotals extends Totals {
  active_days: number;
  connect_rate: number;
}

export interface Overview {
  as_of: string | null;
  first_date: string | null;
  kpis: {
    active_accounts_30d: number;
    active_accounts_prev_30d: number;
    this_month: PeriodTotals;
    last_month_same_days: PeriodTotals;
  };
  daily: DayTotals[];
  weekday_hour: WeekdayHour[];
  accounts: AccountSummary[];
  movers: {
    current_from: string;
    current_to: string;
    previous_from: string;
    previous_to: string;
    accounts: Mover[];
  };
  new_accounts: { month: string; accounts: number[]; is_table_start: boolean }[];
  months: string[];
}

export interface Habits {
  /** "90d" normally; "all" when the account has been quiet for longer. */
  scope: '90d' | 'all';
  active_days_this_month: number;
  active_days_last_month: number;
  campaigns_per_active_day: number;
  avg_campaign_size: number;
  avg_dialed_per_campaign: number;
  usual_start: string | null;
  busiest_hour: number | null;
  last_active: string;
  days_since_active: number;
}

export interface AccountHistory {
  account_id: number;
  name: string | null;
  client_ids: number[];
  /** The account's clients, named from the client master list (clients.parquet). */
  clients: { id: number; name: string | null }[];
  /** Set when the history is one client's alone (?client=). */
  client: { id: number; name: string | null } | null;
  as_of: string;
  first_date: string;
  last_date: string;
  daily: DayTotals[];
  monthly: MonthTotals[];
  habits: Habits;
  weekday_hour: WeekdayHour[];
}

export interface StatementRow extends Totals {
  month: string;
  account_id: number;
  name: string | null;
  client_ids: number[];
  active_days: number;
  connect_rate: number;
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

export const summaryApi = {
  overview: () => get<Overview>('overview'),
  account: (accountId: number, clientId?: number | null) =>
    get<AccountHistory>(`account/${accountId}${clientId ? `?client=${clientId}` : ''}`),
  statement: (month: string | null) =>
    get<{ month: string | null; rows: StatementRow[] }>(
      `statement${month ? `?month=${encodeURIComponent(month)}` : ''}`,
    ),
};
