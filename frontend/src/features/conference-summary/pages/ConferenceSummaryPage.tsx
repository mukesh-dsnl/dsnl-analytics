import { createPortal } from 'react-dom';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Clock, FileSpreadsheet, ReceiptText, UserRoundSearch } from 'lucide-react';

import { useHeaderSlot } from '../../../components/HeaderSlot';
import { LoadingBlock } from '../../../components/Loading';
import { HoverTooltipProvider } from '../../cdr-dashboard/components/attempt-analytics/HoverTooltip';
import { Centered, Problem } from '../../summary/components/PageParts';
import { SectionTabs } from '../../summary/components/SectionTabs';
import { dayLabel } from '../../summary/format';
import { conferenceSummaryApi } from '../api';
import { ConferenceSections } from '../components/AllAccountsView';
import type { ConferenceTab } from '../components/AllAccountsView';

const TABS: { id: ConferenceTab; label: string; icon: typeof Clock }[] = [
  { id: 'daily', label: 'Daily Activity', icon: CalendarDays },
  { id: 'hours', label: 'Busiest Hours', icon: Clock },
  { id: 'monthly', label: 'Monthly Statement', icon: ReceiptText },
  { id: 'statement', label: 'Daily Statement', icon: FileSpreadsheet },
  { id: 'watch', label: 'Accounts to Watch', icon: UserRoundSearch },
];

const PROBLEM = "Couldn't read conference_summary.";

/**
 * Conference › Summary, from q100_dump.conference_summary on 192.168.0.117:
 * every account together, in five sections under one strip (?tab=). One
 * account's history is the Accounts page. Clicking a day opens that day's
 * conferences on the Campaigns tab of Conference › Campaign Metrics.
 */
export function ConferenceSummaryPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const headerSlot = useHeaderSlot();
  const tab: ConferenceTab = TABS.some((t) => t.id === params.get('tab')) ? (params.get('tab') as ConferenceTab) : 'daily';

  const overview = useQuery({
    queryKey: ['conference-summary', 'overview'],
    queryFn: conferenceSummaryApi.overview,
    staleTime: 5 * 60_000,
  });

  // One account's history moved to the Accounts page; old links follow it.
  if (params.get('account') || params.get('view') === 'account') {
    const next = new URLSearchParams(location.search);
    next.delete('view');
    const rest = next.toString();
    return <Navigate to={`/analytics/conference/accounts${rest ? `?${rest}` : ''}`} replace />;
  }

  const openDay = (iso: string) => navigate(`/analytics/conference/campaign-metrics?view=campaigns&date=${iso}`);
  const openAccount = (id: number) => navigate(`/analytics/conference/accounts?account=${id}`);

  const header =
    headerSlot &&
    createPortal(
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
        <h1 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">Conference Summary</h1>
        {overview.data?.as_of && (
          <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">Data to {dayLabel(overview.data.as_of)}</span>
        )}
      </div>,
      headerSlot,
    );

  return (
    <HoverTooltipProvider>
      {header}
      <div className="vd-design mx-auto max-w-[1500px] p-8">
        <SectionTabs tabs={TABS} active={tab} onTab={(next) => setParams(next === 'daily' ? {} : { tab: next })} />
        {overview.isPending ? (
          <LoadingBlock />
        ) : overview.error ? (
          <Problem title={PROBLEM} message={overview.error.message} onRetry={() => overview.refetch()} />
        ) : !overview.data.as_of ? (
          <Centered>conference_summary has no rows yet.</Centered>
        ) : (
          <ConferenceSections data={overview.data} tab={tab} onDay={openDay} onAccount={openAccount} />
        )}
      </div>
    </HoverTooltipProvider>
  );
}
