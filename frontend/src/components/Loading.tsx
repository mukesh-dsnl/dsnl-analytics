import { Loader2 } from 'lucide-react';
import clsx from 'clsx';

/**
 * The app's loading look, first designed for Port Analyzer: a blue stripe
 * sweeping along the top edge of whatever is working, and a small
 * "Processing…" chip in its middle. The work behind these pages has no
 * known length, so the bar sweeps rather than fills.
 */

/** The sweeping stripe along the top edge of a `relative` container. */
export function ProgressSweep({ className }: { className?: string }) {
  return (
    <div
      className={clsx('pointer-events-none absolute inset-x-0 top-0 z-10 h-1 overflow-hidden bg-[#e8f0fe] dark:bg-sky-500/10', className)}
      role="progressbar"
      aria-label="Processing"
    >
      <div className="progress-sweep h-full w-1/4 rounded-full bg-[#2563eb]" />
    </div>
  );
}

/** The centred "Processing…" chip, over a `relative` container. */
export function ProcessingChip() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div className="flex items-center gap-3 rounded-xl border border-[#e4eaf2] bg-white/95 px-4 py-3 shadow-[0_10px_30px_rgba(15,23,42,0.12)] dark:border-white/[0.08] dark:bg-[#13213a]/95">
        <Loader2 className="h-5 w-5 animate-spin text-[#2563eb]" />
        <span className="text-[13px] font-semibold text-[#0f172a] dark:text-white">Processing…</span>
      </div>
    </div>
  );
}

/** A card-shaped placeholder while a page or panel loads: the sweep and the chip on faint rules. */
export function LoadingBlock({ height = 420, className }: { height?: number; className?: string }) {
  return (
    <div
      className={clsx(
        'relative overflow-hidden rounded-2xl border border-[#e4eaf2] bg-white dark:border-[#1c2a42] dark:bg-[#0e192c]',
        className,
      )}
      style={{ height }}
    >
      <ProgressSweep />
      <div className="absolute inset-6 bg-[repeating-linear-gradient(0deg,transparent_0_63px,#eef2f7_63px_64px)] dark:bg-[repeating-linear-gradient(0deg,transparent_0_63px,rgba(255,255,255,0.05)_63px_64px)]" />
      <ProcessingChip />
    </div>
  );
}
