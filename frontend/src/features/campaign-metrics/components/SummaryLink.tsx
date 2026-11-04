import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';

/**
 * An id in a Campaign Metrics table that opens its page elsewhere — an
 * account's Summary, a client within it, a CPIN in the registry. Looks like
 * the figure it replaces until hovered, so the tables stay calm to read.
 */
export function SummaryLink({
  to,
  title,
  className,
  children,
}: {
  to: string;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      title={title}
      onClick={(e) => e.stopPropagation()}
      className={clsx(
        'rounded-sm underline-offset-2 transition-colors hover:text-[#1d4ed8] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#42b9e9] dark:hover:text-sky-300',
        className,
      )}
    >
      {children}
    </Link>
  );
}
