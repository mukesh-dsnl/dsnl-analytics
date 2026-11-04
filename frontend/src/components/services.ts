import { Activity, ClipboardList, ContactRound, Megaphone, PhoneForwarded, PhoneOutgoing, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** The three services, and the pages each one has — the sidebar switcher and Home share these. */

export type ServiceId = 'voicedrop' | 'conference' | 'multicall';

export interface ServicePage {
  /** The page's own key, the same across services ("summary", "attempt-metrics" …). */
  key: 'summary' | 'attempt-metrics' | 'campaign-metrics' | 'registry';
  label: string;
  path: string;
  icon: LucideIcon;
}

export interface ServiceMeta {
  name: string;
  blurb: string;
  icon: LucideIcon;
  /** The icon tile's colours, on a light card. */
  tile: string;
  pages: ServicePage[];
}

const page = (service: ServiceId, key: ServicePage['key']): ServicePage => {
  switch (key) {
    case 'summary':
      return { key, label: 'Summary', path: `/analytics/${service}/summary`, icon: ClipboardList };
    case 'attempt-metrics':
      return { key, label: 'Attempt Metrics', path: `/analytics/${service}/attempt-metrics`, icon: Activity };
    case 'campaign-metrics':
      return { key, label: 'Campaign Metrics', path: `/analytics/${service}/campaign-metrics`, icon: Megaphone };
    case 'registry':
      return { key, label: 'Registration Lookup', path: `/analytics/${service}/registry`, icon: ContactRound };
  }
};

export const SERVICES: Record<ServiceId, ServiceMeta> = {
  voicedrop: {
    name: 'Voicedrop',
    blurb: 'Recorded-message campaigns',
    icon: PhoneOutgoing,
    tile: 'bg-[#e8f0fe] text-[#2563eb] dark:bg-blue-500/15 dark:text-blue-300',
    pages: [page('voicedrop', 'summary'), page('voicedrop', 'attempt-metrics'), page('voicedrop', 'campaign-metrics')],
  },
  conference: {
    name: 'Conference',
    blurb: 'Audio conference rooms',
    icon: Users,
    tile: 'bg-[#f1eafd] text-[#7c5cd6] dark:bg-violet-500/15 dark:text-violet-300',
    pages: [page('conference', 'summary'), page('conference', 'attempt-metrics'), page('conference', 'campaign-metrics')],
  },
  // MultiCall has no summary table, so no Summary page; it has its registration lookup.
  multicall: {
    name: 'MultiCall',
    blurb: 'Multi-party dial-out calls',
    icon: PhoneForwarded,
    tile: 'bg-[#e2f6ef] text-[#1f9a77] dark:bg-emerald-500/15 dark:text-emerald-300',
    pages: [page('multicall', 'attempt-metrics'), page('multicall', 'campaign-metrics'), page('multicall', 'registry')],
  },
};

export const SERVICE_ORDER: ServiceId[] = ['voicedrop', 'conference', 'multicall'];

/** The service a path belongs to, if it is one of a service's pages. */
export function serviceOfPath(pathname: string): ServiceId | null {
  const match = pathname.match(/^\/analytics\/(voicedrop|conference|multicall)(\/|$)/);
  return match ? (match[1] as ServiceId) : null;
}
