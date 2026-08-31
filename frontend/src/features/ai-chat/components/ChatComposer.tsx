import { useEffect, useRef, useState } from 'react';
import { Loader2, SendHorizontal } from 'lucide-react';
import clsx from 'clsx';

interface ChatComposerProps {
  onSend: (question: string) => void;
  isPending: boolean;
}

/** Grow with the text, then scroll — past this the box would eat the transcript. */
const MAX_HEIGHT = 160;

export function ChatComposer({ onSend, isPending }: ChatComposerProps) {
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
      className="shrink-0 border-t border-zinc-200 dark:border-zinc-800/60 bg-white dark:bg-surface-dark p-3"
    >
      <div className="flex items-end gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-canvas-dark px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500 transition-shadow">
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
        <button
          type="submit"
          disabled={!value.trim() || isPending}
          aria-label="Send question"
          className={clsx(
            'shrink-0 h-8 w-8 rounded-lg flex items-center justify-center transition-colors',
            'bg-blue-600 text-white hover:bg-blue-500',
            'disabled:opacity-40 disabled:pointer-events-none',
          )}
        >
          {isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <SendHorizontal className="w-4 h-4" />
          )}
        </button>
      </div>
      <p className="mt-1.5 px-1 text-[11px] text-zinc-400 dark:text-zinc-500">
        Answers come from the CDR/CODR lake only. Every figure is traceable to the query
        behind it — open “queries” under an answer to check it.
      </p>
    </form>
  );
}
