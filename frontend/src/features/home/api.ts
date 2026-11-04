/**
 * Home API — GET /api/home/overview (Voicedrop, Conference) and
 * GET /api/home/multicall, one card per service in the same shape
 * (backend/app/api/home.py says where each comes from).
 */

export type ServiceId = 'voicedrop' | 'conference' | 'multicall';

export interface CardFigures {
  /** Campaigns · conferences · conferences (distinct CRNs). */
  units: number;
  /** Dialed out · parties ringed · dial attempts. */
  total: number;
  connected: number;
  minutes: number;
  accounts: number;
  connect_rate: number;
  days: number;
}

export interface ServiceCard {
  as_of: string | null;
  error?: string;
  day?: CardFigures;
  /** The month so far, or MultiCall's last few days. */
  period?: CardFigures & { label: string };
  series?: { date: string; total: number; connected: number }[];
  has_minutes?: boolean;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api/home/${path}`);
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

export const homeApi = {
  overview: () => get<{ voicedrop: ServiceCard; conference: ServiceCard }>('overview'),
  multicall: () => get<ServiceCard>('multicall'),
};
