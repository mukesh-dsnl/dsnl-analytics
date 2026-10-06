import type { ReactNode } from 'react';
import clsx from 'clsx';
import { initials } from '../lookup';

export function Avatar({ name, size = 'md' }: { name: string | null | undefined; size?: 'sm' | 'md' | 'lg' }) {
  return <span aria-hidden className={clsx(
    'inline-flex shrink-0 items-center justify-center rounded-full bg-blue-50 font-semibold text-blue-700 ring-1 ring-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20',
    size === 'sm' && 'h-8 w-8 text-[11px]',
    size === 'md' && 'h-9 w-9 text-xs',
    size === 'lg' && 'h-14 w-14 text-lg',
  )}>{initials(name)}</span>;
}

export function StatusPill({ status, size = 'sm' }: { status: number | null; size?: 'sm' | 'md' }) {
  const active = status === 1;
  return <span className={clsx(
    'inline-flex items-center gap-1.5 rounded-full font-semibold',
    size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-xs',
    active ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  )}>
    <span className={clsx('h-1.5 w-1.5 rounded-full', active ? 'bg-emerald-500' : 'bg-zinc-400')} />
    {active ? 'Active' : status === 0 ? 'Inactive' : 'Unknown'}
  </span>;
}

export function Field({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return <div className="min-w-0">
    <dt className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</dt>
    <dd className={clsx('mt-1 break-words text-sm font-medium text-zinc-900 dark:text-white', mono && 'tabular-nums')}>{children == null || children === '' ? '—' : children}</dd>
  </div>;
}

/** Marks a cell whose value is one of the searched values. */
export function Hit({ hit, children }: { hit: boolean; children: ReactNode }) {
  return hit
    ? <mark className="rounded bg-yellow-100 px-1 text-inherit dark:bg-yellow-400/20 dark:text-yellow-100">{children}</mark>
    : <>{children}</>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex min-w-5 items-center justify-center rounded border border-zinc-200 bg-zinc-50 px-1 font-sans text-[10px] font-semibold text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">{children}</kbd>;
}
