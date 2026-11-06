import clsx from 'clsx';

import { cleanName } from '../format';

const SIZES = {
  sm: { id: 'text-[12px]', dash: 'text-[12px]', name: 'text-[13px]' },
  md: { id: 'text-[13px]', dash: 'text-[13px]', name: 'text-sm' },
  lg: { id: 'text-[19px]', dash: 'text-[19px]', name: 'text-xl' },
};

/**
 * An account as one label: the id in the monospace face, a light hyphen,
 * then the name in the text face — the two read apart at a glance.
 */
export function AccountName({
  id,
  name,
  size = 'md',
  className,
}: {
  id: number;
  name: string | null | undefined;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const s = SIZES[size];
  const label = cleanName(name, id);
  return (
    <span className={clsx('inline-flex min-w-0 items-baseline gap-2', className)} title={name ? `${id} - ${name}` : String(id)}>
      <span className={clsx('shrink-0 font-mono font-semibold tabular-nums tracking-tight text-[#1d4ed8] dark:text-sky-300', s.id)}>{id}</span>
      {label && (
        <>
          <span aria-hidden className={clsx('shrink-0 font-normal text-[#8a99ad] dark:text-zinc-500', s.dash)}>
            -
          </span>
          <span className={clsx('min-w-0 truncate font-semibold text-[#16213a] dark:text-white', s.name)}>{label}</span>
        </>
      )}
    </span>
  );
}
