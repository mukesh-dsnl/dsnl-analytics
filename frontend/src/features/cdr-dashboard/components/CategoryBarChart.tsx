import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
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
  /** Per-category colour. Overrides `multicolor` — used where the split carries real polarity. */
  colorFor?: (datum: CategoryDatum, index: number) => string;
  /**
   * Paint each bar its own categorical hue, assigned by slot order.
   *
   * Ignored past 8 categories: the ramp has eight slots and a 9th hue is
   * never generated or cycled — beyond that the axis alone carries identity,
   * so the chart falls back to the single series hue.
   */
  multicolor?: boolean;
  height: number;
  /** Prints each bar's own value above (columns) or beside (bars) it, not just on hover. */
  showValueLabels?: boolean;
  /** Replaces the default hover readout — for a bar that has more to say than its own total. */
  tooltipContent?: (datum: CategoryDatum) => ReactNode;
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
  multicolor = false,
  height,
  showValueLabels = false,
  tooltipContent,
}: CategoryBarChartProps) {
  const theme = useChartTheme();
  const useSlots = multicolor && data.length <= theme.categorical.length;
  const fill = (datum: CategoryDatum, index: number) =>
    colorFor?.(datum, index) ?? (useSlots ? theme.categorical[index] : theme.series1);

  const tickStyle = { fill: theme.axis, fontSize: 11 };
  const labelStyle = { fill: theme.axis, fontSize: 11, fontWeight: 600 };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout={orientation === 'bars' ? 'vertical' : 'horizontal'}
        margin={{ top: showValueLabels ? 20 : 8, right: orientation === 'bars' ? 40 : 12, bottom: 4, left: 4 }}
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
          content={
            tooltipContent
              ? ({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  return tooltipContent(payload[0].payload as CategoryDatum);
                }
              : <ChartTooltip formatter={formatCount} />
          }
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
          {showValueLabels && (
            <LabelList
              dataKey="value"
              position={orientation === 'bars' ? 'right' : 'top'}
              formatter={(value: unknown) => formatCount(Number(value))}
              style={labelStyle}
            />
          )}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
