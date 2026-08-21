import * as React from 'react';

import { cn } from '@/lib/utils';

const Field = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1.5', className)} {...props} />
  ),
);
Field.displayName = 'Field';

const FieldLabel = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        'text-xs font-medium text-zinc-500 dark:text-zinc-400 select-none',
        className,
      )}
      {...props}
    />
  ),
);
FieldLabel.displayName = 'FieldLabel';

export { Field, FieldLabel };
