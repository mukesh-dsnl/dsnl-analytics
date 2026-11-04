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

export interface Tone {
  card: string;
  tile: string;
  bar: string;
  /** The dark-mode gradient edge, start and end. */
  edge: [string, string];
}

// Each card's tint, icon tile and bar — the light values from the mockup,
// with dark equivalents.
export const TONES: Record<'blue' | 'violet' | 'sky' | 'teal' | 'orange', Tone> = {
  blue: {
    card: 'border-[#cfe1f6] from-white to-[#f1f7fe] dark:border-sky-500/25 dark:from-[#0d1729] dark:to-sky-500/[0.06]',
    tile: 'bg-[#e6f1fd] text-[#3a86d8] dark:bg-sky-500/15 dark:text-sky-300',
    bar: 'bg-[#3a86d8]',
    edge: ['rgba(59,130,246,0.45)', 'rgba(34,211,238,0.28)'],
  },
  violet: {
    card: 'border-[#e2d7f6] from-white to-[#faf4fd] dark:border-violet-500/25 dark:from-[#0d1729] dark:to-violet-500/[0.06]',
    tile: 'bg-[#f1eafd] text-[#8b6fd8] dark:bg-violet-500/15 dark:text-violet-300',
    bar: 'bg-gradient-to-r from-[#8b6fd8] to-[#e35d92]',
    edge: ['rgba(139,92,246,0.45)', 'rgba(236,72,153,0.32)'],
  },
  sky: {
    card: 'border-[#c8e4f4] from-white to-[#eff8fd] dark:border-cyan-500/25 dark:from-[#0d1729] dark:to-cyan-500/[0.06]',
    tile: 'bg-[#e0f2fb] text-[#1f93c4] dark:bg-cyan-500/15 dark:text-cyan-300',
    bar: 'bg-[#29a3d6]',
    edge: ['rgba(14,165,233,0.45)', 'rgba(99,102,241,0.28)'],
  },
  teal: {
    card: 'border-[#c9ece2] from-white to-[#f0fbf7] dark:border-emerald-500/25 dark:from-[#0d1729] dark:to-emerald-500/[0.06]',
    tile: 'bg-[#e2f6ef] text-[#25a883] dark:bg-emerald-500/15 dark:text-emerald-300',
    bar: 'bg-[#2fb58f]',
    edge: ['rgba(16,185,129,0.45)', 'rgba(34,211,238,0.28)'],
  },
  orange: {
    card: 'border-[#f6dcc4] from-white to-[#fff6ee] dark:border-orange-500/25 dark:from-[#0d1729] dark:to-orange-500/[0.06]',
    tile: 'bg-[#fdeedd] text-[#e07d2c] dark:bg-orange-500/15 dark:text-orange-300',
    bar: 'bg-[#ee8a3c]',
    edge: ['rgba(249,115,22,0.45)', 'rgba(234,179,8,0.28)'],
  },
};
