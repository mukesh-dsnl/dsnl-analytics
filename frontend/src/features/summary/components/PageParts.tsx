import type { ReactNode } from 'react';
import { AlertTriangle, Download } from 'lucide-react';

/** The small pieces both summary pages (Voicedrop, Conference) are laid out with. */

export function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[50vh] items-center justify-center text-sm text-zinc-500">{children}</div>;
}

export function Problem({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto flex max-w-3xl items-start gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-900/20 dark:text-red-400">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 break-words">{message}</p>
        <button onClick={onRetry} className="mt-2 text-xs font-semibold underline">
          Retry
        </button>
      </div>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mx-px mb-[13px] text-[13px] font-medium text-[#576980] dark:text-zinc-300">{children}</h2>;
}

export function DownloadButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      <Download className="h-3.5 w-3.5" />
      CSV
    </button>
  );
}
