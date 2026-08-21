/**
 * CDR analytics API layer.
 *
 * Every number on the dashboard comes from the backend — this module only
 * fetches. There is no aggregation, filtering or derivation here.
 *
 * The whole dashboard is one request. The backend reads the daily parquet
 * files named by the date range, and reading them once for all eight panels is
 * the difference between a fast page and a slow one, so there is deliberately
 * no per-panel fetch to fall back on.
 */

const API_BASE = '/api/cdr';

// ── Status ─────────────────────────────────────────────────────────────────

/** What one side of the lake (CDR or CODR) holds. */
export interface CdrLakeSide {
  available: boolean;
  day_count: number;
  date_min?: string;
  date_max?: string;
  missing_days?: number;
  error?: string;
}

export interface CdrStatus {
  available: boolean;
  cdr: CdrLakeSide;
  codr: CdrLakeSide;
  cdr_path: string;
  codr_path: string;
  max_range_days: number;
  /** The day the dashboard should open on — yesterday, or the newest day held. */
  default_date?: string;
}

// ── Filters ────────────────────────────────────────────────────────────────

export type CdrService = 'all' | 'voicedrop' | 'conference' | 'multicall';

/**
 * The request body every query endpoint takes.
 *
 * `date_from` / `date_to` are required, not optional: they choose which daily
 * files the backend opens, so there is no "no date filter" to send.
 */
export interface CdrFilters {
  date_from: string;
  date_to: string;
  service: CdrService;
  account_id: string | null;
  crn: string | null;
  conf_num: string | null;
  /** Chairperson PIN — CODR.CHAIR_PIN. Only offered on Conference/Multicall. */
  cpin: string | null;
  time_from: string | null;
  time_to: string | null;
}

/** A filter set for one day, with nothing else narrowed. */
export const filtersForDay = (day: string, service: CdrService = 'all'): CdrFilters => ({
  date_from: day,
  date_to: day,
  service,
  account_id: null,
  crn: null,
  conf_num: null,
  cpin: null,
  time_from: null,
  time_to: null,
});

// ── Result shapes ──────────────────────────────────────────────────────────

export interface CdrSummary {
  total_calls: number;
  total_participants: number;
  minutes_usage: number;
  /** Distinct CRN + CONF_NUM pairs — meaningful for Conference and Multicall only. */
  total_conferences: number;
}

/** One bar / one row of a categorical breakdown. */
export interface CategoryDatum {
  label: string;
  value: number;
}

export interface PeakPortDatum {
  bucket: string;
  peak: number;
}

export interface CdrReblast {
  /** Reblasted conferees — Blast 0, the initial dial, is excluded from this figure. */
  total: number;
  stages: CategoryDatum[];
}

/** One AID_COUNT value within a blast, split Connected / Not Connected. */
export interface ReblastAidConnectionDatum {
  label: string;
  connected: number;
  not_connected: number;
}

/** One blast, and how its calls split across AID_COUNT — the Reblast chart's hover. */
export interface ReblastAidDatum {
  label: string;
  aid: ReblastAidConnectionDatum[];
}

/** Which days the answer was built from, and at what time resolution. */
export interface CdrCoverage {
  days_requested: number;
  days_matched: number;
  first_day?: string;
  last_day?: string;
  /** Peak-ports bucket width — the backend widens it as the range grows. */
  bucket?: string;
}

/** One category's count, split by dial direction — the hover breakdown for Call Ratio and Call Duration. */
export interface DirectionSplitDatum {
  label: string;
  dial_in: number;
  dial_out: number;
}

/** Every panel, from the one request that fills the page. */
export interface CdrDashboard {
  summary: CdrSummary;
  dtmf: number;
  call_direction: CategoryDatum[];
  connection_status: CategoryDatum[];
  peak_ports: PeakPortDatum[];
  service_provider: CategoryDatum[];
  reblast: CdrReblast;
  reblast_aid: ReblastAidDatum[];
  disconnect_reason: CategoryDatum[];
  location: CategoryDatum[];
  /** Call lifecycle for dial-out rows: initiated, ringed, connected, ended — Voicedrop only. */
  call_funnel: CategoryDatum[];
  /** Same four stages, split Dial In / Dial Out — Initiated/Ringed read as nearly all Dial Out by design. */
  call_funnel_direction: DirectionSplitDatum[];
  /** Connected-call duration in minutes, bucketed — Voicedrop only. */
  call_duration: CategoryDatum[];
  call_duration_direction: DirectionSplitDatum[];
  coverage: CdrCoverage;
}

// ── Call cube (Blast Details hover breakdowns) ───────────────────────────

/** One combination of the four dimensions, and its count. */
export interface CallCubeRow {
  location: string;
  is_connected: boolean;
  call_direction: string;
  service_provider: string;
  count: number;
}

export interface CallCubeResponse {
  rows: CallCubeRow[];
  total_calls: number;
  coverage: CdrCoverage;
}

// ── Transport ──────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Pull a readable message out of an error response.
 *
 * A 422 from FastAPI carries `detail` as a list of field errors rather than a
 * string, and those are the ones worth reading — an out-of-range date lands
 * here, and "date range spans 229 days" is the whole answer.
 */
async function readError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  if (!isRecord(body)) return fallback;

  const { detail } = body;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => (isRecord(item) && typeof item.msg === 'string' ? item.msg : null))
      .filter((msg): msg is string => msg !== null);
    if (messages.length > 0) return messages.join(' ');
  }
  if (typeof body.error === 'string') return body.error;
  return fallback;
}

async function post<T>(path: string, filters: CdrFilters): Promise<T> {
  const res = await fetch(`${API_BASE}/query/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filters),
  });
  if (!res.ok) throw new Error(await readError(res, `Failed to load ${path}`));
  return res.json();
}

// ── Public API ─────────────────────────────────────────────────────────────

export const cdrApi = {
  getStatus: async (): Promise<CdrStatus> => {
    const res = await fetch(`${API_BASE}/status`);
    if (!res.ok) throw new Error(await readError(res, 'Failed to reach the CDR service'));
    return res.json();
  },

  /** Every panel in one round trip — see the note at the top of this file. */
  dashboard: (filters: CdrFilters): Promise<CdrDashboard> =>
    post<CdrDashboard>('dashboard', filters),

  /**
   * The joint location × connected × direction × provider distribution, in
   * one payload. Blast Details derives its four bar charts and every hover
   * breakdown from this single request instead of five separate ones.
   */
  callCube: (filters: CdrFilters): Promise<CallCubeResponse> =>
    post<CallCubeResponse>('call-cube', filters),
};
