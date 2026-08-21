import { useChartTheme } from '../chartTheme';
import type { ReblastAidDatum } from '../api';

interface ReblastAidTooltipProps {
  /** The hovered bar — "Blast 0", "Blast 3", … */
  label: string;
  value: number;
  breakdown: ReblastAidDatum[];
}

/**
 * Hover readout for the Reblast chart, as a horizontal tree: this blast, its
 * AID_COUNT branches, and each of those split into a Connected / Not
 * Connected pair of leaves.
 *
 * AID_COUNT is the retry-attempt sequence — 0 is the initial state and 1-3 are
 * successive reblast attempts on a number that hadn't connected — so a blast
 * made up mostly of AID 0 went out first time, while a tail across AID 1-3 is
 * that blast working through numbers it had already failed to reach. The
 * connection split under each AID is what shows whether those retries are
 * paying off or just running up attempts against dead numbers.
 */
export function ReblastAidTooltip({ label, value, breakdown }: ReblastAidTooltipProps) {
  const theme = useChartTheme();
  const row = breakdown.find((b) => b.label === label);
  const aidBranches = row?.aid ?? [];

  return (
    <div
      className="rounded-lg border px-3 py-2.5 shadow-lg text-xs min-w-[220px]"
      style={{ background: theme.tooltipBg, borderColor: theme.tooltipBorder, color: theme.tooltipText }}
    >
      <p className="font-semibold mb-0.5 break-words">{label}</p>
      <p className="opacity-70 mb-2 tabular-nums">{value.toLocaleString()} calls</p>

      {aidBranches.length === 0 ? (
        <p className="opacity-60">No AID breakdown.</p>
      ) : (
        <div className="space-y-1.5">
          {aidBranches.map((aid) => {
            const aidTotal = aid.connected + aid.not_connected || 1;
            return (
              <div key={aid.label}>
                <div className="flex items-center justify-between gap-3 tabular-nums font-medium">
                  <span className="opacity-90">{aid.label}</span>
                  <span>{(aid.connected + aid.not_connected).toLocaleString()}</span>
                </div>

                {/* The two leaves under this AID — a vertical rule ties them
                    back to it, reading as branches off one node rather than
                    two more rows in a flat list. */}
                <div className="pl-3 mt-0.5 border-l" style={{ borderColor: theme.grid }}>
                  <div className="flex items-center justify-between gap-3 tabular-nums pl-2">
                    <span className="flex items-center gap-1.5 opacity-80">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: theme.good }} />
                      Connected
                    </span>
                    <span className="font-medium">
                      {aid.connected.toLocaleString()} ({Math.round((aid.connected / aidTotal) * 100)}%)
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 tabular-nums pl-2">
                    <span className="flex items-center gap-1.5 opacity-80">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: theme.critical }} />
                      Not Connected
                    </span>
                    <span className="font-medium">
                      {aid.not_connected.toLocaleString()} ({Math.round((aid.not_connected / aidTotal) * 100)}%)
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
