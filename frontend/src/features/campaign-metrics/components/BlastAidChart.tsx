import { useChartTheme } from '../../cdr-dashboard/chartTheme';
import type { InsightAid } from '../api';

/**
 * The four bars in each AID group, in fixed slot order.
 *
 * Hues come from the app's validated categorical ramp by position — slots 1-4 —
 * rather than being picked per chart, so identity never depends on a colour
 * invented here. The legend plus the value printed on every dotted cap means
 * the series are never distinguished by colour alone.
 */
const SERIES = [
  { key: 'proceeded', label: 'Proceeded', slot: 0 },
  { key: 'alert', label: 'Alert', slot: 1 },
  { key: 'connected', label: 'Connected', slot: 2 },
  { key: 'ended', label: 'Ended', slot: 3 },
] as const;

const PAD = { top: 18, right: 12, bottom: 28, left: 48 };
const ROW_HEIGHT = 210;
/** Share of one AID group's width left as a gutter between groups. */
const GROUP_GAP = 0.28;

/** A y-axis that ends on a round number, so the gridlines read as values rather than fractions. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const rawStep = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? magnitude * 10;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step / 2; v += step) ticks.push(v);
  return ticks;
}

const compact = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);

/**
 * One blast's AID breakdown: four bars per AID, capped by a dashed line at that
 * AID's total dial-out count.
 *
 * Drawn as plain SVG rather than through the charting library because the
 * dashed cap is per-group — it has to span exactly one AID's bars and carry
 * that group's own value. A library reference line spans the whole plot, and a
 * line series would connect the groups into one path, which would read as a
 * trend across AIDs that doesn't exist.
 */
export function BlastAidChart({ aids }: { aids: InsightAid[] }) {
  const theme = useChartTheme();

  // The cap is a ceiling over its group by construction (the backend scopes the
  // whole grid to dial-out rows), so the axis only has to clear the caps.
  const peak = Math.max(1, ...aids.map((a) => Math.max(a.total_initiated, a.proceeded, a.alert, a.connected, a.ended)));
  const ticks = niceTicks(peak);
  const axisMax = ticks[ticks.length - 1];

  const width = 720;
  const plotW = width - PAD.left - PAD.right;
  const plotH = ROW_HEIGHT - PAD.top - PAD.bottom;

  const groupW = plotW / Math.max(aids.length, 1);
  const barsW = groupW * (1 - GROUP_GAP);
  const barW = barsW / SERIES.length;

  const y = (value: number) => PAD.top + plotH - (value / axisMax) * plotH;

  return (
    <svg
      viewBox={`0 0 ${width} ${ROW_HEIGHT}`}
      className="w-full h-auto"
      role="img"
      aria-label={`Blast breakdown by AID: ${aids.map((a) => `${a.label} ${a.total_initiated} initiated`).join(', ')}`}
    >
      {/* Gridlines and y ticks — recessive, behind the marks */}
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={y(tick)}
            y2={y(tick)}
            stroke={theme.grid}
            strokeWidth={1}
          />
          <text
            x={PAD.left - 8}
            y={y(tick) + 3.5}
            textAnchor="end"
            fontSize={10}
            fill={theme.axis}
          >
            {compact(tick)}
          </text>
        </g>
      ))}

      {aids.map((aid, index) => {
        const groupX = PAD.left + index * groupW + (groupW - barsW) / 2;
        const capY = y(aid.total_initiated);

        return (
          <g key={aid.label}>
            {SERIES.map((series, slot) => {
              const value = aid[series.key];
              const barY = y(value);
              const height = PAD.top + plotH - barY;
              // 2px of surface between neighbours instead of a stroke, and a
              // rounded data-end that stays square where it meets the baseline.
              return (
                <rect
                  key={series.key}
                  x={groupX + slot * barW + 1}
                  y={barY}
                  width={Math.max(barW - 2, 1)}
                  height={Math.max(height, value > 0 ? 1 : 0)}
                  rx={3}
                  fill={theme.categorical[series.slot]}
                >
                  <title>{`${aid.label} — ${series.label}: ${value.toLocaleString()}`}</title>
                </rect>
              );
            })}

            {/* The dotted cap: this AID's total dial-out count, labelled. */}
            {aid.total_initiated > 0 && (
              <>
                <line
                  x1={groupX - 2}
                  x2={groupX + barsW + 2}
                  y1={capY}
                  y2={capY}
                  stroke={theme.axis}
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                />
                <text
                  x={groupX + barsW / 2}
                  y={capY - 5}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={600}
                  fill={theme.axis}
                >
                  {aid.total_initiated.toLocaleString()}
                </text>
              </>
            )}

            <text
              x={groupX + barsW / 2}
              y={ROW_HEIGHT - 10}
              textAnchor="middle"
              fontSize={11}
              fill={theme.axis}
            >
              {aid.label}
            </text>
          </g>
        );
      })}

      {/* Baseline */}
      <line
        x1={PAD.left}
        x2={width - PAD.right}
        y1={PAD.top + plotH}
        y2={PAD.top + plotH}
        stroke={theme.axis}
        strokeWidth={1}
      />
    </svg>
  );
}

/** Shared legend — one per popup rather than repeated under every blast. */
export function BlastAidLegend() {
  const theme = useChartTheme();

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-600 dark:text-zinc-400">
      {SERIES.map((series) => (
        <span key={series.key} className="inline-flex items-center gap-1.5">
          <span
            className="w-3 h-3 rounded-sm shrink-0"
            style={{ backgroundColor: theme.categorical[series.slot] }}
          />
          {series.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <svg width="20" height="10" aria-hidden="true">
          <line x1="0" y1="5" x2="20" y2="5" stroke={theme.axis} strokeWidth="1.5" strokeDasharray="5 4" />
        </svg>
        Total Initiated (dial-out)
      </span>
    </div>
  );
}
