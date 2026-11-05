/**
 * Port Analyzer API — POST /api/ports/analyze (backend/app/cdr/ports.py).
 *
 * Ports in use are the +1 / -1 sweep over each call's start and release, as
 * the dashboards' peak-ports chart: the figures here are the backend's.
 */

export type PortService = 'all' | 'voicedrop' | 'conference' | 'multicall';
export type GroupBy = 'none' | 'service' | 'service_provider' | 'account' | 'location' | 'direction';

/** Resolutions, in seconds — the backend's RESOLUTIONS. */
export const RESOLUTIONS: { id: string; label: string; seconds: number }[] = [
  { id: '1s', label: '1 s', seconds: 1 },
  { id: '5s', label: '5 s', seconds: 5 },
  { id: '10s', label: '10 s', seconds: 10 },
  { id: '30s', label: '30 s', seconds: 30 },
  { id: '1m', label: '1 min', seconds: 60 },
  { id: '5m', label: '5 min', seconds: 300 },
  { id: '15m', label: '15 min', seconds: 900 },
  { id: '30m', label: '30 min', seconds: 1800 },
  { id: '1h', label: '1 h', seconds: 3600 },
];
export const MAX_POINTS = 7200;

export interface PortRequest {
  date: string;
  service: PortService;
  time_from: string;
  time_to: string;
  resolution: string;
  group_by: GroupBy;
  service_providers: string[];
  accounts: string[];
  locations: string[];
  top: number;
  capacity: number | null;
}

export interface PortGroup {
  key: string;
  label: string;
  peak: number;
  peak_at: string | null;
  calls: number;
  connected: number;
  /** Average ports in use over the window (Erlangs). */
  avg_ports: number;
  is_other: boolean;
  /** How many groups "Other" folds together. */
  members: number | null;
}

export interface FilterOption {
  key: string;
  label: string;
  calls: number;
}

export interface PortResult {
  date: string;
  service: PortService;
  window: { from: string; to: string; seconds: number };
  resolution: string;
  step_seconds: number;
  group_by: GroupBy;
  rows_in_day: number;
  summary: {
    peak: number;
    peak_at: string | null;
    avg_ports: number;
    calls: number;
    connected: number;
    longest_call_seconds: number;
    capacity: number | null;
    above_capacity_seconds: number | null;
    busiest_hour: { hour: number; peak: number } | null;
  };
  /** "HH:MM:SS", one per bucket. */
  labels: string[];
  /** Peak ports in each bucket, every call. */
  total: number[];
  groups: PortGroup[];
  group_series: Record<string, number[]>;
  at_peak: Partial<Record<'service' | 'service_provider' | 'account' | 'direction', { key: string; label: string; ports: number }[]>>;
  options: { service_providers: FilterOption[]; accounts: FilterOption[]; locations: FilterOption[] };
}

export async function analyzePorts(body: PortRequest): Promise<PortResult> {
  const res = await fetch('/api/ports/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = 'The port analysis failed.';
    try {
      const data = await res.json();
      if (typeof data?.detail === 'string') detail = data.detail;
    } catch {
      // Not JSON: keep the generic message.
    }
    throw new Error(detail);
  }
  return res.json();
}
