import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'react-router-dom';
import clsx from 'clsx';
import { Loader2, Sparkles, Square, TriangleAlert } from 'lucide-react';
import { useHeaderSlot } from '../../../components/HeaderSlot';
import { useChat } from '../hooks';
import type { ChatMessage } from '../hooks';
import { AnswerBody } from '../components/AnswerBody';
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
        Ask about the DSNL call data
      </h2>
      <p className="mt-1.5 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
        {/* Questions are answered from the CDR and CODR exports — call legs, connection
        outcomes, durations, reblasts and disconnect reasons. There is no billing or
        network-health data, and the assistant will say so rather than guess. */}

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

  // The assistant's turn is not a card. Only the question is boxed — the
  // answer is the page's own text, which is what gives a long breakdown room
  // to breathe and stops every reply looking like a notification.
  // An error is the exception: it needs to read as a thing that went wrong,
  // so it keeps a tinted panel.
  return (
    <li className="flex justify-start">
      <div className="w-full min-w-0 text-sm text-zinc-800 dark:text-zinc-200">
        {/* The steps stay at the top through both phases: they are written
            there while the answer is being worked out, and they stay there
            once it arrives, with the answer appearing underneath. One render
            site rather than two, so the lines never jump position — and the
            component stays mounted across the transition, which is also what
            stops the finished lines re-typing themselves at the end. */}
        {!!message.steps?.length && (
          <RoundSteps steps={message.steps} isLive={!!message.isStreaming} />
        )}

        {!message.isStreaming &&
          (message.isStopped ? (
            // Quiet, and not the error panel: this is the assistant doing what
            // it was told. The steps above stay, so what it did get through
            // before stopping is still on the record.
            <div className="flex items-center gap-1.5 text-xs italic text-zinc-500 dark:text-zinc-400">
              <Square className="w-3 h-3 fill-current" />
              {message.text || 'Stopped.'}
            </div>
          ) : message.isError ? (
            <div
              className="rounded-lg border border-amber-200 dark:border-amber-900/50
                         bg-amber-50 dark:bg-amber-950/30 px-3 py-2
                         text-amber-900 dark:text-amber-200"
            >
              <div className="flex items-center gap-1.5 mb-1 text-xs font-semibold">
                <TriangleAlert className="w-3.5 h-3.5" />
                Couldn’t answer
              </div>
              <div className="whitespace-pre-wrap break-words leading-relaxed">
                {message.text}
              </div>
            </div>
          ) : (
            <AnswerBody text={message.text} animate={message.animate} />
          ))}
      </div>
    </li>
  );
}

export function AiChatPage() {
  // ── The address bar is the only thing that decides which thread is open ──
  // One direction, no mirror. An earlier version kept the id in a store and
  // synced it both ways; those two rules contradicted each other whenever the
  // URL had no id but the store did — each effect undid the other's
  // precondition and the URL oscillated. There is nothing to keep in step now.
  const { conversationId } = useParams();

  const { messages, send, stop, isPending, isRestoring, usage, loadError } = useChat(
    conversationId ?? null,
  );
  const endRef = useRef<HTMLDivElement>(null);

  // Follow the newest turn as it grows. Counting the steps too, not just the
  // messages: during a long answer the message count doesn't change, but the
  // bubble gets taller with every round and would otherwise grow off-screen.
  const stepCount = messages.reduce((total, m) => total + (m.steps?.length ?? 0), 0);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, stepCount, isPending]);

  const headerSlot = useHeaderSlot();
  const isLoading = isRestoring && messages.length === 0;
  // A thread with nothing in it yet. The composer belongs in the middle of the
  // page here, and drops to the bottom once there is a transcript above it —
  // the same move a new chat makes in every tool people already use.
  const isBlank = !isLoading && messages.length === 0;

  // The page's identity goes in the layout's header, beside the theme toggle,
  // rather than being repeated inside the panel it already labels.
  //
  // The Stop button that used to sit here has moved into the composer, where
  // the send button becomes it. Keeping both would have put two identical
  // controls on screen at once, at opposite corners — and the composer is
  // where the hand already is, having just pressed send.
  const title = headerSlot
    ? createPortal(
      <div className="min-w-0 flex items-center gap-2">
        <Sparkles className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-400" />
        <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
          Analytics AI
        </h1>
      </div>,
      headerSlot,
    )
    : null;

  return (
    // One layout for both states, not two. The composer is the *same* element
    // throughout, so it can travel from the middle of a blank page down to the
    // foot of a conversation instead of disappearing from one place and
    // reappearing in another — and whatever is half-typed in it survives the
    // move.
    <div className="h-full flex flex-col">
      {title}

      {/* The transcript scrolls; the composer below it does not. */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-4 pb-4">
        {isLoading ? (
          // The previous thread is being fetched. Showing the empty state here
          // would flash "Ask about the call data" over a conversation that is
          // about to reappear.
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-400 dark:text-zinc-600" />
          </div>
        ) : isBlank ? (
          // A blank panel means one of two very different things: a new chat,
          // or a thread this account cannot open. They looked identical until
          // the notice below existed — which is how a link to someone else's
          // conversation used to present as an ordinary new chat.
          <div className="h-full flex flex-col items-center justify-end pb-2">
            {loadError && (
              <div
                role="status"
                className="mb-4 max-w-xl flex items-start gap-2 rounded-lg px-3.5 py-2.5 text-sm
                           border border-amber-200 dark:border-amber-900/50
                           bg-amber-50 dark:bg-amber-950/30
                           text-amber-900 dark:text-amber-200"
              >
                <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{loadError}</span>
              </div>
            )}
            <EmptyState onPick={send} />
          </div>
        ) : (
          <ul className="space-y-5 max-w-4xl mx-auto">
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
        <ChatComposer
          onSend={send}
          onStop={stop}
          isPending={isPending}
          cost={{ amount: usage.cost, currency: usage.currency }}
        />
      </div>

      {/* The spacer that does the moving. On a blank page it holds the composer
          up near the middle; when the first question lands it collapses to
          nothing and the composer slides to the foot of the page. Animating a
          height is what makes that a movement rather than a jump — flex
          alignment, the obvious alternative, does not transition. */}
      <div
        aria-hidden
        className={clsx(
          'shrink-0 transition-[height] duration-500 ease-in-out motion-reduce:transition-none',
          isBlank ? 'h-[32vh]' : 'h-0',
        )}
      />
    </div>
  );
}
