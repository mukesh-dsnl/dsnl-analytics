import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
      className="vd-design fixed z-[80] w-[278px] rounded-[11px] border border-white/[0.08] bg-[#1f2b45f7] p-[18px] text-white shadow-[0_12px_35px_#15253d2d] backdrop-blur-md pointer-events-none"
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
}

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
  sections?: { title: string; rows: TipRow[]; base?: number }[];
}) {
  return (
    <>
      <div className="mb-1.5 text-[9px] uppercase tracking-[1px] text-[#8398b9]">{eyebrow}</div>
      <div className="mb-[3px] text-[13px] font-medium text-[#e5eaf6]">{title}</div>
      <div className="mb-[14px] flex items-baseline gap-[9px] text-[22px] font-medium tracking-[-0.5px] tabular-nums">
        {fmt(value)}
        {share && <small className="text-[10px] font-normal tracking-normal text-[#a2b1c9]">{share}</small>}
      </div>
      {sections
        .filter((s) => s.rows.length > 0)
        .map((section) => (
          <div key={section.title} className="mt-2.5 border-t border-white/[0.07] pt-2.5">
            <strong className="mb-[7px] block text-[9px] font-normal uppercase tracking-[0.7px] text-[#94a6c0]">
              {section.title}
            </strong>
            {section.rows.map((row) => (
              <div
                key={row.label}
                className="mt-[5px] flex items-center justify-between gap-[7px] text-[11px] text-[#c5cee0]"
              >
                <span className="truncate">{row.label}</span>
                <span className="shrink-0 tabular-nums text-[#e7eefa]">
                  {fmt(row.value)}
                  <small className="ml-[5px] text-[9px] text-[#8095b2]">
                    {row.share ?? pct(row.value, section.base ?? value)}
                  </small>
                </span>
              </div>
            ))}
          </div>
        ))}
    </>
  );
}
