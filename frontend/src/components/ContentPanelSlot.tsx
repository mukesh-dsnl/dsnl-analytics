import { createContext, useContext } from 'react';

/**
 * The floating content panel — the rounded card Layout insets into the brand
 * blue ground.
 *
 * Overlays that belong to a page (dialogs, popups) portal into this rather than
 * covering the whole viewport, so they centre inside the panel and stay clear
 * of the sidebar and the gutter around it. The panel is `relative`, so an
 * `absolute inset-0` child fills exactly the card, and the card's own
 * `overflow-hidden` clips the backdrop to its rounded corners.
 *
 * Null until Layout's callback ref has run, which is one render; consumers fall
 * back to a viewport-fixed overlay until then.
 */
export const ContentPanelContext = createContext<HTMLElement | null>(null);

export function useContentPanel(): HTMLElement | null {
  return useContext(ContentPanelContext);
}
