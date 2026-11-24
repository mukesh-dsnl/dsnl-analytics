import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { exportReport } from '../lib/reportExport';
import type { Report } from '../lib/reportExport';

const FORMATS = [
  { id: 'xlsx', label: 'Excel', icon: FileSpreadsheet },
  { id: 'pdf', label: 'PDF', icon: FileText },
] as const;

/**
 * The Export icon and its two-line menu: Excel, PDF. Picking one closes the
 * menu at once and the icon spins while the file is made; only a failure opens
 * the menu again, to say what went wrong. A click anywhere else, or Escape,
 * closes it.
 *
 * `build` makes the report only when a format is picked — from what the page
 * shows at that moment, or asynchronously when it has to fetch more first.
 *
 * `variant`: "header" is a bare icon, styled like the theme toggle beside it in
 * the app header; "boxed" is a bordered square, for beside other boxed buttons
 * (the chart popup's Close); "inline" is a small boxed icon for inside a card.
 */
export function ExportMenu({
  build,
  disabled,
  variant = 'header',
  label = 'Export',
}: {
  build: () => Report | Promise<Report>;
  disabled?: boolean;
  variant?: 'header' | 'boxed' | 'inline';
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // A press anywhere outside the icon and the menu closes it. The popover
  // library does this itself on a page, but inside the chart popup (a custom
  // modal) it lets such presses through and the menu stayed open.
  useEffect(() => {
    if (!open) return;
    const onPress = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && (triggerRef.current?.contains(target) || menuRef.current?.contains(target))) return;
      setOpen(false);
      setProblem(null);
    };
    document.addEventListener('pointerdown', onPress, true);
    return () => document.removeEventListener('pointerdown', onPress, true);
  }, [open]);

  const run = async (format: 'xlsx' | 'pdf') => {
    setOpen(false);
    setBusy(true);
    setProblem(null);
    try {
      await exportReport(build, format);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The export failed.');
      setOpen(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setProblem(null);
      }}
    >
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled || busy}
          aria-label={label}
          title={busy ? 'Preparing the file…' : label}
          className={clsx(
            'inline-flex shrink-0 items-center justify-center transition-colors disabled:cursor-not-allowed disabled:opacity-40',
            busy && 'disabled:cursor-wait disabled:opacity-100',
            variant === 'header'
              ? // The theme toggle's own look: the icon alone, no box.
                'rounded-md p-1 text-[#45556e] hover:text-[#1d4ed8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#93b8f3] dark:text-white dark:hover:text-sky-300'
              : variant === 'boxed'
                ? 'h-10 w-10 rounded-lg border border-zinc-200 bg-white text-[#45556e] shadow-sm hover:text-[#1d4ed8] hover:bg-zinc-50 dark:border-zinc-800 dark:bg-surface-dark dark:text-zinc-200 dark:hover:bg-zinc-800/60 dark:hover:text-sky-300'
                : 'h-8 w-8 rounded-lg border border-[#e3eaf3] bg-white text-[#5b6a82] hover:bg-[#f3f7fc] hover:text-[#16213a] dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300 dark:hover:bg-white/[0.1] dark:hover:text-white',
            open && (variant === 'header' ? 'text-[#1d4ed8] dark:text-sky-300' : 'ring-2 ring-sky-300'),
          )}
        >
          {busy ? (
            <Loader2 className={clsx('animate-spin', variant === 'header' ? 'h-5 w-5' : 'h-4 w-4')} />
          ) : (
            <Download className={variant === 'header' ? 'h-5 w-5' : 'h-[18px] w-[18px]'} />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={menuRef}
        align="end"
        sideOffset={6}
        // Escape closes this menu only, not a popup it sits in.
        onEscapeKeyDown={(e) => e.stopPropagation()}
        className={clsx(
          'border-[#e4eaf2] bg-white p-1 text-[#0f172a] shadow-[0_12px_32px_rgba(0,0,0,0.16)] dark:border-white/10 dark:bg-[#13213a] dark:text-zinc-100',
          problem ? 'w-[240px]' : 'w-[140px]',
        )}
      >
        {FORMATS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => void run(f.id)}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-medium transition-colors hover:bg-[#f3f7fc] dark:hover:bg-white/[0.06]"
          >
            <f.icon className="h-4 w-4 shrink-0 text-[#2563eb] dark:text-sky-300" />
            {f.label}
          </button>
        ))}
        {problem && (
          <p className="mt-1 flex items-start gap-1.5 border-t border-[#eef2f7] px-2.5 pt-2 pb-1.5 text-[11.5px] text-red-600 dark:border-white/10 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {problem}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
