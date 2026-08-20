import { useChartTheme } from '../chartTheme';
import type { DirectionSplitDatum } from '../api';

interface DirectionSplitTooltipProps {
  label: string;
  value: number;
  splits: DirectionSplitDatum[];
}

/**
 * Hover readout for Call Ratio and Call Duration: this bar's own total, plus
 * how much of it is Dial In vs Dial Out.
 *
 * For Call Ratio specifically, Initiated and Ringed come from PROCEEDING and
 * ALERT — dial-out-only fields per the data dictionary — so those two bars
 * read as close to 100% Dial Out. That's the real signal, not a gap in the
 * split; Connected and Ended are where a genuine mix shows up.
 */
export function DirectionSplitTooltip({ label, value, splits }: DirectionSplitTooltipProps) {
  const theme = useChartTheme();
  const row = splits.find((s) => s.label === label);
  const dialIn = row?.dial_in ?? 0;
  const dialOut = row?.dial_out ?? 0;
  const total = dialIn + dialOut || 1;

  return (
    <div
      className="rounded-lg border px-3 py-2.5 shadow-lg text-xs min-w-[160px]"
      style={{ background: theme.tooltipBg, borderColor: theme.tooltipBorder, color: theme.tooltipText }}
    >
      <p className="font-semibold mb-0.5 break-words">{label}</p>
      <p className="opacity-70 mb-2 tabular-nums">{value.toLocaleString()} calls</p>

      <div className="flex items-center justify-between gap-3 tabular-nums">
        <span className="opacity-80">Dial In</span>
        <span className="font-semibold">
          {dialIn.toLocaleString()} ({Math.round((dialIn / total) * 100)}%)
        </span>
      </div>
      <div className="flex items-center justify-between gap-3 tabular-nums">
        <span className="opacity-80">Dial Out</span>
        <span className="font-semibold">
          {dialOut.toLocaleString()} ({Math.round((dialOut / total) * 100)}%)
        </span>
      </div>
    </div>
  );
}
