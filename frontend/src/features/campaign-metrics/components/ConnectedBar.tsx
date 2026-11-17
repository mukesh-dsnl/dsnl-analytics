import clsx from 'clsx';
import { SMALL_GROUP } from '../labels';

/**
 * Connected-percentage meter: a filled track plus the figure beside it.
 *
 * The bar and the number carry the same three-band colour, but the number is
 * always printed — the colour is a scanning aid on top of a value that is
 * legible without it, never the thing you have to read.
 *
 * Bands are a readability convention, not a business rule: there is no
 * documented "good" connect rate in the data dictionary. ConnectedKey below
 * prints them above the table, so the colours are not left to be guessed.
 */
const BANDS = [
  { from: 70, label: '70% and above', bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  { from: 40, label: '40% to 70%', bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-500' },
  { from: 0, label: 'Below 40%', bar: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
];
const band = (value: number) => BANDS.find((b) => value >= b.from) ?? BANDS[BANDS.length - 1];

const MUTED = { bar: 'bg-zinc-400 dark:bg-zinc-500', text: 'text-zinc-500 dark:text-zinc-400' };

export function ConnectedBar({
  value,
  dim = false,
  muted = false,
  unit = 'numbers',
}: {
  value: number;
  dim?: boolean;
  /**
   * The group is too small for its percentage to mean much (under SMALL_GROUP):
   * the figure stays, the green/amber/red does not, so 4 of 4 no longer reads
   * as the day's best result.
   */
  muted?: boolean;
  /** What the group is counted in, for the muted bar's hover note. */
  unit?: string;
}) {
  const tone = muted ? MUTED : band(value);

  return (
    <div
      className="flex items-center gap-2.5 justify-end"
      title={muted ? `Fewer than ${SMALL_GROUP} ${unit} — too few for the percentage to mean much` : undefined}
    >
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

/** The key to ConnectedBar's colours, for the bar above a table that uses it. */
export function ConnectedKey({ unit }: { unit: string }) {
  const items = [
    ...[...BANDS].reverse().map((b) => ({ swatch: b.bar, label: b.label })),
    { swatch: MUTED.bar, label: `Under ${SMALL_GROUP} ${unit}` },
  ];
  return (
    <ul
      aria-label="Connected % colour key"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-2 text-[11px] text-zinc-500 dark:text-zinc-400"
    >
      <li className="font-semibold text-zinc-600 dark:text-zinc-300">Connected %</li>
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span aria-hidden="true" className={clsx('h-2 w-2 rounded-full', item.swatch)} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
