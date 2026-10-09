import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Square, Mic, X } from 'lucide-react';
import clsx from 'clsx';
import { COMMANDS, partialCommand } from '../commands';
import type { ChatCommand } from '../commands';

interface ChatComposerProps {
  onSend: (question: string) => void;
  /** Abandon the answer in progress. The same button that sent it stops it. */
  onStop: () => void;
  isPending: boolean;
  /**
   * The open thread. Scope chips belong to a thread: moving to a different one
   * clears them, but a new thread learning its id mid-answer does not.
   */
  threadId?: string | null;
}

/** Grow with the text, then scroll — past this the box would eat the transcript. */
const MAX_HEIGHT = 160;

export function ChatComposer({ onSend, onStop, isPending, threadId = null }: ChatComposerProps) {
  const [value, setValue] = useState('');
  const [chips, setChips] = useState<ChatCommand[]>([]);
  const [caret, setCaret] = useState(0);
  const [menuIndex, setMenuIndex] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastThread = useRef<string | null>(threadId);
  // When Stop was last pressed — see `submit`.
  const stoppedAt = useRef(0);

  // Scope is sticky within a thread — "and yesterday?" stays a Voicedrop
  // question — but must not leak into a different conversation.
  useEffect(() => {
    const previous = lastThread.current;
    lastThread.current = threadId;
    if (previous !== null && previous !== threadId) setChips([]);
  }, [threadId]);

  // Autosize: reset to auto first so the box can shrink again on delete, not
  // only grow. scrollHeight is only meaningful once the height constraint is
  // lifted.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  const partial = partialCommand(value, caret);
  const options = useMemo(
    () =>
      partial
        ? COMMANDS.filter(
            (c) =>
              !chips.some((chip) => chip.name === c.name) &&
              (c.name.startsWith(partial.query) || c.label.toLowerCase().startsWith(partial.query)),
          )
        : [],
    [partial, chips],
  );
  const menuOpen = !!partial && !menuDismissed && options.length > 0;

  const pick = (command: ChatCommand) => {
    if (!partial) return;
    // The typed "/exc" is replaced by the chip, not left behind as text.
    const next = value.slice(0, partial.start) + value.slice(caret).replace(/^\s*/, '');
    setValue(next);
    setChips((current) => [...current, command]);
    setMenuIndex(0);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(partial.start, partial.start);
      setCaret(partial.start);
    });
  };

  const removeChip = (name: ChatCommand['name']) => {
    setChips((current) => current.filter((c) => c.name !== name));
    textareaRef.current?.focus();
  };

  // A scope chip is a setting, not a question: it stays in the box after a
  // send, so letting it send on its own meant an empty Enter — or a click that
  // landed on the button just as it turned from Stop back into Send — asked
  // "/voicedrop" and nothing else. Only a file or a chart may go without text,
  // as "do that to the previous answer".
  const canSend = value.trim().length > 0 || chips.some((c) => c.kind !== 'scope');

  const submit = () => {
    if (!canSend || isPending) return;
    // The same button stops and sends. If the answer finishes as Stop is
    // being pressed, the next click lands on Send — which the user did not
    // mean. A beat after a stop, the button does nothing.
    if (Date.now() - stoppedAt.current < 1000) return;
    const question = [...chips.map((c) => `/${c.name}`), value.trim()].join(' ').trim();
    onSend(question);
    setValue('');
    // Scope carries on to the next question; a file or a chart was asked for
    // this one only.
    setChips((current) => current.filter((c) => c.kind === 'scope'));
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

        {menuOpen && (
          <div
            role="listbox"
            aria-label="Commands"
            className="absolute bottom-full left-0 mb-2 z-20 w-72 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Commands
            </p>
            {options.map((command, index) => {
              const Icon = command.icon;
              const active = index === Math.min(menuIndex, options.length - 1);
              return (
                <button
                  key={command.name}
                  type="button"
                  role="option"
                  aria-selected={active}
                  // mousedown, not click: a click would blur the textarea first.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pick(command);
                  }}
                  onMouseEnter={() => setMenuIndex(index)}
                  className={clsx(
                    'flex w-full items-center gap-2.5 px-3 py-2 text-left',
                    active ? 'bg-blue-50 dark:bg-blue-500/10' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">/{command.name}</span>
                    <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{command.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div
          className={clsx(
            'relative z-10 flex items-end gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 focus-within:ring-2 focus-within:ring-blue-500 transition-shadow shadow-sm',
            'bg-white dark:bg-zinc-900 pl-4 pr-3 py-2.5',
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

          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {chips.map((chip) => {
              const Icon = chip.icon;
              return (
                <span
                  key={chip.name}
                  className={clsx(
                    'inline-flex items-center gap-1 rounded-md py-0.5 pl-1.5 pr-0.5 text-xs font-medium',
                    chip.kind === 'scope'
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                      : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {chip.label}
                  <button
                    type="button"
                    onClick={() => removeChip(chip.name)}
                    aria-label={`Remove ${chip.label}`}
                    className="rounded p-0.5 opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}

            <textarea
              ref={textareaRef}
              rows={1}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setCaret(event.target.selectionStart ?? event.target.value.length);
                setMenuDismissed(false);
                setMenuIndex(0);
              }}
              onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
              onKeyDown={(event) => {
                if (menuOpen) {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    const step = event.key === 'ArrowDown' ? 1 : -1;
                    setMenuIndex((i) => (Math.min(i, options.length - 1) + step + options.length) % options.length);
                    return;
                  }
                  if (event.key === 'Enter' || event.key === 'Tab') {
                    event.preventDefault();
                    pick(options[Math.min(menuIndex, options.length - 1)]);
                    return;
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setMenuDismissed(true);
                    return;
                  }
                }
                // Backspace in an empty box takes the last chip back off.
                if (event.key === 'Backspace' && !value && chips.length) {
                  event.preventDefault();
                  setChips((current) => current.slice(0, -1));
                  return;
                }
                // Enter sends, Shift+Enter breaks the line — the convention for
                // a chat box.
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder={chips.length ? 'Ask your question' : 'Ask about the call data — type / for commands'}
              aria-label="Ask a question"
              className="flex-1 min-w-[12rem] resize-none bg-transparent text-base text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 focus:outline-none leading-6 max-h-40 py-1"
            />
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* One button, two jobs: send, or stop the answer in progress.
                `type` switches with the mode — left as "submit" it would post
                the form on click — and stopping is never disabled, since the
                box is most likely to be empty exactly then. */}
            {(isPending || canSend) && (
              <button
                type={isPending ? 'button' : 'submit'}
                onClick={
                  isPending
                    ? () => {
                        stoppedAt.current = Date.now();
                        onStop();
                      }
                    : undefined
                }
                disabled={isPending ? false : !canSend}
                aria-label={isPending ? 'Stop generating' : 'Send question'}
                title={isPending ? 'Stop generating' : 'Send'}
                className={clsx(
                  'shrink-0 h-8 w-8 rounded-full flex items-center justify-center transition-colors',
                  isPending
                    ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-100 hover:bg-zinc-300 dark:hover:bg-zinc-600'
                    : 'bg-blue-600 text-white hover:bg-blue-500',
                  'disabled:opacity-40 disabled:pointer-events-none',
                )}
              >
                {isPending ? (
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
