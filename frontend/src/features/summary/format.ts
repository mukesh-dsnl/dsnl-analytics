/** Dates, months and colour scales for the Summary page. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** "2026-10-26" as a local date, without the UTC shift `new Date(iso)` applies. */
export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isoDay(day: Date): string {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

export const addDays = (day: Date, n: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate() + n);

/** "26 Oct 2026". */
export function dayLabel(iso: string): string {
  const d = parseDay(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "26 Oct". */
export function shortDay(iso: string): string {
  const d = parseDay(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "Mon, 26 Oct 2026". */
export function weekdayDay(iso: string): string {
  const d = parseDay(iso);
  return `${WEEKDAYS[(d.getDay() + 6) % 7].slice(0, 3)}, ${dayLabel(iso)}`;
}

/** "2026-10" → "Oct 2026"; with `short`, "Oct". */
export function monthLabel(month: string, short = false): string {
  const [y, m] = month.split('-').map(Number);
  return short ? MONTHS[m - 1] : `${MONTHS[m - 1]} ${y}`;
}

/** "1–26 Oct" for a span inside one month. */
export function spanLabel(from: string, to: string): string {
  const a = parseDay(from);
  const b = parseDay(to);
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()}–${b.getDate()} ${MONTHS[b.getMonth()]}`
    : `${shortDay(from)} – ${shortDay(to)}`;
}

export function daysAgo(n: number): string {
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  return `${n} days ago`;
}

export const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** The intensity ramp for both heatmaps: pale to deep brand blue. */
export const RAMP = ['#d4e9f6', '#a3d0ec', '#68b0dd', '#3790cb', '#1d6aa6'];

/**
 * Which of the five ramp steps each value falls in, by quintile of the
 * non-zero values — so one record day doesn't wash every other day out to the
 * palest step, as a linear scale would.
 */
export function levels(values: number[]): (value: number) => number {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (!sorted.length) return () => -1;
  const cut = [0.2, 0.4, 0.6, 0.8].map((q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]);
  return (value) => {
    if (value <= 0) return -1;
    const step = cut.findIndex((c) => value <= c);
    return step === -1 ? 4 : step;
  };
}

/**
 * The account master list often ends a name with the account's own id
 * ("Reliance Foundation - VMS - 109446"). The id is shown beside the name
 * already, so the repeat is dropped — only when it is the whole last word.
 */
export function cleanName(name: string | null | undefined, id: number): string | null {
  if (!name) return null;
  const trimmed = name.replace(new RegExp(`(?:^|[\\s\\-–—:(]+)${id}\\)?\\s*$`), '').trim();
  return trimmed || name;
}
