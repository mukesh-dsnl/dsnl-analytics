import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CategoryDatum } from '../api';
import { MARK, formatCount, useChartTheme } from '../chartTheme';
import { ChartTooltip } from './ChartTooltip';

interface CategoryBarChartProps {
  data: CategoryDatum[];
  /** Series name shown in the tooltip row. */
  valueName?: string;
  /**
   * `columns` for a handful of short labels; `bars` (horizontal) once labels
   * are long or numerous, where rotated x-ticks would be unreadable.
   */
  orientation?: 'columns' | 'bars';
  /** Per-category colour. Defaults to the single categorical hue for all bars. */
  colorFor?: (datum: CategoryDatum, index: number) => string;
  height: number;
}

const truncate = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

/**
 * A single measure across one dimension.
 *
 * One hue for every bar is deliberate: the category axis already carries
 * identity, so painting each bar differently would add colour that encodes
 * nothing. `colorFor` exists for the one chart where the split is a real
 * good/bad polarity and the status pair earns its place.
 */
export function CategoryBarChart({
  data,
  valueName = 'Calls',
  orientation = 'columns',
  colorFor,
  height,
}: CategoryBarChartProps) {
  const theme = useChartTheme();
  const fill = (datum: CategoryDatum, index: number) => colorFor?.(datum, index) ?? theme.series1;

  const tickStyle = { fill: theme.axis, fontSize: 11 };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout={orientation === 'bars' ? 'vertical' : 'horizontal'}
        margin={{ top: 8, right: 12, bottom: 4, left: 4 }}
        barCategoryGap={MARK.barCategoryGap}
      >
        <CartesianGrid
          stroke={theme.grid}
          strokeWidth={1}
          horizontal={orientation === 'columns'}
          vertical={orientation === 'bars'}
        />

        {orientation === 'bars' ? (
          <>
            <XAxis
              type="number"
              tick={tickStyle}
              tickLine={false}
              axisLine={false}
              tickFormatter={formatCount}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={130}
              tick={tickStyle}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value: string) => truncate(String(value), 18)}
            />
          </>
        ) : (
          <>
            <XAxis
              dataKey="label"
              tick={tickStyle}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value: string) => truncate(String(value), 14)}
            />
            <YAxis
              tick={tickStyle}
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={formatCount}
            />
          </>
        )}

        <Tooltip
          cursor={{ fill: theme.grid, fillOpacity: 0.4 }}
          content={<ChartTooltip formatter={formatCount} />}
        />

        <Bar
          dataKey="value"
          name={valueName}
          maxBarSize={MARK.maxBarWidth}
          radius={orientation === 'bars' ? [0, 4, 4, 0] : MARK.barRadius}
        >
          {data.map((datum, index) => (
            <Cell key={`${datum.label}-${index}`} fill={fill(datum, index)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
