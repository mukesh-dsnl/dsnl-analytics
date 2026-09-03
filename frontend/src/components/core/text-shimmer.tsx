import type { CSSProperties, ElementType } from 'react';
import clsx from 'clsx';

/**
 * Text with a highlight travelling through it — "this is happening now".
 *
 * The motion-primitives component of the same name, with the same props, but
 * driven by a CSS animation instead of `motion/react`. That library is not a
 * dependency of this project and pulling in an animation runtime for one
 * shimmer would cost more than the effect is worth; the moving part here is a
 * background position, which CSS animates on the compositor for free.
 *
 * How it works: the text is painted transparent and clipped out of two stacked
 * backgrounds — a flat base colour, and a narrow bright band that slides across
 * it. Nothing about the text itself moves, so it never reflows and stays
 * selectable.
 *
 * `spread` is multiplied by the text's length, as upstream does, so the band
 * stays proportional to the phrase: a fixed width would crawl across a long
 * line and flash across a short one.
 */
interface TextShimmerProps {
  /** A string, not nodes: its length sets the width of the travelling band. */
  children: string;
  as?: ElementType;
  className?: string;
  /** Seconds for one pass. */
  duration?: number;
  /** Band width per character. */
  spread?: number;
}

export function TextShimmer({
  children,
  as: Component = 'span',
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) {
  return (
    <Component
      className={clsx('text-shimmer', className)}
      style={
        {
          '--shimmer-spread': `${children.length * spread}px`,
          '--shimmer-duration': `${duration}s`,
        } as CSSProperties
      }
    >
      {children}
    </Component>
  );
}
