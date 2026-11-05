import { MAX_POINTS, RESOLUTIONS } from './api';
import type { GroupBy, PortRequest, PortService } from './api';

/**
 * The page's state is its URL — every filter is a query parameter, so an
 * analysis can be bookmarked, shared and stepped back through:
 *
 *   ?date=2026-11-03&service=conference&from=14:00:00&to=14:59:59&res=5s
 *    &by=service_provider&providers=15,22&accounts=1152&locations=2&cap=4000&top=8
 */

export const toSeconds = (hms: string) => {
  const [h, m, s] = hms.split(':').map(Number);
  return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
};

export const fromSeconds = (total: number) => {
  const t = Math.max(0, Math.min(86399, Math.round(total)));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
};

/** How many points a resolution gives over a window. */
export const pointsFor = (fromS: number, toS: number, step: number) => Math.ceil((toS - fromS + 1) / step);

/** The finest resolution that keeps the window within the point limit, but not finer than `atLeast`. */
export function fitResolution(fromS: number, toS: number, wanted?: string): string {
  const start = RESOLUTIONS.findIndex((r) => r.id === wanted);
  const candidates = start >= 0 ? RESOLUTIONS.slice(start) : RESOLUTIONS;
  return (candidates.find((r) => pointsFor(fromS, toS, r.seconds) <= MAX_POINTS) ?? RESOLUTIONS[RESOLUTIONS.length - 1]).id;
}

/** A sensible default for a window: about 1,500 points or fewer. */
export function autoResolution(fromS: number, toS: number): string {
  return (RESOLUTIONS.find((r) => pointsFor(fromS, toS, r.seconds) <= 1500) ?? RESOLUTIONS[RESOLUTIONS.length - 1]).id;
}

/** The window a page opens on when the URL names none: 9 AM to 9 PM, the working day. */
export const DEFAULT_FROM = '09:00:00';
export const DEFAULT_TO = '21:00:00';

/** Yesterday — the latest whole day — held within the days the lake has. */
export function defaultDay(minDate: string | null, maxDate: string): string {
  const now = new Date();
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const iso = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  if (iso > maxDate) return maxDate;
  if (minDate && iso < minDate) return minDate;
  return iso;
}

const list = (value: string | null) => (value ? value.split(',').map((v) => v.trim()).filter(Boolean) : []);
const SERVICES: PortService[] = ['all', 'voicedrop', 'conference', 'multicall'];
const GROUPS: GroupBy[] = ['none', 'service', 'service_provider', 'account', 'location', 'direction'];

export function requestFromParams(params: URLSearchParams, defaultDate: string): PortRequest {
  const from = /^\d{2}:\d{2}:\d{2}$/.test(params.get('from') ?? '') ? params.get('from')! : DEFAULT_FROM;
  const to = /^\d{2}:\d{2}:\d{2}$/.test(params.get('to') ?? '') ? params.get('to')! : DEFAULT_TO;
  const fromS = toSeconds(from);
  const toS = Math.max(toSeconds(to), fromS);
  const service = params.get('service') as PortService;
  const by = params.get('by') as GroupBy;
  const res = params.get('res');
  const cap = Number(params.get('cap'));
  return {
    date: params.get('date') ?? defaultDate,
    service: SERVICES.includes(service) ? service : 'all',
    time_from: from,
    time_to: fromSeconds(toS),
    resolution: res && RESOLUTIONS.some((r) => r.id === res) ? fitResolution(fromS, toS, res) : autoResolution(fromS, toS),
    group_by: GROUPS.includes(by) ? by : 'service',
    service_providers: list(params.get('providers')),
    accounts: list(params.get('accounts')),
    locations: list(params.get('locations')),
    top: Math.min(12, Math.max(1, Number(params.get('top')) || 8)),
    capacity: params.get('cap') && Number.isFinite(cap) && cap > 0 ? cap : null,
  };
}

export function paramsFromRequest(r: PortRequest): URLSearchParams {
  const p = new URLSearchParams();
  p.set('date', r.date);
  if (r.service !== 'all') p.set('service', r.service);
  if (r.time_from !== DEFAULT_FROM) p.set('from', r.time_from);
  if (r.time_to !== DEFAULT_TO) p.set('to', r.time_to);
  p.set('res', r.resolution);
  p.set('by', r.group_by);
  if (r.service_providers.length) p.set('providers', r.service_providers.join(','));
  if (r.accounts.length) p.set('accounts', r.accounts.join(','));
  if (r.locations.length) p.set('locations', r.locations.join(','));
  if (r.top !== 8) p.set('top', String(r.top));
  if (r.capacity) p.set('cap', String(r.capacity));
  return p;
}

/** "2026-11-03 14:05:05.998" → "14:05:05". */
export const clock = (stamp: string | null) => (stamp ? stamp.slice(11, 19) : '—');

/** One colour per group, in the order the breakdown names them; "Other" is grey. */
export const GROUP_COLORS = ['#2563eb', '#7c5cd6', '#1f9a77', '#e07d2c', '#d14d72', '#0ea5e9', '#a16207', '#4f46e5', '#059669', '#db2777', '#64748b', '#0891b2'];
export const OTHER_COLOR = '#9aa7b8';
