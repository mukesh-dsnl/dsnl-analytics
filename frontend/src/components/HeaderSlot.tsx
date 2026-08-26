import { createContext, useContext } from 'react';

/**
 * The element in the app header that pages may render into.
 *
 * The header lives in Layout, above the router outlet, but the filters that now
 * sit in it are per-page — each service offers a different field set. Rather
 * than hoisting that knowledge into Layout (which would have to know about
 * every route), Layout exposes the empty node and each page portals its own
 * controls in.
 *
 * Null until Layout's callback ref has run, which is one render; consumers
 * guard on it before portalling.
 */
export const HeaderSlotContext = createContext<HTMLElement | null>(null);

export function useHeaderSlot(): HTMLElement | null {
  return useContext(HeaderSlotContext);
}
