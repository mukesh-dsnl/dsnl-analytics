import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  Hash,
  MapPin,
  PhoneCall,
  PhoneOutgoing,
  PlugZap,
  Radio,
  Repeat2,
  Timer,
  Unplug,
  Users,
  Waypoints,
} from 'lucide-react';
import { cdrApi } from '../api';
import type { CategoryDatum, CdrFilters } from '../api';
import { formatCount, formatMinutes, useChartTheme } from '../chartTheme';
import { CategoryBarChart } from './CategoryBarChart';
import { ChartCard } from './ChartCard';
import { KpiCard } from './KpiCard';
import { PeakPortsChart } from './PeakPortsChart';

interface CDRDashboardProps {
  filters: CdrFilters;
}

/** Row height for horizontal bar charts, so long category lists stay readable. */
const barsHeight = (count: number) => Math.max(200, Math.min(count, 12) * 32 + 32);

/**
 * "Not Connected" is a failure state, not just another category, so the two
 * bars take the reserved status pair. Matching on the label keeps this working
 * whatever casing or wording the backend uses.
 */
const isNotConnected = (label: string) => /\b(not|un)[\s_-]*(connected|answered)|fail|drop/i.test(label);

/** How the peak-ports subtitle should read for the bucket the backend chose. */
const BUCKET_LABEL: Record<string, string> = {
  minute: 'Highest concurrent ports per minute',
  hour: 'Highest concurrent ports per hour',
  day: 'Highest concurrent ports per day',
};

export function CDRDashboard({ filters }: CDRDashboardProps) {
  const theme = useChartTheme();

  // One request fills the whole page. The backend reads each daily parquet
  // file once and derives every panel from that single pass — eight separate
  // requests would re-read the same files eight times over a network share.
  const {
    data,
    isPending,
    error,
  } = useQuery({
    queryKey: ['cdr', 'dashboard', filters],
    queryFn: () => cdrApi.dashboard(filters),
  });

  const isEmptyList = (rows: CategoryDatum[] | undefined) => !rows || rows.length === 0;
  const peakPorts = data?.peak_ports ?? [];
  const reblastStages = data?.reblast.stages ?? [];
  const providers = data?.service_provider ?? [];
  const disconnects = data?.disconnect_reason ?? [];
  const locations = data?.location ?? [];
  const funnel = data?.call_funnel ?? [];

  // Voicedrop only — PROCEEDING/ALERT (initiated/ringed) are dial-out fields,
  // meaningless for the dial-in services.
  const isVoicedrop = filters.service === 'voicedrop';
  const initiated = funnel.find((d) => d.label === 'Call Initiated')?.value ?? 0;
  const connected = funnel.find((d) => d.label === 'Call Connected')?.value ?? 0;
  const connectRate = initiated > 0 ? Math.round((connected / initiated) * 100) : null;

  return (
    <div className="space-y-6">
      {/* Headline figures */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          label="Total Calls"
          value={formatCount(data?.summary.total_calls ?? 0)}
          icon={PhoneCall}
          isLoading={isPending}
          error={error}
        />
        <KpiCard
          label="Total Participants"
          value={formatCount(data?.summary.total_participants ?? 0)}
          icon={Users}
          isLoading={isPending}
          error={error}
          accent="bg-violet-500/10 border-violet-500/20 text-violet-500"
        />
        <KpiCard
          label="Minutes Usage"
          value={formatMinutes(data?.summary.minutes_usage ?? 0)}
          unit="min"
          icon={Timer}
          isLoading={isPending}
          error={error}
          accent="bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
        />
        <KpiCard
          label="DTMF Count"
          value={formatCount(data?.dtmf ?? 0)}
          icon={Hash}
          isLoading={isPending}
          error={error}
          accent="bg-amber-500/10 border-amber-500/20 text-amber-500"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {isVoicedrop && (
          <div className="lg:col-span-2">
            <ChartCard
              title="Call Ratio"
              subtitle="Call Initiated → Ringed → Connected → Ended"
              icon={PhoneOutgoing}
              isLoading={isPending}
              error={error}
              isEmpty={isEmptyList(data?.call_funnel)}
              height={260}
              headerSlot={
                !isPending && !error && connectRate !== null ? (
                  <div className="text-right shrink-0">
                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                      Connect Rate
                    </p>
                    <p className="text-xl font-bold text-zinc-900 dark:text-white leading-tight">
                      {connectRate}%
                    </p>
                  </div>
                ) : undefined
              }
            >
              <CategoryBarChart data={funnel} valueName="Calls" height={260} />
            </ChartCard>
          </div>
        )}

        <ChartCard
          title="Dial In vs Dial Out"
          subtitle="Calls by direction"
          icon={ArrowLeftRight}
          isLoading={isPending}
          error={error}
          isEmpty={isEmptyList(data?.call_direction)}
        >
          <CategoryBarChart data={data?.call_direction ?? []} valueName="Calls" height={260} />
        </ChartCard>

        <ChartCard
          title="Connected vs Not Connected"
          subtitle="Calls by connection status"
          icon={PlugZap}
          isLoading={isPending}
          error={error}
          isEmpty={isEmptyList(data?.connection_status)}
        >
          <CategoryBarChart
            data={data?.connection_status ?? []}
            valueName="Calls"
            height={260}
            colorFor={(datum) => (isNotConnected(datum.label) ? theme.critical : theme.good)}
          />
        </ChartCard>

        <ChartCard
          title="Location"
          subtitle="Calls by bridge server location"
          icon={MapPin}
          isLoading={isPending}
          error={error}
          isEmpty={isEmptyList(data?.location)}
        >
          <CategoryBarChart data={locations} valueName="Calls" height={260} />
        </ChartCard>

        <div className="lg:col-span-2">
          <ChartCard
            title="Peak Ports"
            subtitle={BUCKET_LABEL[data?.coverage.bucket ?? ''] ?? 'Highest concurrent ports per bucket'}
            icon={Waypoints}
            isLoading={isPending}
            error={error}
            isEmpty={peakPorts.length === 0}
            height={280}
          >
            <PeakPortsChart data={peakPorts} height={280} />
          </ChartCard>
        </div>

        <ChartCard
          title="Service Provider"
          subtitle="Calls by provider"
          icon={Radio}
          isLoading={isPending}
          error={error}
          isEmpty={providers.length === 0}
          height={barsHeight(providers.length)}
        >
          <CategoryBarChart
            data={providers}
            valueName="Calls"
            orientation="bars"
            height={barsHeight(providers.length)}
          />
        </ChartCard>

        <ChartCard
          title="Reblast"
          subtitle="Retries broken down by stage"
          icon={Repeat2}
          isLoading={isPending}
          error={error}
          isEmpty={reblastStages.length === 0}
          height={barsHeight(reblastStages.length)}
          headerSlot={
            !isPending && !error ? (
              <div className="text-right shrink-0">
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                  Total
                </p>
                <p className="text-xl font-bold text-zinc-900 dark:text-white leading-tight">
                  {formatCount(data?.reblast.total ?? 0)}
                </p>
              </div>
            ) : undefined
          }
        >
          <CategoryBarChart
            data={reblastStages}
            valueName="Reblasts"
            height={barsHeight(reblastStages.length)}
          />
        </ChartCard>

        <div className="lg:col-span-2">
          <ChartCard
            title="Disconnect Reason"
            subtitle="Calls by disconnect cause"
            icon={Unplug}
            isLoading={isPending}
            error={error}
            isEmpty={disconnects.length === 0}
            height={barsHeight(disconnects.length)}
          >
            <CategoryBarChart
              data={disconnects}
              valueName="Calls"
              orientation="bars"
              height={barsHeight(disconnects.length)}
            />
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
