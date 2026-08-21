import { useChartTheme } from '../chartTheme';
import type { ReblastAidDatum } from '../api';

interface ReblastAidTooltipProps {
  /** The hovered bar — "Blast 0", "Blast 3", … */
  label: string;
  value: number;
  breakdown: ReblastAidDatum[];
}

/**
 * Hover readout for the Reblast chart: this blast's own total, then how its
 * calls split across AID_COUNT.
 *
 * AID_COUNT is the retry-attempt sequence — 0 is the initial state and 1-3 are
 * successive reblast attempts on a number that hadn't connected — so a blast
 * made up mostly of AID 0 went out first time, while a tail across AID 1-3 is
 * that blast working through numbers it had already failed to reach.
 */
export function ReblastAidTooltip({ label, value, breakdown }: ReblastAidTooltipProps) {
  const theme = useChartTheme();
  const row = breakdown.find((b) => b.label === label);
  const aid = row?.aid ?? [];
  const total = aid.reduce((sum, a) => sum + a.value, 0) || 1;

  return (
    <div
      className="rounded-lg border px-3 py-2.5 shadow-lg text-xs min-w-[180px]"
      style={{ background: theme.tooltipBg, borderColor: theme.tooltipBorder, color: theme.tooltipText }}
    >
      <p className="font-semibold mb-0.5 break-words">{label}</p>
      <p className="opacity-70 mb-2 tabular-nums">{value.toLocaleString()} calls</p>

      {aid.length === 0 ? (
        <p className="opacity-60">No AID breakdown.</p>
      ) : (
        aid.map((entry) => (
          <div key={entry.label} className="flex items-center justify-between gap-3 tabular-nums">
            <span className="opacity-80">{entry.label}</span>
            <span className="font-semibold">
              {entry.value.toLocaleString()} ({Math.round((entry.value / total) * 100)}%)
            </span>
          </div>
        ))
      )}
    </div>
  );
}
