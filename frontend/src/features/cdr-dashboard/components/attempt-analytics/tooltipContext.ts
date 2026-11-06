import { createContext, useContext } from 'react';
import type { FocusEvent, MouseEvent, ReactNode } from 'react';

export type Show = (content: ReactNode, x: number, y: number) => void;

export const TooltipContext = createContext<{ show: Show; hide: () => void } | null>(null);

/** Props that make any element show `content` on hover and focus. */
export function useHover(content: () => ReactNode) {
  const context = useContext(TooltipContext);
  if (!context) throw new Error('useHover needs a HoverTooltipProvider.');
  const { show, hide } = context;
  return {
    tabIndex: 0,
    onMouseEnter: (e: MouseEvent) => show(content(), e.clientX, e.clientY),
    onMouseMove: (e: MouseEvent) => show(content(), e.clientX, e.clientY),
    onMouseLeave: hide,
    onFocus: (e: FocusEvent<HTMLElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      show(content(), rect.right, rect.top);
    },
    onBlur: hide,
  };
}

