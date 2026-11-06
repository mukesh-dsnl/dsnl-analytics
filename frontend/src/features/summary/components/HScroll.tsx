import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import clsx from 'clsx';

/**
 * A horizontal strip the wheel moves sideways: with the pointer inside it,
 * an ordinary mouse wheel (or a two-finger vertical swipe) slides the content
 * left and right, and a sideways trackpad swipe does what it always does.
 *
 * While the pointer is over the strip the wheel moves the strip alone — at
 * either end it stops there rather than scrolling the page. The motion eases
 * towards where the wheel is aiming rather than jumping a notch at a time,
 * which is what keeps a clicky mouse wheel smooth.
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

  // Open on the latest end, and stay pinned there while the content grows.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (startAtEnd) el.scrollLeft = el.scrollWidth;
    target.current = el.scrollLeft;
    const observer = new ResizeObserver(() => {
      if (startAtEnd && el.scrollLeft >= el.scrollWidth - el.clientWidth - 40) el.scrollLeft = el.scrollWidth;
      target.current = el.scrollLeft;
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
      const before = el.scrollLeft;
      el.scrollLeft += distance * 0.22;
      // Pinned against an end it cannot pass (a fractional width): stop there.
      if (el.scrollLeft === before) {
        target.current = before;
        frame.current = 0;
        return;
      }
      frame.current = requestAnimationFrame(step);
    };
    const onWheel = (event: WheelEvent) => {
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0 || event.ctrlKey) return;
      // The page stays put while the pointer is here, even at either end.
      event.preventDefault();
      // A sideways trackpad swipe moves the strip directly.
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        cancelAnimationFrame(frame.current);
        frame.current = 0;
        el.scrollLeft += event.deltaX;
        target.current = el.scrollLeft;
        return;
      }
      const delta = event.deltaY * (event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? el.clientWidth : 1);
      const from = frame.current ? target.current : el.scrollLeft;
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
        }}
        className="overflow-x-auto overscroll-x-contain pb-1.5 [scrollbar-width:thin] [scrollbar-color:rgba(138,153,173,0.35)_transparent]"
      >
        {children}
      </div>
    </div>
  );
}
