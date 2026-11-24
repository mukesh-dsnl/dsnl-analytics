import { useCallback, useEffect, useRef } from 'react';

/** How long a click waits, so a second click can turn it into a double-click. */
const DOUBLE_CLICK_MS = 250;

const hasSelection = () => (window.getSelection()?.toString().trim() ?? '') !== '';

/**
 * A row click that opens something, without getting in the way of copying.
 *
 * Selecting text in a row ends with a mouse release, which the browser counts
 * as a click, so a plain onClick opened the details whenever someone tried to
 * copy a number from the table. Here:
 * - a click that leaves text selected (a drag across a value) opens nothing;
 * - a click waits a moment before opening, and a second click within that
 *   moment (a double-click, which selects a word) cancels it.
 *
 * Returns `(event, open)`: call it from the row's onClick. One timer is shared
 * by every row of a table, so a quick click on another row replaces the first.
 */
export function useClickToOpen() {
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return useCallback((event: { detail: number }, open: () => void) => {
    window.clearTimeout(timer.current);
    // The second (or third) click of a double-click is selecting a word.
    if (event.detail > 1) return;
    if (hasSelection()) return;
    timer.current = window.setTimeout(() => {
      if (!hasSelection()) open();
    }, DOUBLE_CLICK_MS);
  }, []);
}
