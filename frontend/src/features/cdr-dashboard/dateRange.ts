/**
 * Date-range helpers shared by the picker and the page that validates it.
 *
 * Dates are handled as plain ISO `YYYY-MM-DD` strings throughout — the backend
 * speaks them, the native date input speaks them, and comparing them
 * lexicographically is the same as comparing them chronologically. Parsing is
 * pinned to UTC so no local zone can shift a day across a boundary.
 */

/** Whole days between two ISO dates, inclusive of both ends. */
export function spanDays(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.floor(ms / 86_400_000) + 1;
}

/** Hold an ISO date inside the range the lake actually covers. */
export function clampDate(value: string, min?: string, max?: string): string {
  if (min && value < min) return min;
  if (max && value > max) return max;
  return value;
}
