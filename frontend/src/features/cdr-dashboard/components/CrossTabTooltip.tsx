import { useChartTheme } from '../chartTheme';
import type { CallCubeRow } from '../api';
import { cubeDimensionValue } from '../cubeDimensions';
import type { CubeDimension } from '../cubeDimensions';

const DIMENSION_LABEL: Record<CubeDimension, string> = {
  location: 'Location',
  connection: 'Connection',
  direction: 'Call Direction',
  provider: 'Service Provider',
};

const ALL_DIMENSIONS: CubeDimension[] = ['location', 'connection', 'direction', 'provider'];

function breakdown(rows: CallCubeRow[], dimension: CubeDimension) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = cubeDimensionValue(row, dimension);
    totals.set(key, (totals.get(key) ?? 0) + row.count);
  }
  return Array.from(totals, ([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

interface CrossTabTooltipProps {
  dimension: CubeDimension;
  value: string;
  cubeRows: CallCubeRow[];
}

const MAX_ROWS_SHOWN = 5;

/**
 * Hover readout for the Blast Details bar charts.
 *
 * Every other chart here answers "how many calls in this bar" and stops
 * there. This one answers "and how does *that* split by everything else" —
 * hover "Dial In" and see its connected ratio, which locations carried it,
 * which providers it ran through — computed from the shared cube rather than
 * a request per hover.
 */
export function CrossTabTooltip({ dimension, value, cubeRows }: CrossTabTooltipProps) {
  const theme = useChartTheme();
  const matching = cubeRows.filter((row) => cubeDimensionValue(row, dimension) === value);
  const total = matching.reduce((sum, row) => sum + row.count, 0);
  const otherDimensions = ALL_DIMENSIONS.filter((d) => d !== dimension);

  return (
    <div
      className="rounded-lg border px-3 py-2.5 shadow-lg text-xs max-w-[260px]"
      style={{ background: theme.tooltipBg, borderColor: theme.tooltipBorder, color: theme.tooltipText }}
    >
      <p className="font-semibold mb-0.5 break-words">{value}</p>
      <p className="opacity-70 mb-2 tabular-nums">{total.toLocaleString()} calls</p>

      {otherDimensions.map((dim) => {
        const rows = breakdown(matching, dim);
        const shown = rows.slice(0, MAX_ROWS_SHOWN);
        const restCount = rows.slice(MAX_ROWS_SHOWN).reduce((sum, r) => sum + r.count, 0);
        return (
          <div key={dim} className="mt-2 pt-2 border-t" style={{ borderColor: theme.tooltipBorder }}>
            <p className="opacity-60 font-medium mb-1 uppercase tracking-wide text-[10px]">
              {DIMENSION_LABEL[dim]}
            </p>
            {shown.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3 tabular-nums">
                <span className="opacity-80 truncate">
                  {dim === 'provider' ? `Provider ${row.label}` : row.label}
                </span>
                <span className="font-semibold shrink-0">
                  {row.count.toLocaleString()} ({total ? Math.round((row.count / total) * 100) : 0}%)
                </span>
              </div>
            ))}
            {restCount > 0 && (
              <div className="flex items-center justify-between gap-3 opacity-60 tabular-nums">
                <span>+{rows.length - MAX_ROWS_SHOWN} more</span>
                <span>{restCount.toLocaleString()}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
