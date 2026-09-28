import { useEffect, useRef, useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { TextShimmer } from '@/components/core/text-shimmer';
import type { ChatStep } from '../hooks';

interface RoundStepsProps {
  steps: ChatStep[];
  /** True while the turn is still being worked on. */
  isLive: boolean;
}

/** Characters per second for the typing effect. */
const CHARS_PER_SECOND = 45;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * Reveal `text` a character at a time, once.
 *
 * Driven by requestAnimationFrame against a timestamp rather than by a
 * setInterval per character: the rate then stays the same whether the tab is
 * busy or idle, and one dropped frame doesn't desynchronise the line.
 *
 * `enabled` is false for steps that were already complete when they mounted —
 * scrolling back through the transcript should not replay old animations —
 * and for anyone who has asked for reduced motion.
 */
function useTypewriter(text: string, enabled: boolean): string {
  const [shown, setShown] = useState(() => (enabled ? '' : text));

  useEffect(() => {
    if (!enabled) {
      setShown(text);
      return;
    }

    let frame = 0;
    let start: number | null = null;

    const tick = (timestamp: number) => {
      if (start === null) start = timestamp;
      const elapsed = (timestamp - start) / 1000;
      const count = Math.min(text.length, Math.ceil(elapsed * CHARS_PER_SECOND));
      setShown(text.slice(0, count));
      if (count < text.length) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, enabled]);

  return shown;
}

function StepRow({
  step,
  animate,
  shimmer,
}: {
  step: ChatStep;
  animate: boolean;
  shimmer: boolean;
}) {
  const label = useTypewriter(step.label, animate);
  const isTyping = label.length < step.label.length;
  // Not while it is still typing: the caret is already saying "this line is
  // happening", and two motions on one line compete. The shimmer takes over
  // the moment the caret goes, and runs until the next step displaces it.
  const isShimmering = shimmer && !isTyping;

  return (
    <li className="flex items-start gap-2 text-[11px] leading-5">
      <span className="w-3 mt-1 shrink-0" aria-hidden>
        {!step.done ? (
          // A pulsing dot, not a spinner: this row is one of several and a
          // spinner on each would be a lot of motion for a quiet status list.
          <span className="block w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
        ) : step.ok === false ? (
          <RefreshCw className="w-3 h-3 text-amber-500" />
        ) : (
          <Check className="w-3 h-3 text-emerald-500" />
        )}
      </span>

      <span className="min-w-0">
        {isShimmering ? (
          // Same size as every other line — the motion is what marks it as
          // live, and it does that without the row's metrics changing as a
          // step settles.
          <TextShimmer duration={1.4}>{label}</TextShimmer>
        ) : (
          <span
            className={clsx(
              step.done ? 'text-zinc-600 dark:text-zinc-400' : 'text-zinc-800 dark:text-zinc-200',
            )}
          >
            {label}
          </span>
        )}

        {/* The caret belongs to the line being typed, and goes away with it. */}
        {isTyping && (
          <span className="inline-block w-[2px] h-3 ml-0.5 -mb-0.5 bg-blue-500 animate-pulse" />
        )}

        {!isTyping && !step.done && (
          <span className="text-zinc-400 dark:text-zinc-500">…</span>
        )}

        {step.done && step.seconds != null && (
          <span className="text-zinc-400 dark:text-zinc-500 tabular-nums">
            {' '}
            · {step.seconds.toFixed(step.seconds < 10 ? 1 : 0)}s
          </span>
        )}

        {step.done && step.ok === false && (
          <span className="text-amber-600 dark:text-amber-500"> · retried</span>
        )}
      </span>
    </li>
  );
}

/**
 * What the assistant is doing, or did, one line per step.
 *
 * The same list serves both phases. While the answer is being worked out each
 * new line types itself in and shows a pulsing dot until its event arrives;
 * once the answer lands the lines stay exactly where they are as the record of
 * how it was reached, with the time each step took. That continuity is the
 * point — the progress display is not replaced by a summary, it *becomes* one.
 */
export function RoundSteps({ steps, isLive }: RoundStepsProps) {
  // Which steps existed on the first render. Those are history and appear
  // instantly; anything added later is new work and types itself in.
  const initialCount = useRef(isLive ? 0 : steps.length);
  const animate = !prefersReducedMotion();

  if (!steps.length) return null;

  return (
    <ul
      className={clsx(
        'space-y-0.5',
        // Once the answer is below it, the list is separated from it by a rule
        // underneath rather than above — the steps read as the preamble to the
        // answer, which is the order they happened in.
        !isLive && 'mb-2.5 border-b border-zinc-200 dark:border-zinc-800/60 pb-2',
      )}
      aria-live={isLive ? 'polite' : undefined}
    >
      {steps.map((step, index) => (
        <StepRow
          key={step.id}
          step={step}
          animate={animate && index >= initialCount.current}
          // Only the newest line, and only while the turn is still running.
          // Appending the next step ends the previous one's shimmer by making
          // it no longer last, and the answer arriving ends it for all of them
          // — at which point the list stops being progress and becomes record.
          shimmer={isLive && index === steps.length - 1}
        />
      ))}
    </ul>
  );
}
