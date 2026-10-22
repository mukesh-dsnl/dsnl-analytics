/**
 * The attempt-analytics redesign's palette and number formats, taken from the
 * design preview (D:\bin\DSNL_Attempt_Analytics_Design). Only the Voicedrop
 * charts use these for now.
 */

export const COLORS = {
  blue: '#50a6d5',
  navy: '#7289bf',
  green: '#39ad95',
  red: '#e99c8d',
  amber: '#dfb46f',
  violet: '#a3a0d8',
  pale: '#bcc9dc',
  line: '#4b9fcf',
};

/** Ranked lists (providers, reasons) fade from the lead colour down. */
export const PROVIDER_COLORS = [COLORS.blue, '#7fbce0', '#a5cde4', '#bedbeb', '#d7e6ee'];
export const DURATION_COLORS = [COLORS.blue, '#83bcdf', '#a6cfe6', '#c6deec'];
export const REASON_COLORS = [COLORS.blue, '#96adca', COLORS.violet, COLORS.amber, '#d9a6c0', COLORS.pale];
export const LOCATION_COLORS = [COLORS.blue, COLORS.violet, COLORS.navy, COLORS.amber, COLORS.pale];
export const BLAST_COLORS = [COLORS.blue, COLORS.violet, COLORS.navy, COLORS.amber, COLORS.pale];

export const colorAt = (palette: string[], index: number) => palette[Math.min(index, palette.length - 1)];

const nf = new Intl.NumberFormat('en-US');
export const fmt = (n: number) => nf.format(Math.round(n || 0));

/** A share as the design writes it: one decimal, and never a misleading 0% or 100%. */
export function pct(n: number, d: number): string {
  if (!d) return '0%';
  const p = (n / d) * 100;
  if (p > 0 && p < 0.1) return '<0.1%';
  if (p > 99.9 && p < 100) return '>99.9%';
  return `${Number(p.toFixed(1))}%`;
}

export function compact(n: number): string {
  if (n >= 1e6) return `${Number((n / 1e6).toFixed(1))}M`;
  if (n >= 1000) return `${Number((n / 1000).toFixed(1))}k`;
  return fmt(n);
}

/** A round axis ceiling a little above the largest value. */
export function niceCeiling(n: number): number {
  if (n <= 0) return 1;
  const base = 10 ** Math.floor(Math.log10(n));
  return ([1, 2, 2.5, 4, 5, 6, 8, 10, 20].find((v) => v * base >= n * 1.1) ?? 20) * base;
}
