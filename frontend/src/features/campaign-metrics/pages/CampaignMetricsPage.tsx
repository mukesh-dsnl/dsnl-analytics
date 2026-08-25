import { useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Users, Radio, MapPin } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';

import { campaignApi } from '../api';
import type { CampaignFilter, CampaignService } from '../api';
import { useCdrStatus, useCampaignDate } from '../hooks';
import type { CdrStatus } from '../../cdr-dashboard/api';
import { AccountWiseTable } from '../components/AccountWiseTable';
import { SimpleMetricsTable } from '../components/SimpleMetricsTable';

interface CampaignMetricsPageProps {
  service: CampaignService;
}

type View = 'account' | 'provider' | 'location';

const VIEWS: { id: View; label: string; icon: LucideIcon }[] = [
  { id: 'account', label: 'Account wise', icon: Users },
  { id: 'provider', label: 'Service Provider wise', icon: Radio },
  { id: 'location', label: 'Location wise', icon: MapPin },
];

function Banner({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 text-sm text-red-700 dark:text-red-400">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * One Campaign Metrics service (Voicedrop / Conference / Multicall).
 *
 * Unlike the CDR analytics dashboard, this reads a single day rather than a
 * range — the date lives in its own header control (HeaderCampaignDate) and
 * store, so navigating between Campaign Metrics' three services keeps the
 * selected day the same way the analytics date range survives navigation
 * between its service pages.
 */
export function CampaignMetricsPage({ service }: CampaignMetricsPageProps) {
  const { data: status, isPending, error, refetch } = useCdrStatus();

  if (isPending) {
    return (
      <div className="flex items-center justify-center p-24">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <Banner>
          <p className="font-medium">Couldn't reach the CDR service.</p>
          <p className="mt-0.5 break-words">{error.message}</p>
          <button onClick={() => refetch()} className="mt-2 text-xs font-semibold underline">
            Retry
          </button>
        </Banner>
      </div>
    );
  }

  return <Metrics service={service} status={status} />;
}

function Metrics({ service, status }: { service: CampaignService; status: CdrStatus }) {
  const { date } = useCampaignDate(status);
  const [view, setView] = useState<View>('account');

  const filters: CampaignFilter = { date, service };
  const queryKey = ['campaign', view, filters.date, filters.service] as const;

  const accountQuery = useQuery({
    queryKey,
    queryFn: () => campaignApi.accountWise(filters),
    enabled: status.available && view === 'account',
  });
  const providerQuery = useQuery({
    queryKey,
    queryFn: () => campaignApi.serviceProviderWise(filters),
    enabled: status.available && view === 'provider',
  });
  const locationQuery = useQuery({
    queryKey,
    queryFn: () => campaignApi.locationWise(filters),
    enabled: status.available && view === 'location',
  });

  return (
    <div className="p-8 max-w-[1500px] mx-auto min-h-full">
      <div className="space-y-6">
        {!status.available && (
          <Banner>
            <p className="font-medium">No CDR exports are readable.</p>
            <p className="mt-0.5 break-words">
              {status.cdr.error ?? 'Nothing found in the configured directory.'} Check
              CDR_LAKE_PATH and CODR_LAKE_PATH in the backend .env.
            </p>
          </Banner>
        )}

        {status.available && !status.codr.available && (service === 'conference' || service === 'multicall') && (
          <Banner>
            <p className="font-medium">
              CODR is unreadable — {service === 'conference' ? 'Conference' : 'Multicall'} is unavailable.
            </p>
            <p className="mt-0.5 break-words">
              {service === 'conference' ? 'Conference' : 'Multicall'} is indistinguishable without CODR's
              MODULE_TYPE.
            </p>
          </Banner>
        )}

        <div className="flex flex-wrap gap-2">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setView(v.id)}
              aria-pressed={view === v.id}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors',
                view === v.id
                  ? 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-600/10 dark:text-blue-500 dark:border-blue-500/20'
                  : 'text-zinc-500 border-zinc-200 dark:text-zinc-400 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
              )}
            >
              <v.icon className="w-3.5 h-3.5" />
              {v.label}
            </button>
          ))}
        </div>

        {!status.available ? (
          <div className="px-5 py-12 text-center rounded-md border border-dashed border-zinc-300 dark:border-zinc-700 text-sm text-zinc-500 dark:text-zinc-400">
            Campaign Metrics needs a readable CDR export directory.
          </div>
        ) : view === 'account' ? (
          <AccountWiseTable
            filters={filters}
            rows={accountQuery.data?.rows}
            isLoading={accountQuery.isPending}
            error={accountQuery.error}
          />
        ) : view === 'provider' ? (
          <SimpleMetricsTable
            columnLabel="Service Provider"
            rows={providerQuery.data?.rows.map((r) => ({ ...r, label: r.service_provider }))}
            isLoading={providerQuery.isPending}
            error={providerQuery.error}
          />
        ) : (
          <SimpleMetricsTable
            columnLabel="Location"
            rows={locationQuery.data?.rows.map((r) => ({ ...r, label: r.location }))}
            isLoading={locationQuery.isPending}
            error={locationQuery.error}
          />
        )}
      </div>
    </div>
  );
}
