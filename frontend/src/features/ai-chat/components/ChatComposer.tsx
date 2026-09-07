import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Square, Mic } from 'lucide-react';
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
      className="relative shrink-0 flex justify-center py-12 px-4 sm:px-6 lg:px-8"
    >
      <div className="w-full max-w-4xl relative">
        {/* Soft ambient glow surrounding the input */}
        <div className="absolute -inset-16 -z-10 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-100 via-blue-50/50 to-transparent blur-2xl pointer-events-none dark:from-blue-900/30 dark:via-blue-900/10" />

        <div
          className={clsx(
            "relative z-10 flex items-end gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 focus-within:ring-2 focus-within:ring-blue-500 transition-shadow shadow-sm",
            "bg-white dark:bg-zinc-900 pl-4 pr-3 py-2.5"
          )}
        >
          <button
            type="button"
            aria-label="Voice input"
            title="Voice input"
            className="p-1.5 shrink-0 rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <Mic className="w-5 h-5" />
          </button>

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
            placeholder="Ask about the call data"
            aria-label="Ask a question"
            className="flex-1 min-w-0 resize-none bg-transparent text-base text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 focus:outline-none leading-6 max-h-40 py-1"
          />

          <div className="flex items-center gap-1.5 shrink-0">
            {cost && cost.amount > 0 && (
              <span
                title="Estimated from token counts"
                className="text-xs font-semibold tabular-nums text-zinc-500 dark:text-zinc-400 px-1 py-0.5"
              >
                ${cost.amount}
              </span>
            )}
            {/* One button, two jobs. While an answer is being worked out this is
            the way to abandon it — where a spinner used to sit, which showed
            that something was happening but offered no way to end it.

            `type` switches with the mode: left as "submit" it would post the
            form on click, which the guard in `submit()` turns into nothing at
            all rather than into a stop. And the disabled rule inverts — an
            empty box disables sending, but must never disable stopping, which
            is exactly when the box is most likely to be empty. */}
            {(isPending || value.trim().length > 0) && (
              <button
                type={isPending ? 'button' : 'submit'}
                onClick={isPending ? onStop : undefined}
                disabled={isPending ? false : !value.trim()}
                aria-label={isPending ? 'Stop generating' : 'Send question'}
                title={isPending ? 'Stop generating' : 'Send'}
                className={clsx(
                  'shrink-0 h-8 w-8 rounded-full flex items-center justify-center transition-colors',
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
                  <ArrowUp className="w-4 h-4" strokeWidth={2.5} />
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
