import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PeakPortDatum } from '../api';
import { MARK, formatCount, useChartTheme } from '../chartTheme';
import { ChartTooltip } from './ChartTooltip';

interface PeakPortsChartProps {
  data: PeakPortDatum[];
  height: number;
}

/**
 * Peak concurrent ports per time bucket.
 *
 * One series, so no legend — the panel title names it. The fill is a flat
 * half-opacity wash of the series colour under a 2px line: solid rather than
 * fading, so the area under the curve reads with the same weight start to
 * end. Point markers appear only when the series is sparse enough that each
 * one is a real reading rather than pixel noise.
 */
export function PeakPortsChart({ data, height }: PeakPortsChartProps) {
  const theme = useChartTheme();
  const showDots = data.length <= 24;
  const tickStyle = { fill: theme.axis, fontSize: 11 };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid stroke={theme.grid} strokeWidth={1} vertical={false} />

        <XAxis
          dataKey="bucket"
          tick={tickStyle}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={tickStyle}
          tickLine={false}
          axisLine={false}
          width={48}
          allowDecimals={false}
          tickFormatter={formatCount}
        />

        <Tooltip
          cursor={{ stroke: theme.axis, strokeWidth: 1, strokeDasharray: '3 3' }}
          content={<ChartTooltip formatter={formatCount} />}
        />

        <Area
          type="monotone"
          dataKey="peak"
          name="Peak ports"
          stroke={theme.series1}
          strokeWidth={MARK.lineWidth}
          fill={theme.series1}
          fillOpacity={0.5}
          dot={showDots ? { r: MARK.dotRadius, fill: theme.series1, strokeWidth: 0 } : false}
          activeDot={{
            r: MARK.activeDotRadius,
            fill: theme.series1,
            // A surface-coloured ring so the active point stays legible where it
            // overlaps the fill.
            stroke: theme.tooltipBg,
            strokeWidth: 2,
          }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
