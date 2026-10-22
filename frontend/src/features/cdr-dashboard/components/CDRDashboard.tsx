import { useQuery } from '@tanstack/react-query';
import { cdrApi } from '../api';
import type { CallCubeRow, CdrFilters } from '../api';
import { AttemptCharts } from './attempt-analytics/AttemptCharts';
import { AttemptKpis } from './attempt-analytics/AttemptKpis';
import { HoverTooltipProvider } from './attempt-analytics/HoverTooltip';

/** Stable reference so a still-loading cube doesn't hand every readout a fresh empty array. */
const EMPTY_CUBE_ROWS: CallCubeRow[] = [];

interface CDRDashboardProps {
  filters: CdrFilters;
}

/**
 * The attempt-metrics dashboard, in the attempt-analytics redesign, for every
 * service — tinted headline cards and grouped charts sharing one hover
 * readout.
 */
export function CDRDashboard({ filters }: CDRDashboardProps) {
  // One request fills the whole page. The backend reads each daily parquet
  // file once and derives every panel from that single pass — eight separate
  // requests would re-read the same files eight times over a network share.
  const { data, isPending, error } = useQuery({
    queryKey: ['cdr', 'dashboard', filters],
    queryFn: () => cdrApi.dashboard(filters),
  });

  // Second, independent request: the joint location × connected × direction ×
  // provider distribution behind the hover breakdowns. Its own query, since
  // it's the only consumer of that shape.
  const { data: cube } = useQuery({
    queryKey: ['cdr', 'call-cube', filters],
    queryFn: () => cdrApi.callCube(filters),
  });
  const cubeRows = cube?.rows ?? EMPTY_CUBE_ROWS;

  // Call activity and Call duration chart dial-out stages (initiated, rang),
  // which only Voicedrop has.
  const dialOutStages = filters.service === 'voicedrop';
  // A conference (distinct CRN + CONF_NUM) is one room only for the two
  // services built from rooms; on All or Voicedrop it would just restate a
  // number close to the attempts.
  const showConferences = filters.service === 'conference' || filters.service === 'multicall';

  return (
    <HoverTooltipProvider>
      <div className="space-y-6">
        <AttemptKpis data={data} isLoading={isPending} error={error} showConferences={showConferences} />
        <AttemptCharts
          data={data}
          cubeRows={cubeRows}
          isLoading={isPending}
          error={error}
          dialOutStages={dialOutStages}
        />
      </div>
    </HoverTooltipProvider>
  );
}
