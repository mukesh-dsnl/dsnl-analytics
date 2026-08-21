import * as React from 'react';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * shadcn/ui Button, restyled onto this app's own tokens.
 *
 * The stock shadcn variants reference its CSS-variable theme (bg-primary,
 * bg-muted, …), which this project doesn't define — the palette lives in
 * index.css's @theme block as the zinc/blue ramp every other component already
 * uses. So the variants below are written against those directly, keeping the
 * button visually identical to the existing controls it sits beside.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-0 ' +
    'disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-blue-600 text-white hover:bg-blue-500 shadow-sm',
        outline:
          'border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#09090B] text-zinc-900 dark:text-white ' +
          'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
        ghost:
          'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 hover:text-zinc-900 dark:hover:text-zinc-200',
        // For controls sitting on the brand band, where a white-surfaced
        // outline button would punch a hole in the blue.
        brand:
          'border border-white/25 bg-white/15 text-white hover:bg-white/25 focus-visible:ring-white/60',
      },
      size: {
        default: 'h-[46px] px-4 py-2',
        sm: 'h-9 px-3',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
  ),
);
Button.displayName = 'Button';

export { Button };
