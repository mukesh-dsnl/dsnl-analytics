import { useSearchParams } from 'react-router-dom';
import { CalendarDays, Clock, FileSpreadsheet, ReceiptText } from 'lucide-react';

/** The sections of one account's history on an Accounts page (?tab=). */
export type AccountTab = 'daily' | 'hours' | 'monthly' | 'statement';

export const ACCOUNT_TABS: { id: AccountTab; label: string; icon: typeof Clock }[] = [
  { id: 'daily', label: 'Daily Activity', icon: CalendarDays },
  { id: 'hours', label: 'Busiest Hours', icon: Clock },
  { id: 'monthly', label: 'Monthly Statement', icon: ReceiptText },
  { id: 'statement', label: 'Daily Statement', icon: FileSpreadsheet },
];

export function useAccountTab(): [AccountTab, (tab: AccountTab) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get('tab');
  const tab = ACCOUNT_TABS.some((t) => t.id === value) ? (value as AccountTab) : 'daily';
  const setTab = (next: AccountTab) =>
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      if (next === 'daily') out.delete('tab');
      else out.set('tab', next);
      return out;
    });
  return [tab, setTab];
}
