import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { AlertTriangle, Check, Copy, Loader2, X } from 'lucide-react';

import { useContentPanel } from './ContentPanelSlot';
import { cleanName } from '../features/summary/format';

// Numbers line up without a monospace face: Inter's tabular digits.
export const MONO = 'tabular-nums';

const MIN_WIDTH = 380;
const DEFAULT_WIDTH = 460;

function savedWidth(key: string): number {
  try {
    const value = Number(localStorage.getItem(key));
    return value >= MIN_WIDTH ? value : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

/**
 * A details sheet sliding in from the right of the floating content panel
 * (and only that panel — it portals into it): an icon and a title, a line
 * under it, then the body. The page behind dims and closes the sheet on a
 * click, as does Escape. The left edge drags to widen it, remembered per
 * browser under `widthKey`. Shared by the Conference room and the Voicedrop
 * campaign details.
 */
export function DetailsDrawer({
  ariaLabel,
  title,
  subtitle,
  icon,
  iconTile,
  actions,
  widthKey,
  onClose,
  children,
}: {
  ariaLabel: string;
  title: ReactNode;
  subtitle: ReactNode;
  icon: ReactNode;
  /** The icon tile's colours. */
  iconTile: string;
  /** Buttons before Close (Print, Copy). */
  actions?: ReactNode;
  widthKey: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useContentPanel();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Drag the left edge: the sheet is anchored right, so moving left widens it.
  const [width, setWidth] = useState(() => savedWidth(widthKey));
  const drag = useRef<{ x: number; width: number } | null>(null);
  const maxWidth = () => Math.max(MIN_WIDTH, (panel?.clientWidth ?? window.innerWidth) - 120);
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, width };
  };
  const onDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setWidth(Math.round(Math.min(maxWidth(), Math.max(MIN_WIDTH, drag.current.width + drag.current.x - e.clientX))));
  };
  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    try {
      localStorage.setItem(widthKey, String(width));
    } catch {
      // Private mode: the width simply isn't remembered.
    }
  };

  const sheet = (
    <div className={clsx('inset-0 z-50', panel ? 'absolute' : 'fixed')} role="presentation">
      {/* The page behind dims; clicking it closes. */}
      <div className="drawer-fade absolute inset-0 bg-[#0f2340]/20 backdrop-blur-[1.5px]" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        style={{ width: Math.min(width, maxWidth()) }}
        className="drawer-in font-sans antialiased absolute inset-y-0 right-0 flex max-w-full flex-col border-l border-[#e3eaf3] bg-white text-[#35415a] shadow-[-24px_0_60px_rgba(15,35,64,0.16)] dark:border-white/[0.06] dark:bg-[#0e192c] dark:text-zinc-200"
      >
        {/* The resize handle, along the left edge. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Drag to resize"
          title="Drag to resize"
          onPointerDown={startDrag}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
          className="group absolute inset-y-0 -left-1.5 z-10 flex w-3 cursor-col-resize touch-none items-center justify-center"
        >
          <span className="h-full w-px bg-transparent transition-colors group-hover:bg-[#93b8f3] group-active:bg-[#2563eb]" />
          <span className="absolute h-10 w-1 rounded-full bg-[#c9d5e4] opacity-0 transition-opacity group-hover:opacity-100 dark:bg-white/20" />
        </div>
        <header className="shrink-0 border-b border-[#eef2f7] px-5 pt-5 pb-4 dark:border-white/[0.07]">
          <div className="flex items-start gap-3">
            <span className={clsx('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', iconTile)}>{icon}</span>
            <h2 className="min-w-0 flex-1 break-words pt-1 text-[17px] font-semibold leading-snug text-[#16213a] dark:text-white">
              {title}
            </h2>
            <div className="flex shrink-0 items-center gap-1.5">
              {actions}
              <IconButton label="Close" onClick={onClose}>
                <X className="h-4 w-4" />
              </IconButton>
            </div>
          </div>
          <p className={clsx(MONO, 'mt-2 text-[12.5px] text-[#6a7d96] dark:text-zinc-400')}>{subtitle}</p>
        </header>

        <div className="relative min-h-0 flex-1 overflow-y-auto bg-[#f7f9fc] px-5 py-4 [scrollbar-width:thin] dark:bg-transparent">
          {children}
        </div>
      </aside>
    </div>
  );
  return panel ? createPortal(sheet, panel) : sheet;
}

export function DrawerError({ what, message, onRetry }: { what: string; message: string; onRetry: () => void }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-[13px] text-red-700 dark:border-red-400/25 dark:bg-red-500/10 dark:text-red-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-medium">Couldn’t read {what}.</p>
        <p className="mt-0.5 break-words opacity-80">{message}</p>
        <button type="button" onClick={onRetry} className="mt-2 text-xs font-semibold underline">
          Retry
        </button>
      </div>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5 last:mb-1">
      <h3 className="mb-1.5 px-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#2f5a8c] dark:text-sky-300">{title}</h3>
      <div className="rounded-xl border border-[#e6ecf4] bg-white px-3.5 shadow-[0_1px_2px_#1c305408] dark:border-white/[0.06] dark:bg-white/[0.025]">{children}</div>
    </section>
  );
}

export function Row({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#eef2f7] py-2.5 last:border-0 dark:border-white/[0.05]">
      <span className="shrink-0 whitespace-nowrap text-[13px] font-semibold text-[#0f172a] dark:text-zinc-100">{label}</span>
      <span className={clsx('min-w-0 break-words text-right text-[13.5px] font-medium text-[#1d4ed8] dark:text-sky-300', mono && MONO)}>{children}</span>
    </div>
  );
}

export function IdName({ id, name }: { id: number; name: string | null }) {
  const label = cleanName(name, id);
  return (
    <span>
      <span className={clsx(MONO, 'font-bold text-[#1d4ed8] dark:text-sky-300')}>{id}</span>
      {label && (
        <>
          <span className="mx-1.5 text-[#93b0e0] dark:text-zinc-600">-</span>
          {label}
        </>
      )}
    </span>
  );
}

export const Dash = () => <span className="text-[#93b0e0] dark:text-zinc-600">—</span>;

export function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#e3eaf3] bg-white text-[#5b6a82] transition-colors hover:bg-[#f3f7fc] hover:text-[#16213a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#42b9e9]/60 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300 dark:hover:bg-white/[0.1] dark:hover:text-white"
    >
      {children}
    </button>
  );
}

/** Copies `text` (the details as plain text, for a mail or a ticket); ticks for a moment. */
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      label={copied ? 'Copied' : 'Copy details'}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-300" /> : <Copy className="h-4 w-4" />}
    </IconButton>
  );
}

/** The Port Analyzer's loading look: a sweeping bar and a Processing chip. */
export function DrawerLoading() {
  return (
    <div className="relative h-64 overflow-hidden rounded-xl border border-[#e6ecf4] bg-white dark:border-white/[0.06] dark:bg-white/[0.02]">
      <div className="absolute inset-x-0 top-0 h-1 overflow-hidden bg-[#e8f0fe] dark:bg-sky-500/10" role="progressbar" aria-label="Processing">
        <div className="progress-sweep h-full w-1/4 rounded-full bg-[#2563eb]" />
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex items-center gap-3 rounded-xl border border-[#e4eaf2] bg-white px-4 py-3 shadow-[0_10px_30px_rgba(15,23,42,0.12)] dark:border-white/[0.08] dark:bg-[#13213a]">
          <Loader2 className="h-5 w-5 animate-spin text-[#2563eb]" />
          <span className="text-[13px] font-semibold text-[#0f172a] dark:text-white">Processing…</span>
        </div>
      </div>
    </div>
  );
}

export const escapeHtml = (value: unknown) =>
  String(value ?? '—').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The print page's look, shared so every details sheet prints the same way. */
export const PRINT_STYLE = `
  body { font: 13px/1.5 Inter, 'Segoe UI', system-ui, sans-serif; font-variant-numeric: tabular-nums; color: #16213a; margin: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { font-size: 12px; color: #5b6a82; margin-bottom: 20px; }
  h2 { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #2f5a8c; margin: 18px 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  .kv th { width: 34%; text-align: left; font-weight: 600; font-size: 13px; color: #0f172a; padding: 6px 0; vertical-align: top; }
  .kv td { padding: 6px 0; border-bottom: 1px solid #eef2f7; color: #1d4ed8; font-weight: 500; }
  .kv tr:last-child td { border-bottom: 0; }
  .list th { text-align: left; font-size: 11px; color: #0f172a; border-bottom: 1px solid #cfe0f3; padding: 6px 8px 6px 0; }
  .list td { padding: 6px 8px 6px 0; border-bottom: 1px solid #eef2f7; color: #1d4ed8; }
  .id { color: #1d4ed8; }
  .mono { font-variant-numeric: tabular-nums; }
  .note { color: #6a7d96; }
  @page { margin: 14mm; }
`;

/** Opens `html` as a page of its own and the print dialog over it. */
export function printPage(html: string) {
  const win = window.open('', '_blank', 'width=820,height=900');
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  win.onafterprint = () => win.close();
  win.print();
}
