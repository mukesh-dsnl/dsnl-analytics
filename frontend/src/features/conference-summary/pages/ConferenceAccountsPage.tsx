import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { useHeaderSlot } from '../../../components/HeaderSlot';
import { LoadingBlock } from '../../../components/Loading';
import { HoverTooltipProvider } from '../../cdr-dashboard/components/attempt-analytics/HoverTooltip';
import { compact, fmt } from '../../cdr-dashboard/components/attempt-analytics/design';
import { AccountDirectory } from '../../summary/components/AccountDirectory';
import { AccountSelect, Centered, Problem } from '../../summary/components/PageParts';
import { dayLabel } from '../../summary/format';
import { conferenceSummaryApi } from '../api';
import { AccountView } from '../components/AccountView';

const PROBLEM = "Couldn't read conference_summary.";

/**
 * Conference › Accounts: every account, searchable (?q=), and one account's
 * history (?account=). Clicking a day opens that account's conferences on
 * the Campaigns tab of Campaign Metrics.
 */
export function ConferenceAccountsPage() {
  const [params, setParams] = useSearchParams();
  const accountId = Number(params.get('account')) || null;
  const headerSlot = useHeaderSlot();
  const navigate = useNavigate();

  const overview = useQuery({
    queryKey: ['conference-summary', 'overview'],
    queryFn: conferenceSummaryApi.overview,
    staleTime: 5 * 60_000,
  });
  const openAccount = (id: number) => setParams({ account: String(id) });
  const openDay = (iso: string) =>
    navigate(`/analytics/conference/campaign-metrics?view=campaigns&date=${iso}&account=${accountId}`);

  const header =
    headerSlot &&
    createPortal(
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <h1 className="shrink-0 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Conference Accounts</h1>
        {overview.data && (
          <AccountSelect
            value={accountId}
            onChange={(id) => setParams(id ? { account: String(id) } : {})}
            options={overview.data.accounts.map((a) => ({
              id: a.account_id,
              label: `${a.account_id}${a.name ? ` — ${a.name}` : ''} · ${compact(a.attended_minutes)} min${a.days_idle >= 15 ? ` · quiet ${a.days_idle}d` : ''}`,
            }))}
          />
        )}
        {overview.data?.as_of && (
          <span className="ml-auto hidden shrink-0 text-xs text-zinc-500 sm:inline dark:text-zinc-400">Data to {dayLabel(overview.data.as_of)}</span>
        )}
      </div>,
      headerSlot,
    );

  return (
    <HoverTooltipProvider>
      {header}
      <div className="vd-design mx-auto max-w-[1500px] p-8">
        {accountId ? (
          <AccountView key={accountId} accountId={accountId} onDay={openDay} />
        ) : overview.isPending ? (
          <LoadingBlock />
        ) : overview.error ? (
          <Problem title={PROBLEM} message={overview.error.message} onRetry={() => overview.refetch()} />
        ) : !overview.data.as_of ? (
          <Centered>conference_summary has no rows yet.</Centered>
        ) : (
          <AccountDirectory
            rows={overview.data.accounts.map((a) => ({
              account_id: a.account_id,
              name: a.name,
              total: a.attended_minutes,
              detail: `${fmt(a.conferences)} conferences`,
              last_date: a.last_date,
              days_idle: a.days_idle,
            }))}
            totalLabel="Attended minutes"
            query={params.get('q') ?? ''}
            onQuery={(q) => setParams(q ? { q } : {})}
            onAccount={openAccount}
          />
        )}
      </div>
    </HoverTooltipProvider>
  );
}
