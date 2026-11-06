import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { ACCOUNT_TABS } from '../accountTabs';
import type { AccountTab } from '../accountTabs';
import { AccountName } from './AccountName';
import { SectionTabs } from './SectionTabs';

/** One account's heading — back link, id - name, anything under it (client chips) — then the section strip. */
export function AccountHeader({
  backTo,
  id,
  name,
  tab,
  onTab,
  children,
}: {
  backTo: string;
  id: number;
  name: string | null;
  tab: AccountTab;
  onTab: (tab: AccountTab) => void;
  children?: ReactNode;
}) {
  return (
    <>
      <Link
        to={backTo}
        className="mb-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-[#5b6a82] transition-colors hover:text-[#1d4ed8] dark:text-zinc-400 dark:hover:text-sky-300"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All accounts
      </Link>
      <div className="mb-4 flex flex-col gap-2.5">
        <h1 className="flex min-w-0">
          <AccountName id={id} name={name} size="lg" />
        </h1>
        {children}
      </div>
      <SectionTabs tabs={ACCOUNT_TABS} active={tab} onTab={onTab} />
    </>
  );
}
