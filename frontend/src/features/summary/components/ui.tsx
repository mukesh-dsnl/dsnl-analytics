import clsx from 'clsx';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';

/** A small two-or-three-way switch for a card's corner: what the card measures. */
export function Toggle<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-lg bg-[#eef3f9] p-0.5 dark:bg-white/[0.06]">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={option.id === value}
          onClick={() => onChange(option.id)}
          className={clsx(
            'rounded-md px-2.5 py-1 text-[11px] font-medium whitespace-nowrap transition-colors',
            option.id === value
              ? 'bg-white text-[#2f6fa8] shadow-sm dark:bg-white/[0.12] dark:text-sky-200'
              : 'text-[#6a7d96] hover:text-[#33445e] dark:text-zinc-400 dark:hover:text-zinc-200',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** "▲ 12.4%" in green, "▼ 8%" in orange, or "new" when there is nothing to compare with. */
export function Change({ now, before, className }: { now: number; before: number; className?: string }) {
  if (!before) {
    return now > 0 ? (
      <span className={clsx('text-[11px] font-medium text-[#25a883]', className)}>new</span>
    ) : null;
  }
  const change = ((now - before) / before) * 100;
  const up = change >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums',
        up ? 'text-[#25a883]' : 'text-[#e07d2c]',
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {Math.abs(change) >= 1000 ? `${Math.round(change / 100) / 10}k%` : `${Math.abs(Number(change.toFixed(1)))}%`}
    </span>
  );
}

/**
 * An account as the page names it: the id, with its client ids — or, where
 * the table has one, its name — quietly after.
 */
export function AccountName({ id, clients, name }: { id: number; clients?: number[]; name?: string | null }) {
  return (
    <span className="flex min-w-0 items-baseline">
      <span className="shrink-0 font-medium tabular-nums text-[#35415a] dark:text-zinc-100">{id}</span>
      {name && (
        <span className="ml-1.5 min-w-0 truncate text-[11px] text-[#8a99ad] dark:text-zinc-500" title={name}>
          {name}
        </span>
      )}
      {!name && !!clients?.length && (
        <span className="ml-1.5 truncate text-[11px] tabular-nums text-[#8a99ad] dark:text-zinc-500">
          client {clients.slice(0, 2).join(', ')}
          {clients.length > 2 && ` +${clients.length - 2}`}
        </span>
      )}
    </span>
  );
}
