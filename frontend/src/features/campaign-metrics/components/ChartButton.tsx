import clsx from 'clsx';
import { ChartNoAxesColumn, PanelRightOpen } from 'lucide-react';

import { ROW_ACTION_CLASS, ROW_ACTION_IDLE_CLASS } from './TableChrome';

/** The row-end "view charts" button — it stops the click so the row behind it does not also act. */
export function ChartButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title="View charts"
      className={clsx(ROW_ACTION_CLASS, ROW_ACTION_IDLE_CLASS)}
    >
      <ChartNoAxesColumn className="h-[18px] w-[18px]" strokeWidth={2.6} />
    </button>
  );
}

/** The row-end "show details" button: opens the row's side panel at once. */
export function DetailsButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title="Show details"
      className={clsx(ROW_ACTION_CLASS, ROW_ACTION_IDLE_CLASS)}
    >
      <PanelRightOpen className="h-[18px] w-[18px]" strokeWidth={2.2} />
    </button>
  );
}
