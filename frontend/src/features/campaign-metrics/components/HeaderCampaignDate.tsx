import { useCdrStatus, useCampaignDate } from '../hooks';
import type { CdrStatus } from '../../cdr-dashboard/api';
import { SingleDateSelector } from './SingleDateSelector';

/**
 * The Campaign Metrics single-date control as mounted in the app header —
 * mirrors ../../cdr-dashboard/components/HeaderDateRange.tsx, swapped to one
 * date instead of a range. Layout.tsx decides which of the two header date
 * controls to render based on the current route.
 */
export function HeaderCampaignDate() {
  const { data: status } = useCdrStatus();
  if (!status) return null;
  return <Ready status={status} />;
}

function Ready({ status }: { status: CdrStatus }) {
  const { date, setDate } = useCampaignDate(status);
  return <SingleDateSelector date={date} onChange={setDate} status={status} variant="brand" />;
}
