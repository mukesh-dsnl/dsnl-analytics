import { useEffect, useRef } from 'react';
import { RotateCcw, Sparkles, Square, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';
import { useChat } from '../hooks';
import type { ChatMessage } from '../hooks';
import { AnswerBody, hasTable } from '../components/AnswerBody';
import { ChatComposer } from '../components/ChatComposer';
import { RoundSteps } from '../components/RoundSteps';

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

  // A breakdown needs the room; a sentence looks stranded at full width. The
  // live turn takes it too, so the bubble doesn't jump width when the answer
  // replaces the progress list.
  const isWide =
    message.isStreaming || (!message.isError && hasTable(message.text));

  return (
    <li className="flex justify-start">
      <div
        className={clsx(
          'rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-sm shadow-sm border',
          isWide ? 'w-full' : 'max-w-[85%]',
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

        {/* The steps stay at the top through both phases: they are written
            there while the answer is being worked out, and they stay there
            once it arrives, with the answer appearing underneath. One render
            site rather than two, so the lines never jump position — and the
            component stays mounted across the transition, which is also what
            stops the finished lines re-typing themselves at the end. */}
        {!!message.steps?.length && (
          <RoundSteps steps={message.steps} isLive={!!message.isStreaming} />
        )}

        {/* An error is plain text by definition — only a real answer can carry
            a table, and running the parser over a server message would be
            interpreting something the model never wrote. */}
        {!message.isStreaming &&
          (message.isError ? (
            <div className="whitespace-pre-wrap break-words leading-relaxed">{message.text}</div>
          ) : (
            <AnswerBody text={message.text} />
          ))}
      </div>
    </li>
  );
}

export function AiChatPage() {
  const { messages, send, stop, reset, isPending, hasConversation } = useChat();
  const endRef = useRef<HTMLDivElement>(null);

  // Follow the newest turn as it grows. Counting the steps too, not just the
  // messages: during a long answer the message count doesn't change, but the
  // bubble gets taller with every round and would otherwise grow off-screen.
  const stepCount = messages.reduce((total, m) => total + (m.steps?.length ?? 0), 0);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, stepCount, isPending]);

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

        {isPending && (
          <button
            type="button"
            onClick={stop}
            className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
                       text-zinc-600 dark:text-zinc-400
                       hover:bg-zinc-100 dark:hover:bg-zinc-800/50
                       hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors"
          >
            <Square className="w-3 h-3" />
            Stop
          </button>
        )}

        {hasConversation && !isPending && (
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
          <ul className="space-y-3 max-w-4xl mx-auto">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}

            {/* No separate spinner row: the in-flight assistant message is
                already on screen, reporting each step as it happens. */}
            <div ref={endRef} />
          </ul>
        )}
      </div>

      <div className="max-w-4xl w-full mx-auto">
        <ChatComposer onSend={send} isPending={isPending} />
      </div>
    </div>
  );
}
