import { useCdrStatus, useDateRange } from '../hooks';
import type { CdrStatus } from '../api';
import { SingleDateSelector } from '../../campaign-metrics/components/SingleDateSelector';

/**
 * The header date control on a service's Attempt Metrics (Voicedrop,
 * Conference, MultiCall): one day, not a range.
 *
 * It reads and writes the same shared range as HeaderDateRange, setting both
 * ends to the chosen day, so moving between these pages keeps the day. When
 * the shared range spans several days (set on the All services page), the
 * page shows its last day — the same day CDRDashboardPage queries.
 */
export function HeaderAttemptDay() {
  const { data: status } = useCdrStatus();
  if (!status) return null;
  return <Ready status={status} />;
}

function Ready({ status }: { status: CdrStatus }) {
  const { to, setRange } = useDateRange(status);
  return <SingleDateSelector date={to} onChange={(day) => setRange(day, day)} status={status} variant="outline" />;
}
