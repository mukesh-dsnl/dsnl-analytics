import { useChartTheme } from '../chartTheme';

interface TooltipEntry {
  name?: string | number;
  value?: number | string;
  color?: string;
}

interface ChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: TooltipEntry[];
  /** Formats the numeric value — counts, minutes and ports all read differently. */
  formatter?: (value: number) => string;
}

/**
 * Hover readout for every chart here.
 *
 * A chart in the browser is interactive by default, so this ships on all of
 * them rather than being opt-in. The swatch repeats the mark's colour so the
 * row is identifiable, while the text itself stays in ink.
 */
export function ChartTooltip({ active, label, payload, formatter }: ChartTooltipProps) {
  const theme = useChartTheme();

  if (!active || !payload || payload.length === 0) return null;

  return (
    <div
      className="rounded-lg border px-3 py-2 shadow-lg text-xs"
      style={{
        background: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
        color: theme.tooltipText,
      }}
    >
      <p className="font-semibold mb-1 max-w-[220px] break-words">{label}</p>
      {payload.map((entry, index) => {
        const numeric = typeof entry.value === 'number' ? entry.value : Number(entry.value);
        return (
          <div key={index} className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ background: entry.color ?? theme.series1 }}
            />
            <span className="opacity-70">{entry.name}</span>
            <span className="font-semibold ml-auto tabular-nums">
              {formatter && Number.isFinite(numeric) ? formatter(numeric) : String(entry.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
