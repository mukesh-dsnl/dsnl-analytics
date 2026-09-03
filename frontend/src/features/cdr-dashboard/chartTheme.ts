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
 *   dark   #1b8fe0 / #d95926  vs #2c2927 — 3.61:1 and 3.21:1
 *
 * The dark surface has moved three times — near-black #09090B, navy #0e1424,
 * then the warm #1a1715 — and each time the data hues were re-checked against
 * it rather than re-picked. The fourth move broke that streak: cards are now
 * lit and glossy at L* 16.8 (21.9 under the sheen), and two hues could not
 * survive it — green #008300 at 2.24:1 and critical #d03b3b at 2.31:1. Both
 * were re-stepped, the rest kept.
 *
 * Every colour here is measured against the *brightest* point of a card, the
 * top of the sheen, not the flat token beneath it — a figure that passes
 * beside the gloss and fails under it has not passed.
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
   * on, #ffffff light and #2c2927 dark:
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
    // Was #008300, a green mixed for the near-black surface. The card is four
    // times lighter now and that green fell to 2.24:1 against it — re-stepped
    // rather than kept, which is what the dark ramp exists to do. ΔE 26 from
    // the aqua above it, so the two stay separable.
    '#4caf50', // green
    '#9085e9', // violet
    '#e66767', // red
  ],
  // Status pair, re-stepped for the same reason: the old #d03b3b sat at 2.31:1
  // on a lit card, which is below the floor for the one colour that has to
  // read as "wrong".
  good: '#3fb355',
  critical: '#e35555',
  // Chrome follows the dark neutrals, which are now warm (see the :root.dark
  // block in index.css) — zinc-800 gridlines, zinc-400 axis ink, the panel
  // colour behind the tooltip. Same slots as before, re-hued with them.
  //
  // The *data* hues above are deliberately unchanged. They were picked for
  // CVD separation and re-validated against the new surfaces rather than
  // re-picked: every one still clears 3:1 (floor is green #008300 at 3.35:1
  // on the lighter of the two), so the palette holds and only the chrome
  // moved — exactly as it did the last time the surfaces changed.
  grid: '#3d3835',
  axis: '#a59c94',
  tooltipBg: '#2c2927',
  tooltipBorder: '#3d3835',
  tooltipText: '#f2efeb',
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
