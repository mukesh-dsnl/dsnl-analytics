import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { fmt, pct } from './design';
import { TooltipContext } from './tooltipContext';
import type { Show } from './tooltipContext';

interface TooltipState {
  content: ReactNode;
  x: number;
  y: number;
}


/**
 * The redesign's hover readout: one dark card that follows the cursor, shared
 * by every chart in the section. Hover (or focus) shows it; there is no click
 * action and no side panel.
 */
export function HoverTooltipProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<TooltipState | null>(null);
  const show = useCallback<Show>((content, x, y) => setTip({ content, x, y }), []);
  const hide = useCallback(() => setTip(null), []);

  // A tooltip pinned to where the pointer was is wrong once the page moves.
  useEffect(() => {
    window.addEventListener('scroll', hide, { passive: true, capture: true });
    return () => window.removeEventListener('scroll', hide, { capture: true });
  }, [hide]);

  return (
    <TooltipContext.Provider value={{ show, hide }}>
      {children}
      {tip && createPortal(<FloatingTooltip {...tip} />, document.body)}
    </TooltipContext.Provider>
  );
}

function FloatingTooltip({ content, x, y }: TooltipState) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x + 18, top: y + 16 });

  // Kept inside the window: flipped left/up when the card would overflow.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const left = Math.max(10, Math.min(x + 18, window.innerWidth - node.offsetWidth - 12));
    const top = Math.max(10, Math.min(y + 16, window.innerHeight - node.offsetHeight - 12));
    setPosition({ left, top });
  }, [x, y, content]);

  return (
    <div
      ref={ref}
      role="tooltip"
      className="vd-design fixed z-[80] w-max min-w-[220px] max-w-[400px] rounded-[10px] border border-white/[0.08] bg-[#1f2b45f7] px-3.5 py-3 text-white shadow-[0_12px_35px_#15253d2d] backdrop-blur-md pointer-events-none"
      style={{ ...position, animation: 'vd-tooltip-in .13s ease-out' }}
    >
      {content}
    </div>
  );
}

// ── The readout's parts, as the design lays them out ──────────────────────

export interface TipRow {
  label: string;
  value: number;
  /** The share to print, when the caller has the exact figure; otherwise worked out here. */
  share?: string;
  /** Rows under this one — their shares are of this row's value. */
  children?: TipRow[];
}

export interface TipSection {
  title: string;
  rows: TipRow[];
  /** What each row's percentage is of; defaults to the readout's own figure. */
  base?: number;
}

/**
 * The readout's content: what was hovered, its figure, then every breakdown —
 * all of it, nothing trimmed. Kept compact rather than short: the title and
 * figure share a line, and two or more sections sit side by side.
 */
export function TipBody({
  eyebrow,
  title,
  value,
  share,
  sections = [],
}: {
  eyebrow: string;
  title: string;
  value: number;
  /** "41.2% of attempts" — shown beside the figure. */
  share?: string;
  sections?: TipSection[];
}) {
  const shown = sections.filter((s) => s.rows.length > 0);
  return (
    <>
      <div className="text-[9px] uppercase tracking-[1px] text-[#8398b9]">{eyebrow}</div>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[12px] font-medium text-[#e5eaf6]" title={title}>
          {title}
        </span>
        <span className="shrink-0 text-[17px] font-medium tracking-[-0.3px] tabular-nums">{fmt(value)}</span>
      </div>
      {share && <div className="mt-0.5 text-right text-[10px] text-[#a2b1c9]">{share}</div>}
      {shown.length > 0 && (
        <div className={clsx('mt-2 grid gap-x-5', shown.length > 1 && 'grid-cols-2')}>
          {shown.map((section) => (
            <div key={section.title} className="mt-1 min-w-0 border-t border-white/[0.07] pt-2">
              <strong className="mb-1 block text-[9px] font-normal uppercase tracking-[0.7px] text-[#94a6c0]">
                {section.title}
              </strong>
              {section.rows.map((row) => (
                <TipLine key={row.label} row={row} base={section.base ?? value} />
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function TipLine({ row, base, nested }: { row: TipRow; base: number; nested?: boolean }) {
  return (
    <>
      <div
        className={clsx(
          'mt-[3px] flex items-center justify-between gap-2.5',
          nested ? 'text-[10px] text-[#a9b6cc]' : 'text-[11px] text-[#c5cee0]',
        )}
      >
        <span className="min-w-0 truncate" title={row.label}>
          {row.label}
        </span>
        <span className="shrink-0 tabular-nums text-[#e7eefa]">
          {fmt(row.value)}
          <small className="ml-1 text-[9px] text-[#8095b2]">{row.share ?? pct(row.value, base)}</small>
        </span>
      </div>
      {row.children && row.children.length > 0 && (
        <div className="ml-1 border-l border-white/10 pl-2">
          {row.children.map((child) => (
            <TipLine key={child.label} row={child} base={row.value} nested />
          ))}
        </div>
      )}
    </>
  );
}
