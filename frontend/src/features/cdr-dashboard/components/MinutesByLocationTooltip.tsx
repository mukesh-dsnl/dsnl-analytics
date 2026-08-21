import { useChartTheme } from '../chartTheme';
import type { LocationMinutesDatum } from '../api';

interface MinutesByLocationTooltipProps {
  breakdown: LocationMinutesDatum[];
}

/**
 * Hover readout for the Minutes Usage KPI: connected-call minutes by
 * location, each split into its Dial In / Dial Out branches.
 *
 * Each line is its own rounded-up minute figure — the same ceiling the
 * headline KPI uses — so a location's total and its two branches can be off
 * by a minute or two from a naive sum. That's the same rounding the top-line
 * figure already carries, not a new inconsistency.
 */
export function MinutesByLocationTooltip({ breakdown }: MinutesByLocationTooltipProps) {
  const theme = useChartTheme();

  if (breakdown.length === 0) {
    return (
      <div
        className="rounded-lg border px-3 py-2.5 shadow-lg text-xs"
        style={{ background: theme.tooltipBg, borderColor: theme.tooltipBorder, color: theme.tooltipText }}
      >
        <p className="opacity-60">No minutes recorded.</p>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border px-3 py-2.5 shadow-lg text-xs min-w-[200px]"
      style={{ background: theme.tooltipBg, borderColor: theme.tooltipBorder, color: theme.tooltipText }}
    >
      <p className="font-semibold mb-2 opacity-90">Minutes by Location</p>
      <div className="space-y-1.5">
        {breakdown.map((loc) => (
          <div key={loc.label}>
            <div className="flex items-center justify-between gap-3 tabular-nums font-medium">
              <span className="opacity-90">{loc.label}</span>
              <span>{loc.minutes.toLocaleString()} min</span>
            </div>

            <div className="pl-3 mt-0.5 border-l" style={{ borderColor: theme.grid }}>
              <div className="flex items-center justify-between gap-3 tabular-nums pl-2">
                <span className="opacity-80">Dial In</span>
                <span className="font-medium">{loc.dial_in.toLocaleString()} min</span>
              </div>
              <div className="flex items-center justify-between gap-3 tabular-nums pl-2">
                <span className="opacity-80">Dial Out</span>
                <span className="font-medium">{loc.dial_out.toLocaleString()} min</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
