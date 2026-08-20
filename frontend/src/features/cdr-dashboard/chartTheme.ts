/**
 * Chart palette and mark specs for the CDR dashboard.
 *
 * Recharts paints SVG attributes, not CSS classes, so the colours have to be
 * resolved in JS rather than left to Tailwind's `dark:` variant — hence the
 * hook, which reads the same theme flag the rest of the app toggles on.
 *
 * The two categorical hues are the app's brand blue and a warm orange, and both
 * modes were validated (not eyeballed) against the surfaces these charts
 * actually render on — white in light mode, #09090B in dark:
 *
 *   light  #1b8fe0 / #eb6834  vs #ffffff — CVD dE 24.1, normal dE 32.4, >=3:1
 *   dark   #1b8fe0 / #d95926  vs #09090B — CVD dE 25.9, normal dE 31.9, >=3:1
 *
 * Most charts here are a single measure across one dimension, so they use
 * `series1` alone and let the axis carry identity — a hue per bar would be
 * colour without a job. Connected vs Not Connected is the exception that earns
 * two colours, and it uses the reserved status pair rather than the categorical
 * slots because the split is genuinely good/bad, not merely two categories.
 */

import { useUIStore } from '../../store';

export interface ChartTheme {
  isDark: boolean;
  /** Categorical slot 1 — the default for any single-series chart. */
  series1: string;
  /** Categorical slot 2 — only for a genuine second series. */
  series2: string;
  /** Reserved status colours. Never reused as "another series". */
  good: string;
  critical: string;
  grid: string;
  axis: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
}

const LIGHT: ChartTheme = {
  isDark: false,
  series1: '#1b8fe0',
  series2: '#eb6834',
  good: '#0ca30c',
  critical: '#d03b3b',
  // Chrome tracks the app's zinc neutrals so the plot sits in the same family
  // as the panel around it: zinc-200 gridlines, zinc-500 axis ink.
  grid: '#e4e4e7',
  axis: '#71717a',
  tooltipBg: '#ffffff',
  tooltipBorder: '#e4e4e7',
  tooltipText: '#18181b',
};

const DARK: ChartTheme = {
  isDark: true,
  series1: '#1b8fe0',
  series2: '#d95926',
  good: '#0ca30c',
  critical: '#d03b3b',
  grid: '#27272a',
  axis: '#a1a1aa',
  tooltipBg: '#09090B',
  tooltipBorder: '#27272a',
  tooltipText: '#f4f4f5',
};

export function useChartTheme(): ChartTheme {
  return useUIStore((state) => state.theme) === 'dark' ? DARK : LIGHT;
}

/** Shared mark specs: thin marks, rounded data-ends, recessive chrome. */
export const MARK = {
  /** Rounded top corners only — the baseline end stays square where it meets the axis. */
  barRadius: [4, 4, 0, 0] as [number, number, number, number],
  /** A surface-coloured sliver between adjacent bars instead of a hairline stroke. */
  barGap: 2,
  barCategoryGap: '28%',
  maxBarWidth: 56,
  lineWidth: 2,
  dotRadius: 4,
  activeDotRadius: 5,
} as const;

/** Whole counts with thousands separators; minutes keep one decimal. */
export const formatCount = (value: number): string =>
  Number.isFinite(value) ? Math.round(value).toLocaleString() : '—';

export const formatMinutes = (value: number): string =>
  Number.isFinite(value)
    ? value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : '—';
