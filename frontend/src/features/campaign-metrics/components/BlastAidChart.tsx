import { useChartTheme } from '../../cdr-dashboard/chartTheme';
import type { InsightAid } from '../api';
import { useChartTooltip } from '../useChartTooltip';
import { useInsightPalette } from '../insightPalette';
import { ChartTooltip } from './ChartTooltip';

/**
 * The four bars in each AID group, in fixed slot order.
 *
 * "Started" and "Ringing" are the CDR columns PROCEEDING and ALERT — the blast
 * going out and the handset ringing (data dictionary #12, #13) — named here for
 * what they mean rather than for the column they come from.
 *
 * Hues come from the popup's validated palette by name; see insightPalette.ts
 * for the measurements and for why Connected is violet.
 */
const SERIES = [
  { key: 'proceeded', label: 'Started', tone: 'started' },
  { key: 'alert', label: 'Ringing', tone: 'ringing' },
  { key: 'connected', label: 'Connected', tone: 'connected' },
  { key: 'ended', label: 'Ended', tone: 'ended' },
] as const;

const PAD = { top: 26, right: 12, bottom: 28, left: 44 };
const ROW_HEIGHT = 230;
/** Share of one AID group's width left as a gutter between groups. */
const GROUP_GAP = 0.3;
/** Opacity applied to every mark except the hovered one. */
const DIMMED = 0.25;

/** A y-axis that ends on a round number, so the gridlines read as values rather than fractions. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const rawStep = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? magnitude * 10;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step / 2; v += step) ticks.push(v);
  return ticks;
}

const compact = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 || n % 1000 === 0 ? 0 : 1)}k` : String(n);

/** Share of that AID's dial-out total, the denominator every bar is drawn against. */
const shareOfInitiated = (value: number, initiated: number): string =>
  initiated > 0 ? `${((value / initiated) * 100).toFixed(1)}%` : '—';

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
  const palette = useInsightPalette();
  const { tooltip, show, hide } = useChartTooltip();

  // The cap is a ceiling over its group by construction (the backend scopes the
  // whole grid to dial-out rows), so the axis only has to clear the caps.
  const peak = Math.max(
    1,
    ...aids.map((a) =>
      Math.max(a.total_initiated, a.proceeded, a.alert, a.connected, a.ended),
    ),
  );
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
    <div className="relative" data-tooltip-root>
      <ChartTooltip state={tooltip} />
      <svg
        viewBox={`0 0 ${width} ${ROW_HEIGHT}`}
        className="w-full h-auto"
        role="img"
        onMouseLeave={hide}
        aria-label={`Blast breakdown by AID: ${aids
          .map((a) => `${a.label} ${a.total_initiated} initiated`)
          .join(', ')}`}
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
          const capTitle = `${aid.label} · Total Initiated`;

          return (
            <g key={aid.label}>
              {SERIES.map((series, slot) => {
                const value = aid[series.key];
                const barY = y(value);
                const height = PAD.top + plotH - barY;
                const title = `${aid.label} · ${series.label}`;
                // Everything except the hovered mark recedes, so the one being
                // read is the only thing at full strength.
                const faded = tooltip !== null && tooltip.title !== title;

                return (
                  <g key={series.key} opacity={faded ? DIMMED : 1}>
                    <rect
                      x={groupX + slot * barW + 1}
                      y={barY}
                      width={Math.max(barW - 2, 1)}
                      height={Math.max(height, value > 0 ? 1 : 0)}
                      rx={3}
                      fill={palette[series.tone]}
                      onMouseMove={(e) =>
                        show(e, {
                          title,
                          lines: [
                            {
                              label: 'Count',
                              value: value.toLocaleString(),
                              color: palette[series.tone],
                            },
                            { label: 'Share', value: shareOfInitiated(value, aid.total_initiated) },
                          ],
                        })
                      }
                    />
                    {value > 0 && (
                      <text
                        x={groupX + slot * barW + barW / 2}
                        y={barY - 4}
                        textAnchor="middle"
                        fontSize={9}
                        fontWeight={600}
                        fill={theme.axis}
                        pointerEvents="none"
                      >
                        {compact(value)}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* The dotted cap: this AID's total dial-out count, labelled. */}
              {aid.total_initiated > 0 && (
                <g opacity={tooltip !== null && tooltip.title !== capTitle ? DIMMED : 1}>
                  {/* A wider transparent line under the dashes gives the cap a
                      hit target you can actually land on — 1.5px of dashes is
                      not something a pointer can reliably find. */}
                  <line
                    x1={groupX - 2}
                    x2={groupX + barsW + 2}
                    y1={capY}
                    y2={capY}
                    stroke="transparent"
                    strokeWidth={12}
                    onMouseMove={(e) =>
                      show(e, {
                        title: capTitle,
                        lines: [
                          { label: 'Count', value: aid.total_initiated.toLocaleString() },
                          { label: 'Share', value: '100.0%' },
                        ],
                      })
                    }
                  />
                  <line
                    x1={groupX - 2}
                    x2={groupX + barsW + 2}
                    y1={capY}
                    y2={capY}
                    stroke={theme.axis}
                    strokeWidth={1.5}
                    strokeDasharray="5 4"
                    pointerEvents="none"
                  />
                  <text
                    x={groupX + barsW / 2}
                    y={capY - 6}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={700}
                    fill={theme.axis}
                    pointerEvents="none"
                  >
                    {aid.total_initiated.toLocaleString()}
                  </text>
                </g>
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
    </div>
  );
}

/** Shared legend — one per popup rather than repeated under every blast. */
export function BlastAidLegend() {
  const theme = useChartTheme();
  const palette = useInsightPalette();

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-600 dark:text-zinc-400">
      {SERIES.map((series) => (
        <span key={series.key} className="inline-flex items-center gap-1.5">
          <span
            className="w-3 h-3 rounded-sm shrink-0"
            style={{ backgroundColor: palette[series.tone] }}
          />
          {series.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <svg width="20" height="10" aria-hidden="true">
          <line
            x1="0"
            y1="5"
            x2="20"
            y2="5"
            stroke={theme.axis}
            strokeWidth="1.5"
            strokeDasharray="5 4"
          />
        </svg>
        Total initiated (dial-out)
      </span>
    </div>
  );
}

/**
 * The same numbers as a table.
 *
 * Offered beside the chart rather than instead of it: a colour-encoded grouped
 * bar chart needs a non-visual path to the same figures, and this is also the
 * quickest way to read exact counts across every AID at once.
 */
export function BlastAidTable({ aids }: { aids: InsightAid[] }) {
  const palette = useInsightPalette();

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-800/60">
            <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              AID
            </th>
            {SERIES.map((series) => (
              <th
                key={series.key}
                className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
              >
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-sm shrink-0"
                    style={{ backgroundColor: palette[series.tone] }}
                  />
                  {series.label}
                </span>
              </th>
            ))}
            <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Total initiated
            </th>
          </tr>
        </thead>
        <tbody>
          {aids.map((aid) => (
            <tr
              key={aid.label}
              className="border-b border-zinc-100 dark:border-zinc-800/40 last:border-0"
            >
              <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{aid.label}</td>
              {SERIES.map((series) => (
                <td
                  key={series.key}
                  className="px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400"
                >
                  {aid[series.key].toLocaleString()}
                </td>
              ))}
              <td className="px-3 py-2 text-right tabular-nums font-semibold text-zinc-900 dark:text-white">
                {aid.total_initiated.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
