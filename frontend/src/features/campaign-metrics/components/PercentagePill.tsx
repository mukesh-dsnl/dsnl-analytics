import clsx from 'clsx';

/**
 * Connected-percentage badge shared by every Campaign Metrics table.
 *
 * Thresholds are a plain readability aid, not a status encoding tied to any
 * business rule — there's no "critical" service state here, just a number
 * that's easier to scan with a bit of color at a glance.
 */
export function PercentagePill({ value }: { value: number }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold tabular-nums',
        value >= 70
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
          : value >= 40
            ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'
            : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
      )}
    >
      {value.toFixed(1)}%
    </span>
  );
}
