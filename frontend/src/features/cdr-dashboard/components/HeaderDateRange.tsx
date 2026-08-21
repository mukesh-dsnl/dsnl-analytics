import { useCdrStatus, useDateRange } from '../hooks';
import type { CdrStatus } from '../api';
import { DateSelector } from './DateSelector';

/**
 * The date range control as mounted in the app header.
 *
 * Split from DateSelector so the seeding hook only runs once the status query
 * has answered — `useDateRange` needs the lake's coverage to know what day to
 * open on, and hooks can't be called conditionally inside the control itself.
 *
 * Renders nothing while the status is still in flight, or if it failed: the
 * page below surfaces that error properly, and a second copy of it wedged
 * into the header would be noise.
 */
export function HeaderDateRange() {
  const { data: status } = useCdrStatus();
  if (!status) return null;
  return <Ready status={status} />;
}

function Ready({ status }: { status: CdrStatus }) {
  const { from, to, setRange } = useDateRange(status);
  return <DateSelector from={from} to={to} onChange={setRange} status={status} variant="brand" />;
}
