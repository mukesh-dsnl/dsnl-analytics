import { useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { exportReport } from '../lib/reportExport';
import type { ExportFormat, Report } from '../lib/reportExport';

const FORMATS: Record<'xlsx' | 'pdf', { label: string; hint: string; icon: typeof FileText }> = {
  xlsx: { label: 'Excel', hint: 'Every table, one sheet each (.xlsx)', icon: FileSpreadsheet },
  pdf: { label: 'PDF', hint: 'The report, to print or save as PDF', icon: FileText },
};

/**
 * The Export icon and its menu (Excel, PDF). `build` makes the report only
 * when a format is picked — from what the page shows at that moment, or, when
 * it has to fetch more first, asynchronously.
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
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async (format: 'xlsx' | 'pdf') => {
    setBusy(format);
    setProblem(null);
    try {
      await exportReport(build, format);
      setOpen(false);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The export failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={label}
          title={label}
          className={clsx(
            'inline-flex shrink-0 items-center justify-center transition-colors disabled:cursor-not-allowed disabled:opacity-40',
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
        align="end"
        sideOffset={6}
        className="w-[250px] border-[#e4eaf2] bg-white p-1.5 text-[#0f172a] shadow-[0_16px_40px_rgba(0,0,0,0.18)] dark:border-white/10 dark:bg-[#13213a] dark:text-zinc-100"
      >
        <p className="px-2.5 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#6a7d96] dark:text-zinc-400">{label}</p>
        {(['xlsx', 'pdf'] as const).map((id) => {
          const f = FORMATS[id];
          return (
            <button
              key={id}
              type="button"
              disabled={busy !== null}
              onClick={() => void run(id)}
              className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[#f3f7fc] disabled:cursor-wait disabled:opacity-60 dark:hover:bg-white/[0.06]"
            >
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#eef4fd] text-[#2563eb] dark:bg-sky-500/15 dark:text-sky-300">
                {busy === id ? <Loader2 className="h-4 w-4 animate-spin" /> : <f.icon className="h-4 w-4" />}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold">{f.label}</span>
                <span className="block text-[11.5px] text-[#6a7d96] dark:text-zinc-400">{busy === id ? 'Preparing…' : f.hint}</span>
              </span>
            </button>
          );
        })}
        {problem && (
          <p className="mt-1 flex items-start gap-1.5 px-2.5 pb-1.5 text-[11.5px] text-red-600 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {problem}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
