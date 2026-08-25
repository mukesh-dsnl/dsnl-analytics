/**
 * Campaign Metrics API layer.
 *
 * A separate module from ../cdr-dashboard/api.ts on purpose — this feature
 * talks to its own backend routes (POST /api/campaign/*) added specifically
 * so nothing about the existing CDR dashboard queries had to change.
 */

const API_BASE = '/api/campaign';

export type CampaignService = 'voicedrop' | 'conference' | 'multicall';

/** The one filter body every Campaign Metrics endpoint takes: a single day and a service. */
export interface CampaignFilter {
  date: string;
  service: CampaignService;
}

/** The four figures every breakdown reports, whatever it's grouped by. */
export interface CampaignMetricsRow {
  total_size: number;
  connected_size: number;
  not_connected_size: number;
  connected_percentage: number;
}

export interface AccountMetricsRow extends CampaignMetricsRow {
  account: string;
  total_minutes: number;
}

export interface AccountCrnMetricsRow extends CampaignMetricsRow {
  crn: string;
  total_minutes: number;
}

export interface ServiceProviderMetricsRow extends CampaignMetricsRow {
  service_provider: string;
}

export interface LocationMetricsRow extends CampaignMetricsRow {
  location: string;
}

// ── Account insight (the per-row chart popup) ─────────────────────────────

export interface InsightSummary {
  total_uploaded: number;
  dial_attempts: number;
  connected_users: number;
  connect_percentage: number;
}

/** Failed attempts, split by whether the number ever rang (ALERT). */
export interface InsightFailure {
  total: number;
  never_rang: number;
  rang_unanswered: number;
  never_rang_percentage: number;
  rang_unanswered_percentage: number;
}

export interface InsightDisconnectReason {
  reason: string;
  count: number;
  percentage: number;
}

export interface InsightCarrier {
  carrier: string;
  total: number;
  connected: number;
  connect_percentage: number;
}

/** One AID group's four bars, plus the dial-out total its dotted line marks. */
export interface InsightAid {
  label: string;
  proceeded: number;
  alert: number;
  connected: number;
  ended: number;
  total_initiated: number;
}

export interface InsightBlast {
  label: string;
  aids: InsightAid[];
}

export interface AccountInsight {
  account: string;
  crn: string | null;
  summary: InsightSummary;
  failed: InsightFailure;
  disconnect_reasons: InsightDisconnectReason[];
  carriers: InsightCarrier[];
  blasts: InsightBlast[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  if (!isRecord(body)) return fallback;
  const { detail } = body;
  if (typeof detail === 'string') return detail;
  return fallback;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res, `Failed to load ${path}`));
  return res.json();
}

export const campaignApi = {
  accountWise: (filters: CampaignFilter): Promise<{ rows: AccountMetricsRow[] }> =>
    post('account-wise', filters),

  /** CRN breakdown within one account — fetched lazily as each row is expanded. */
  accountCrn: (
    filters: CampaignFilter,
    accountId: string,
  ): Promise<{ account: string; rows: AccountCrnMetricsRow[] }> =>
    post('account-wise/crn', { ...filters, account_id: accountId }),

  serviceProviderWise: (filters: CampaignFilter): Promise<{ rows: ServiceProviderMetricsRow[] }> =>
    post('service-provider-wise', filters),

  locationWise: (filters: CampaignFilter): Promise<{ rows: LocationMetricsRow[] }> =>
    post('location-wise', filters),

  /**
   * Everything the chart popup draws for one row.
   *
   * Its own request, fired only when a row's chart icon is actually clicked —
   * these aggregates are heavier than the table's, and most rows are never
   * charted, so the table must not pay for them upfront.
   */
  accountInsight: (
    filters: CampaignFilter,
    accountId: string,
    crn?: string | null,
  ): Promise<AccountInsight> =>
    post('account-insight', { ...filters, account_id: accountId, crn: crn ?? null }),
};
