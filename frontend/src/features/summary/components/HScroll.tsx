import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import clsx from 'clsx';

/**
 * A horizontal strip the wheel moves sideways: with the pointer inside it,
 * an ordinary mouse wheel (or a two-finger vertical swipe) slides the content
 * left and right, and a sideways trackpad swipe does what it always does.
 *
 * The wheel only takes over while there is somewhere to go — at either end it
 * hands the scroll back to the page, so a chart never traps the reader. The
 * motion eases towards where the wheel is aiming rather than jumping a notch
 * at a time, which is what keeps a clicky mouse wheel smooth.
 *
 * `startAtEnd` opens it on its right edge — the latest days — and keeps it
 * there when more content arrives, until the reader scrolls away.
 */
export function HScroll({
  children,
  startAtEnd = false,
  className,
}: {
  children: ReactNode;
  startAtEnd?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const target = useRef(0);
  const frame = useRef(0);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = () => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 });
  };

  // Open on the latest end, and stay pinned there while the content grows.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (startAtEnd) el.scrollLeft = el.scrollWidth;
    target.current = el.scrollLeft;
    measure();
    const observer = new ResizeObserver(() => {
      if (startAtEnd && el.scrollLeft >= el.scrollWidth - el.clientWidth - 40) el.scrollLeft = el.scrollWidth;
      target.current = el.scrollLeft;
      measure();
    });
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [startAtEnd]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const step = () => {
      const distance = target.current - el.scrollLeft;
      if (Math.abs(distance) < 0.5) {
        el.scrollLeft = target.current;
        frame.current = 0;
        return;
      }
      el.scrollLeft += distance * 0.22;
      frame.current = requestAnimationFrame(step);
    };
    const onWheel = (event: WheelEvent) => {
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0 || event.ctrlKey) return;
      // A sideways trackpad swipe already scrolls this way natively.
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        target.current = el.scrollLeft;
        return;
      }
      const delta = event.deltaY * (event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? el.clientWidth : 1);
      const from = frame.current ? target.current : el.scrollLeft;
      // At an end, going further: the page scrolls instead.
      if ((delta < 0 && from <= 0) || (delta > 0 && from >= max)) return;
      event.preventDefault();
      target.current = Math.max(0, Math.min(max, from + delta));
      if (!frame.current) frame.current = requestAnimationFrame(step);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      cancelAnimationFrame(frame.current);
    };
  }, []);

  return (
    <div className={clsx('relative min-w-0', className)}>
      <div
        ref={ref}
        onScroll={() => {
          if (!frame.current) target.current = ref.current?.scrollLeft ?? 0;
          measure();
        }}
        className="overflow-x-auto overscroll-x-contain pb-1.5 [scrollbar-width:thin] [scrollbar-color:rgba(138,153,173,0.35)_transparent]"
      >
        {children}
      </div>
      {/* A soft fade says there is more on that side. */}
      <div
        aria-hidden
        className={clsx(
          'pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-white to-transparent transition-opacity dark:from-[#0e192c]',
          edges.left ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div
        aria-hidden
        className={clsx(
          'pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent transition-opacity dark:from-[#0e192c]',
          edges.right ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  );
}
