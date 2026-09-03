import { useEffect, useRef, useState } from 'react';
import { Coins, SendHorizontal, Square } from 'lucide-react';
import clsx from 'clsx';

interface ChatComposerProps {
  onSend: (question: string) => void;
  /** Abandon the answer in progress. The same button that sent it stops it. */
  onStop: () => void;
  isPending: boolean;
  /** The conversation's running cost, shown above the send button. */
  cost?: { amount: number; currency: string };
}

/** Grow with the text, then scroll — past this the box would eat the transcript. */
const MAX_HEIGHT = 160;

/** Small amounts need more decimals than money usually does. */
function formatCost(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      // A conversation costs fractions of a cent; two decimals would round
      // every honest figure to $0.00 and make the badge look broken.
      minimumFractionDigits: amount > 0 && amount < 0.01 ? 4 : 2,
      maximumFractionDigits: 4,
    }).format(amount);
  } catch {
    // An unrecognised currency code should not take the badge down with it.
    return `${amount.toFixed(4)} ${currency}`;
  }
}

export function ChatComposer({ onSend, onStop, isPending, cost }: ChatComposerProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Autosize: reset to auto first so the box can shrink again on delete, not
  // only grow. scrollHeight is only meaningful once the height constraint is
  // lifted.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  const submit = () => {
    if (!value.trim() || isPending) return;
    onSend(value);
    setValue('');
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="relative shrink-0 border-t border-zinc-200 dark:border-zinc-800/60 bg-white dark:bg-surface-dark p-3"
    >
      {/* The conversation's cost, peeking out from behind the input above the
          send button. Behind it, not beside it: this is a running total, not
          a control, and it should be findable without competing with the
          thing you came here to press.

          Only the amount — the token split is recorded server-side and was
          just noise here. Marked an estimate because that is what it is: token
          counts times configured rates, not a provider invoice. */}
      {cost && cost.amount > 0 && (
        <span
          title="Estimated from token counts and the configured rates — not a provider invoice"
          className="absolute right-4 -top-3 z-0 flex items-center gap-1
                     rounded-t-md border border-b-0 border-zinc-200 dark:border-zinc-800
                     bg-zinc-50 dark:bg-canvas-dark
                     pl-2 pr-2 pt-1 pb-2
                     text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400"
        >
          <Coins className="w-3 h-3" />
          <span className="font-semibold text-zinc-700 dark:text-zinc-200">
            {formatCost(cost.amount, cost.currency)}
          </span>
          <span className="text-zinc-400 dark:text-zinc-500">est.</span>
        </span>
      )}

      <div className="relative z-10 flex items-end gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-canvas-dark px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500 transition-shadow">
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          // Enter sends, Shift+Enter breaks the line — the convention for a
          // chat box. Without this the form would only submit from the button,
          // which is the wrong default for something typed into repeatedly.
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Ask about calls, connect rates, durations, reblasts…"
          aria-label="Ask a question about the call data"
          className="flex-1 min-w-0 resize-none bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none leading-6 max-h-40"
        />
        {/* One button, two jobs. While an answer is being worked out this is
            the way to abandon it — where a spinner used to sit, which showed
            that something was happening but offered no way to end it.

            `type` switches with the mode: left as "submit" it would post the
            form on click, which the guard in `submit()` turns into nothing at
            all rather than into a stop. And the disabled rule inverts — an
            empty box disables sending, but must never disable stopping, which
            is exactly when the box is most likely to be empty. */}
        <button
          type={isPending ? 'button' : 'submit'}
          onClick={isPending ? onStop : undefined}
          disabled={isPending ? false : !value.trim()}
          aria-label={isPending ? 'Stop generating' : 'Send question'}
          title={isPending ? 'Stop generating' : 'Send'}
          className={clsx(
            'shrink-0 h-8 w-8 rounded-lg flex items-center justify-center transition-colors',
            // Not the accent while stopping: the accent means "send", and a
            // stop control wearing it reads as the thing you just pressed
            // rather than as its opposite.
            isPending
              ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-100 hover:bg-zinc-300 dark:hover:bg-zinc-600'
              : 'bg-blue-600 text-white hover:bg-blue-500',
            'disabled:opacity-40 disabled:pointer-events-none',
          )}
        >
          {isPending ? (
            // Filled, so it reads as a solid stop marker at 14px rather than
            // as an empty outlined box.
            <Square className="w-3.5 h-3.5 fill-current" />
          ) : (
            <SendHorizontal className="w-4 h-4" />
          )}
        </button>
      </div>
    </form>
  );
}
