import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowLeftRight,
  Hash,
  Hourglass,
  Layers,
  MapPin,
  PhoneCall,
  PhoneOutgoing,
  PlugZap,
  Radio,
  Repeat2,
  Smartphone,
  Timer,
  Unplug,
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
import { MinutesByLocationTooltip } from './MinutesByLocationTooltip';
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
  { id: 'connection_status', label: 'Connected vs Not Connected', icon: PlugZap },
  { id: 'call_direction', label: 'Dial In vs Dial Out', icon: ArrowLeftRight },
  { id: 'location', label: 'Location', icon: MapPin },
  { id: 'service_provider', label: 'Service Provider', icon: Radio },
  { id: 'peak_ports', label: 'Peak Ports', icon: Waypoints },
  { id: 'reblast', label: 'Reblast', icon: Repeat2 },
  { id: 'disconnect_reason', label: 'Disconnect Reason', icon: Unplug },
];

/**
 * One tab in the chart strip.
 *
 * The active underline is drawn as a bordered span rather than a border on the
 * button itself, so it can sit flush on the strip's own rule and cover it
 * exactly — a border on the button would land a pixel above and read as a
 * double line.
 */
function ChartTab({
  isActive,
  onClick,
  label,
  icon: Icon,
}: {
  isActive: boolean;
  onClick: () => void;
  label: string;
  icon?: LucideIcon;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="tab"
      aria-selected={isActive}
      className={clsx(
        'relative flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
        isActive
          ? 'text-blue-600 dark:text-blue-400'
          : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200',
      )}
    >
      {Icon && <Icon className="w-4 h-4 shrink-0" />}
      {label}
      {isActive && (
        <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-blue-600 dark:bg-blue-400" />
      )}
    </button>
  );
}

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
  // Total Conference (distinct CRN + CONF_NUM) only means "one room" for the
  // two services actually built from rooms — on All or Voicedrop it would
  // just restate a number close to total_calls.
  const showTotalConferences = filters.service === 'conference' || filters.service === 'multicall';
  // Connect rate is read off the two-bar split — the connected bar as a share
  // of both — and belongs to that chart alone. The Call Ratio card carried one
  // too, against calls *initiated*, but a dial-out-only denominator made it a
  // different number under the same name; one rate, in one place.
  const connectionStatus = data?.connection_status ?? [];
  const connectionTotal = connectionStatus.reduce((sum, d) => sum + d.value, 0);
  const connectedCalls = connectionStatus
    .filter((d) => !isNotConnected(d.label))
    .reduce((sum, d) => sum + d.value, 0);
  const connectionRate =
    connectionTotal > 0 ? Math.round((connectedCalls / connectionTotal) * 100) : null;

  // Picking one chart title below focuses the grid on just that chart —
  // "All" (the default) shows the whole page as before.
  const [selectedChart, setSelectedChart] = useState<ChartId | null>(null);
  const visibleCharts = CHART_META.filter((c) => !c.voicedropOnly || isVoicedrop);
  const showChart = (id: ChartId) => selectedChart === null || selectedChart === id;
  const focused = (id: ChartId) => selectedChart === id;

  return (
    <div className="space-y-6">
      {/* Headline figures */}
      <div
        className={clsx(
          'grid grid-cols-1 sm:grid-cols-2 gap-4',
          showTotalConferences ? 'xl:grid-cols-5' : 'xl:grid-cols-4',
        )}
      >
        <KpiCard
          label="Total Attempts"
          value={formatCount(data?.summary.total_calls ?? 0)}
          icon={PhoneCall}
          isLoading={isPending}
          error={error}
        />
        <KpiCard
          label="Total Phone Numbers"
          value={formatCount(data?.summary.total_phone_numbers ?? 0)}
          icon={Smartphone}
          isLoading={isPending}
          error={error}
          accent="bg-violet-500/10 border-violet-500/20 text-violet-500"
        />
        {showTotalConferences && (
          <KpiCard
            label="Total Conference"
            value={formatCount(data?.summary.total_conferences ?? 0)}
            icon={Layers}
            isLoading={isPending}
            error={error}
            accent="bg-sky-500/10 border-sky-500/20 text-sky-500"
          />
        )}
        <KpiCard
          label="Total Minutes"
          value={formatCount(data?.summary.minutes_usage ?? 0)}
          icon={Timer}
          isLoading={isPending}
          error={error}
          tooltip={<MinutesByLocationTooltip breakdown={data?.minutes_by_location ?? []} />}
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

      {/* Chart picker — pick one to focus the grid on it, or stay on All.
          A tab strip rather than a row of chips: these are mutually exclusive
          views of the same page, which is what a tab bar means and a set of
          toggle chips does not. The underline sits on a full-width rule so the
          strip reads as one control even when it scrolls. */}
      {/* Scrollbar hidden, not scrolling disabled: the strip still drags and
          wheel-scrolls when the tabs outrun the width, but a horizontal bar
          under a tab row reads as a second, broken underline. */}
      <div className="border-b border-zinc-200 dark:border-zinc-800/60 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex items-center gap-1 min-w-max">
          <ChartTab
            isActive={selectedChart === null}
            onClick={() => setSelectedChart(null)}
            label="All"
          />
          {visibleCharts.map((chart) => (
            <ChartTab
              key={chart.id}
              isActive={selectedChart === chart.id}
              onClick={() => setSelectedChart((prev) => (prev === chart.id ? null : chart.id))}
              label={chart.label}
              icon={chart.icon}
            />
          ))}
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {isVoicedrop && showChart('call_ratio') && (
          <div className={clsx(focused('call_ratio') ? 'lg:col-span-2' : undefined)}>
            <ChartCard
              title="Call Ratio"
              subtitle="Hover a bar for its dial-in / dial-out mix"
              icon={PhoneOutgoing}
              isLoading={isPending}
              error={error}
              isEmpty={isEmptyList(data?.call_funnel)}
              height={260}
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

        {showChart('connection_status') && (
          <div className={clsx(focused('connection_status') ? 'lg:col-span-2' : undefined)}>
            <ChartCard
              title="Connected vs Not Connected"
              subtitle="Hover a bar for its dial direction, location and provider mix"
              icon={PlugZap}
              isLoading={isPending}
              error={error}
              isEmpty={isEmptyList(data?.connection_status)}
              headerSlot={
                !isPending && !error && connectionRate !== null ? (
                  <div className="text-right shrink-0">
                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                      Connect Rate
                    </p>
                    <p className="text-xl font-bold text-zinc-900 dark:text-white leading-tight">
                      {connectionRate}%
                    </p>
                  </div>
                ) : undefined
              }
            >
              <CategoryBarChart
                data={connectionStatus}
                valueName="Calls"
                height={260}
                colorFor={(datum) => (isNotConnected(datum.label) ? theme.critical : theme.good)}
                showValueLabels
                tooltipContent={crossTabTooltip('connection')}
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
