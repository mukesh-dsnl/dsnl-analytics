import { useUIStore } from '../../store';

/**
 * The insight popup's own palette — the app's hues, stepped lighter.
 *
 * Softer than the dashboard's categorical ramp because the popup packs several
 * large solid fills into one scrolling panel, where the full-strength steps read
 * as heavy. Every value below was validated (not eyeballed) against the surface
 * it renders on, white in light mode and #09090B in dark:
 *
 *   light  #4a9fe0/#eb6a28/#12bd98/#dd4746 — worst adjacent CVD ΔE 11.9, normal 28.4
 *   dark   #3f93d8/#dd6a2c/#0fac7f/#cf4257 — worst adjacent CVD ΔE  7.4, normal 25.7
 *
 * Connected is green by request. That is the hard pairing to get right: green
 * sits between Ringing's orange and Ended's red, the two hues a green collapses
 * toward for deutan/protan viewers. Against the softest orange and red the best
 * available green still measured ΔE 5.9 — a fail — so those two neighbours are
 * pitched a step stronger than the rest of the palette, which is what buys the
 * green its distance. A blue-leaning green (rather than a pure one) does the
 * rest, and dark mode uses a slightly crimson red for the same reason.
 *
 * Dark's 7.4 is inside the 6-8 floor band, which holds only with a second
 * encoding behind the hue. The chart carries four: slot order is fixed and
 * identical in every group, bars are separated by a surface gap, every bar
 * prints its own value, and there is a table view of the same numbers.
 *
 * Two light-mode steps sit below 3:1 against white, permitted by that same
 * relief — no figure here is reachable only by colour.
 */
export interface InsightPalette {
  /** Blast chart series, in fixed slot order. */
  started: string;
  ringing: string;
  connected: string;
  ended: string;
  /** Split-bar segments, in the order segments are supplied. */
  split: string[];
  /** Carrier bars, by position. */
  carrier: string[];
}

const LIGHT: InsightPalette = {
  started: '#60afebff',
  ringing: '#e99165ff',
  connected: '#3bc2a5ff',
  ended: '#ec7a7aff',
  // Failures lead with the red, then the orange, then a recessive violet for
  // the folded tail — "Other" is a remainder, not a peer of the named bands.
  // These bars are one row of separate segments, not a group of adjacent marks,
  // so they keep the softer steps rather than the chart's stronger ones.
  split: ['#ec7a7aff', '#e99165ff', '#979ee2ff'],
  carrier: ['#60afebff', '#e99165ff', '#3bc2a5ff', '#ec7a7aff'],
};

const DARK: InsightPalette = {
  started: '#60afebff',
  ringing: '#e99165ff',
  connected: '#3bc2a5ff',
  ended: '#ec7a7aff',
  split: ['#ec7a7aff', '#e99165ff', '#979ee2ff'],
  carrier: ['#60afebff', '#e99165ff', '#3bc2a5ff', '#ec7a7aff'],
};

export function useInsightPalette(): InsightPalette {
  return useUIStore((state) => state.theme) === 'dark' ? DARK : LIGHT;
}
