import { useState } from 'react';
import type { MouseEvent } from 'react';

export interface TooltipLine {
  label: string;
  value: string;
  /** Swatch colour, when the line corresponds to a coloured mark. */
  color?: string;
}

export interface TooltipState {
  /** Position in pixels, relative to the hovering container's own box. */
  x: number;
  y: number;
  title: string;
  lines: TooltipLine[];
}

/**
 * Hover state plus the handler that positions it.
 *
 * Coordinates are taken from the event against the container's bounding box
 * rather than from the mark's own geometry, so this works the same for an SVG
 * mark (whose viewBox units are not pixels) as for a plain div.
 *
 * The container is found by walking up to the nearest `[data-tooltip-root]`,
 * which is the same element `ChartTooltip` positions itself inside.
 */
export function useChartTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const show = (event: MouseEvent<Element>, content: Omit<TooltipState, 'x' | 'y'>) => {
    const container = event.currentTarget.closest('[data-tooltip-root]');
    if (!container) return;
    const box = container.getBoundingClientRect();
    setTooltip({
      x: event.clientX - box.left,
      y: event.clientY - box.top,
      ...content,
    });
  };

  const hide = () => setTooltip(null);

  return { tooltip, show, hide };
}
