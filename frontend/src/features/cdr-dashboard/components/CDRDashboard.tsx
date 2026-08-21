import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowLeftRight,
  Hash,
  Hourglass,
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
import type { LucideIcon } from 'lucide-react';
import { cdrApi } from '../api';
import type { CallCubeRow, CategoryDatum, CdrFilters } from '../api';
import { formatCount, useChartTheme } from '../chartTheme';
import { CategoryBarChart } from './CategoryBarChart';
import { ChartCard } from './ChartCard';
import { CrossTabTooltip } from './CrossTabTooltip';
import type { CubeDimension } from '../cubeDimensions';
import { DirectionSplitTooltip } from './DirectionSplitTooltip';
import { ReblastAidTooltip } from './ReblastAidTooltip';
import { KpiCard } from './KpiCard';
import { PeakPortsChart } from './PeakPortsChart';

/** Stable reference so a still-loading cube doesn't hand every tooltip closure a fresh empty array. */
const EMPTY_CUBE_ROWS: CallCubeRow[] = [];

interface CDRDashboardProps {
  filters: CdrFilters;
}

type ChartId =
  | 'call_ratio'
  | 'call_duration'
  | 'call_direction'
  | 'connection_status'
  | 'location'
  | 'peak_ports'
  | 'service_provider'
  | 'reblast'
  | 'disconnect_reason';

const CHART_META: { id: ChartId; label: string; icon: LucideIcon; voicedropOnly?: boolean }[] = [
  { id: 'call_ratio', label: 'Call Ratio', icon: PhoneOutgoing, voicedropOnly: true },
  { id: 'call_duration', label: 'Call Duration', icon: Hourglass, voicedropOnly: true },
  { id: 'call_direction', label: 'Dial In vs Dial Out', icon: ArrowLeftRight },
  { id: 'connection_status', label: 'Connected vs Not Connected', icon: PlugZap },
  { id: 'location', label: 'Location', icon: MapPin },
  { id: 'peak_ports', label: 'Peak Ports', icon: Waypoints },
  { id: 'service_provider', label: 'Service Provider', icon: Radio },
  { id: 'reblast', label: 'Reblast', icon: Repeat2 },
  { id: 'disconnect_reason', label: 'Disconnect Reason', icon: Unplug },
];

/** Row height for horizontal bar charts, so long category lists stay readable. */
const barsHeight = (count: number) => Math.max(200, Math.min(count, 12) * 32 + 32);

/**
 * Which categorical slot each Call Ratio stage takes.
 *
 * Ringed and Ended are swapped against their positional slots (1 and 3), so
 * the hue follows the stage by name rather than by its place in the array —
 * which also keeps the pairing stable if a stage is ever added or reordered.
 */
const FUNNEL_SLOT: Record<string, number> = {
  'Call Initiated': 0,
  'Call Ringed': 3,
  'Call Connected': 2,
  'Call Ended': 1,
};

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

  // Second, independent request: the joint location × connected × direction ×
  // provider distribution that powers each bar's hover breakdown below. Its
  // own query rather than folded into the dashboard call, since it's the only
  // consumer of that shape — every other panel stays a single-dimension count.
  const { data: cube } = useQuery({
    queryKey: ['cdr', 'call-cube', filters],
    queryFn: () => cdrApi.callCube(filters),
  });
  const cubeRows = cube?.rows ?? EMPTY_CUBE_ROWS;
  const crossTabTooltip = (dimension: CubeDimension) => (datum: CategoryDatum) => (
    <CrossTabTooltip dimension={dimension} value={datum.label} cubeRows={cubeRows} />
  );

  const isEmptyList = (rows: CategoryDatum[] | undefined) => !rows || rows.length === 0;
  const peakPorts = data?.peak_ports ?? [];
  const reblastStages = data?.reblast.stages ?? [];
  const reblastAid = data?.reblast_aid ?? [];
  const providers = data?.service_provider ?? [];
  const disconnects = data?.disconnect_reason ?? [];
  const locations = data?.location ?? [];
  const funnel = data?.call_funnel ?? [];
  const funnelDirection = data?.call_funnel_direction ?? [];
  const duration = data?.call_duration ?? [];
  const durationDirection = data?.call_duration_direction ?? [];

  // Voicedrop only — PROCEEDING/ALERT (initiated/ringed) and call duration
  // are dial-out-shaped concepts, meaningless for the dial-in services.
  const isVoicedrop = filters.service === 'voicedrop';
  const initiated = funnel.find((d) => d.label === 'Call Initiated')?.value ?? 0;
  const connected = funnel.find((d) => d.label === 'Call Connected')?.value ?? 0;
  const connectRate = initiated > 0 ? Math.round((connected / initiated) * 100) : null;

  // Picking one chart title below focuses the grid on just that chart —
  // "All" (the default) shows the whole page as before.
  const [selectedChart, setSelectedChart] = useState<ChartId | null>(null);
  const visibleCharts = CHART_META.filter((c) => !c.voicedropOnly || isVoicedrop);
  const showChart = (id: ChartId) => selectedChart === null || selectedChart === id;
  const focused = (id: ChartId) => selectedChart === id;

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
          value={formatCount(data?.summary.minutes_usage ?? 0)}
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

      {/* Chart picker — pick one to focus the grid on it, or stay on All. */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mr-1">
          Charts
        </span>
        <button
          type="button"
          onClick={() => setSelectedChart(null)}
          aria-pressed={selectedChart === null}
          className={clsx(
            'px-3 py-1.5 rounded-md text-xs font-medium border transition-colors',
            selectedChart === null
              ? 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-600/10 dark:text-blue-500 dark:border-blue-500/20'
              : 'text-zinc-500 border-zinc-200 dark:text-zinc-400 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
          )}
        >
          All
        </button>
        {visibleCharts.map((chart) => (
          <button
            key={chart.id}
            type="button"
            onClick={() => setSelectedChart((prev) => (prev === chart.id ? null : chart.id))}
            aria-pressed={selectedChart === chart.id}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors',
              selectedChart === chart.id
                ? 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-600/10 dark:text-blue-500 dark:border-blue-500/20'
                : 'text-zinc-500 border-zinc-200 dark:text-zinc-400 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
            )}
          >
            <chart.icon className="w-3.5 h-3.5" />
            {chart.label}
          </button>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {isVoicedrop && showChart('call_ratio') && (
          <div className={clsx(focused('call_ratio') || selectedChart === null ? 'lg:col-span-2' : undefined)}>
            <ChartCard
              title="Call Ratio"
              subtitle="Hover a bar for its dial-in / dial-out mix"
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
              <CategoryBarChart
                data={funnel}
                valueName="Calls"
                height={260}
                colorFor={(datum, index) => theme.categorical[FUNNEL_SLOT[datum.label] ?? index]}
                showValueLabels
                tooltipContent={(datum) => (
                  <DirectionSplitTooltip label={datum.label} value={datum.value} splits={funnelDirection} />
                )}
              />
            </ChartCard>
          </div>
        )}

        {isVoicedrop && showChart('call_duration') && (
          <div className={clsx(focused('call_duration') ? 'lg:col-span-2' : undefined)}>
            <ChartCard
              title="Call Duration"
              subtitle="Connected calls by length, in seconds — hover a bar for its dial-in / dial-out mix"
              icon={Hourglass}
              isLoading={isPending}
              error={error}
              isEmpty={isEmptyList(data?.call_duration)}
              height={260}
            >
              <CategoryBarChart
                data={duration}
                valueName="Calls"
                height={260}
                multicolor
                showValueLabels
                tooltipContent={(datum) => (
                  <DirectionSplitTooltip label={datum.label} value={datum.value} splits={durationDirection} />
                )}
              />
            </ChartCard>
          </div>
        )}

        {showChart('call_direction') && (
          <div className={clsx(focused('call_direction') ? 'lg:col-span-2' : undefined)}>
            <ChartCard
              title="Dial In vs Dial Out"
              subtitle="Hover a bar for its connection, location and provider mix"
              icon={ArrowLeftRight}
              isLoading={isPending}
              error={error}
              isEmpty={isEmptyList(data?.call_direction)}
            >
              <CategoryBarChart
                data={data?.call_direction ?? []}
                valueName="Calls"
                height={260}
                multicolor
                showValueLabels
                tooltipContent={crossTabTooltip('direction')}
              />
            </ChartCard>
          </div>
        )}

        {showChart('connection_status') && (
          <div className={clsx(focused('connection_status') ? 'lg:col-span-2' : undefined)}>
            <ChartCard
              title="Connected vs Not Connected"
              subtitle="Hover a bar for its dial direction, location and provider mix"
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
                showValueLabels
                tooltipContent={crossTabTooltip('connection')}
              />
            </ChartCard>
          </div>
        )}

        {showChart('location') && (
          <div className={clsx(focused('location') ? 'lg:col-span-2' : undefined)}>
            <ChartCard
              title="Location"
              subtitle="Hover a bar for its connection, direction and provider mix"
              icon={MapPin}
              isLoading={isPending}
              error={error}
              isEmpty={isEmptyList(data?.location)}
            >
              <CategoryBarChart
                data={locations}
                valueName="Calls"
                height={260}
                multicolor
                showValueLabels
                tooltipContent={crossTabTooltip('location')}
              />
            </ChartCard>
          </div>
        )}

        {showChart('peak_ports') && (
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
        )}

        {showChart('service_provider') && (
          <div className={clsx(focused('service_provider') ? 'lg:col-span-2' : undefined)}>
            <ChartCard
              title="Service Provider"
              subtitle="Hover a bar for its connection, direction and location mix"
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
                multicolor
                showValueLabels
                tooltipContent={crossTabTooltip('provider')}
              />
            </ChartCard>
          </div>
        )}

        {showChart('reblast') && (
          <div className="lg:col-span-2">
            <ChartCard
              title="Reblast"
              subtitle="Calls by which blast they went out on — hover a bar for its AID breakdown"
              icon={Repeat2}
              isLoading={isPending}
              error={error}
              isEmpty={reblastStages.length === 0}
              height={barsHeight(reblastStages.length)}
              headerSlot={
                !isPending && !error ? (
                  <div className="text-right shrink-0">
                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                      Reblasted
                    </p>
                    <p className="text-xl font-bold text-zinc-900 dark:text-white leading-tight">
                      {formatCount(data?.reblast.total ?? 0)}
                    </p>
                  </div>
                ) : undefined
              }
            >
              {/* Horizontal: a busy day runs to ~18 blasts, and "Blast 12" as a
                  rotated x-tick is unreadable well before that. */}
              <CategoryBarChart
                data={reblastStages}
                valueName="Calls"
                orientation="bars"
                height={barsHeight(reblastStages.length)}
                multicolor
                showValueLabels
                tooltipContent={(datum) => (
                  <ReblastAidTooltip
                    label={datum.label}
                    value={datum.value}
                    breakdown={reblastAid}
                  />
                )}
              />
            </ChartCard>
          </div>
        )}

        {showChart('disconnect_reason') && (
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
                multicolor
                showValueLabels
              />
            </ChartCard>
          </div>
        )}
      </div>
    </div>
  );
}
