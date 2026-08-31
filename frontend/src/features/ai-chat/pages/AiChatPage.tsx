import { useEffect, useRef } from 'react';
import { Loader2, RotateCcw, Sparkles, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';
import { useChat } from '../hooks';
import type { ChatMessage } from '../hooks';
import { ChatComposer } from '../components/ChatComposer';
import { QueryTrace } from '../components/QueryTrace';

/**
 * Natural-language questions over the CDR/CODR lake.
 *
 * Text only, by design — this answers "how many", not "show me a chart"; the
 * dashboards already do the second. What it adds over them is the questions
 * that don't have a panel: a cross-tab, a comparison, a one-off.
 *
 * The page owns no data logic. It sends a question, renders what comes back,
 * and shows the queries behind it — every figure is the backend's.
 */

/** Starting points that each exercise a different path through the backend. */
const SUGGESTIONS = [
  'How many voicedrop calls connected yesterday?',
  'Which carrier had the worst connect rate for voicedrop yesterday?',
  'Compare dial-in and dial-out connect rates for conference yesterday',
  'What were the top 5 disconnect reasons yesterday?',
];

function EmptyState({ onPick }: { onPick: (question: string) => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/50 flex items-center justify-center">
        <Sparkles className="w-6 h-6 text-blue-600 dark:text-blue-400" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        Ask about the call data
      </h2>
      <p className="mt-1.5 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
        Questions are answered from the CDR and CODR exports — call legs, connection
        outcomes, durations, reblasts and disconnect reasons. There is no billing or
        network-health data, and the assistant will say so rather than guess.
      </p>

      <ul className="mt-6 grid gap-2 w-full max-w-xl sm:grid-cols-2">
        {SUGGESTIONS.map((suggestion) => (
          <li key={suggestion}>
            <button
              type="button"
              onClick={() => onPick(suggestion)}
              className="w-full h-full text-left px-3.5 py-2.5 rounded-lg text-sm
                         bg-white dark:bg-surface-dark
                         border border-zinc-200 dark:border-zinc-800/60
                         text-zinc-700 dark:text-zinc-300
                         hover:border-blue-300 dark:hover:border-blue-800
                         hover:text-zinc-900 dark:hover:text-zinc-100
                         shadow-sm transition-colors"
            >
              {suggestion}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <li className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-blue-600 px-3.5 py-2.5 text-sm text-white whitespace-pre-wrap break-words shadow-sm">
          {message.text}
        </div>
      </li>
    );
  }

  return (
    <li className="flex justify-start">
      <div
        className={clsx(
          'max-w-[85%] rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-sm shadow-sm border',
          message.isError
            ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/50 text-amber-900 dark:text-amber-200'
            : 'bg-white dark:bg-surface-dark border-zinc-200 dark:border-zinc-800/60 text-zinc-800 dark:text-zinc-200',
        )}
      >
        {message.isError && (
          <div className="flex items-center gap-1.5 mb-1 text-xs font-semibold">
            <TriangleAlert className="w-3.5 h-3.5" />
            Couldn’t answer
          </div>
        )}

        <div className="whitespace-pre-wrap break-words leading-relaxed">{message.text}</div>

        {message.queries && <QueryTrace queries={message.queries} />}
      </div>
    </li>
  );
}

export function AiChatPage() {
  const { messages, send, reset, isPending, hasConversation } = useChat();
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest turn in view as the conversation grows, including while a
  // pending answer is still a spinner.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, isPending]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-4 px-6 py-3 shrink-0">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            AI Assistant
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
            Ask questions about CDR and CODR call records
          </p>
        </div>

        {hasConversation && (
          <button
            type="button"
            onClick={reset}
            className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
                       text-zinc-600 dark:text-zinc-400
                       hover:bg-zinc-100 dark:hover:bg-zinc-800/50
                       hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            New conversation
          </button>
        )}
      </div>

      {/* The transcript scrolls; the composer below it does not. */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4">
        {messages.length === 0 ? (
          <EmptyState onPick={send} />
        ) : (
          <ul className="space-y-3 max-w-3xl mx-auto">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}

            {isPending && (
              <li className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm bg-white dark:bg-surface-dark border border-zinc-200 dark:border-zinc-800/60 px-3.5 py-2.5 shadow-sm">
                  <span className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Querying the lake…
                  </span>
                </div>
              </li>
            )}

            <div ref={endRef} />
          </ul>
        )}
      </div>

      <div className="max-w-3xl w-full mx-auto">
        <ChatComposer onSend={send} isPending={isPending} />
      </div>
    </div>
  );
}
