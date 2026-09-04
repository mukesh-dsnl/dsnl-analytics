/**
 * Chart palette and mark specs for the CDR dashboard.
 *
 * Recharts paints SVG attributes, not CSS classes, so the colours have to be
 * resolved in JS rather than left to Tailwind's `dark:` variant — hence the
 * hook, which reads the same theme flag the rest of the app toggles on.
 *
 * The two categorical hues are the app's brand blue and a warm orange, and both
 * modes were validated (not eyeballed) against the surfaces these charts
 * actually render on — white in light mode, #0e1424 in dark:
 *
 *   light  #1b8fe0 / #eb6834  vs #ffffff — CVD dE 24.1, normal dE 32.4, >=3:1
 *   dark   #1b8fe0 / #d95926  vs #0e1424 — CVD dE 25.9, normal dE 31.9, >=3:1
 *
 * The dark surface moved from near-black #09090B to the navy #0e1424 when the
 * app's neutrals were re-hued; the *data* hues were re-checked against both
 * dark surfaces rather than re-picked, and every one still clears 3:1 (the
 * floor is green #008300 at 3.39:1 on the lighter of the two). So this palette
 * is unchanged — only the chrome below moved.
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
  /**
   * The full categorical ramp, in fixed slot order — a bar's hue comes from
   * its position here, never from a cycled or generated colour. Both modes
   * were validated (not eyeballed) against the surfaces these charts render
   * on, #ffffff light and #0e1424 dark:
   *
   *   light  worst adjacent CVD ΔE 9.1, normal-vision ΔE 19.6, lightness + chroma pass
   *   dark   worst adjacent CVD ΔE 8.4, normal-vision ΔE 19.3, all ≥3:1 contrast
   *
   * Three light-mode slots (aqua, yellow, magenta) sit below 3:1 against
   * white, so charts painting per-bar hues also print the value on each bar —
   * identity never rests on colour alone.
   */
  categorical: string[];
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
  categorical: [
    '#1b8fe0', // blue — the brand hue keeps slot 1
    '#eb6834', // orange
    '#1baf7a', // aqua
    '#eda100', // yellow
    '#e87ba4', // magenta
    '#008300', // green
    '#4a3aa7', // violet
    '#e34948', // red
  ],
  good: '#0ca30c',
  critical: '#d03b3b',
  // Chrome tracks the app's zinc neutrals so the plot sits in the same family
  // as the panel around it: zinc-200 gridlines, zinc-500 axis ink. Those
  // neutrals now carry the brand's indigo hue (see index.css), so these move
  // with them — a grey-green gridline on a blue-tinted panel is the tell that
  // a chart was themed separately from the page.
  grid: '#dde3ef',
  axis: '#6a7593',
  tooltipBg: '#ffffff',
  tooltipBorder: '#dde3ef',
  tooltipText: '#1a2138',
};

const DARK: ChartTheme = {
  isDark: true,
  series1: '#1b8fe0',
  series2: '#d95926',
  // The same eight hues, re-stepped for the dark surface — not a second palette.
  categorical: [
    '#1b8fe0', // blue
    '#d95926', // orange
    '#199e70', // aqua
    '#c98500', // yellow
    '#d55181', // magenta
    '#008300', // green
    '#9085e9', // violet
    '#e66767', // red
  ],
  good: '#0ca30c',
  critical: '#d03b3b',
  grid: '#29314a',
  axis: '#8f9ab6',
  tooltipBg: '#0e1424',
  tooltipBorder: '#29314a',
  tooltipText: '#edf1f8',
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

/** Whole counts with thousands separators. */
export const formatCount = (value: number): string =>
  Number.isFinite(value) ? Math.round(value).toLocaleString() : '—';
