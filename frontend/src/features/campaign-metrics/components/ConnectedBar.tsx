import clsx from 'clsx';

/**
 * Connected-percentage meter: a filled track plus the figure beside it.
 *
 * The bar and the number carry the same three-band colour, but the number is
 * always printed — the colour is a scanning aid on top of a value that is
 * legible without it, never the thing you have to read.
 *
 * Bands are a readability convention, not a business rule: there is no
 * documented "good" connect rate in the data dictionary.
 */
const band = (value: number) =>
  value >= 70
    ? { bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' }
    : value >= 40
      ? { bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-500' }
      : { bar: 'bg-red-500', text: 'text-red-600 dark:text-red-400' };

export function ConnectedBar({ value, dim = false }: { value: number; dim?: boolean }) {
  const tone = band(value);

  return (
    <div className="flex items-center gap-2.5 justify-end">
      <div className="w-20 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden shrink-0">
        <div
          className={clsx('h-full rounded-full transition-[width]', tone.bar, dim && 'opacity-70')}
          style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
        />
      </div>
      <span
        className={clsx(
          'w-14 text-right text-sm font-semibold tabular-nums',
          dim ? 'text-zinc-500 dark:text-zinc-500' : tone.text,
        )}
      >
        {value.toFixed(1)}%
      </span>
    </div>
  );
}
