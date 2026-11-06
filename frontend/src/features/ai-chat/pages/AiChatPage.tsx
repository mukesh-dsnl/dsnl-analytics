import type { CSSProperties } from 'react';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'react-router-dom';
import clsx from 'clsx';
import { Loader2, Square, TriangleAlert } from 'lucide-react';
import { AnalyticsAiIcon } from '@/components/AnalyticsAiIcon';
import { useHeaderSlot } from '../../../components/HeaderSlot';
import { useAuthStore } from '../../../store';
import { useChat } from '../hooks';
import type { ChatMessage } from '../hooks';
import { AnswerBody } from '../components/AnswerBody';
import { ChatComposer } from '../components/ChatComposer';
import { RoundSteps } from '../components/RoundSteps';
import { ExportFiles } from '../components/ExportFiles';
import { commandSegments } from '../commands';
import { CopyButton } from '../components/CopyButton';

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

/** "admin" -> "Admin", "mukesh kumar" -> "Mukesh Kumar". */
const displayName = (name: string | null) =>
  (name ?? '').replace(/[._]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();

/** The greeting above the composer on a new chat. */
function Welcome() {
  const username = useAuthStore((state) => state.username);
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name = displayName(username);
  return (
    <div className="flex flex-col items-center px-6 pb-2 text-center">
      <h2 className="flex items-center gap-3 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
        <AnalyticsAiIcon className="h-8 w-8 shrink-0 text-blue-600 dark:text-blue-400" />
        {name ? `${part}, ${name}` : part}
      </h2>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        What would you like to know about your calls today?
      </p>
    </div>
  );
}

/** The four starting points under the composer, one per line. */
function Suggestions({ onPick }: { onPick: (question: string) => void }) {
  return (
    <ul className="flex flex-col items-center gap-2 px-4 sm:px-6 lg:px-8">
      {SUGGESTIONS.map((suggestion, index) => (
        <li key={suggestion} className="max-w-full">
          {/* ai-orbit: a soft highlight travelling round the edge (index.css),
              offset per box so the four don't move in step. */}
          <button
            type="button"
            onClick={() => onPick(suggestion)}
            style={{ '--orbit-delay': `${-index * 1.75}s` } as CSSProperties}
            className="ai-orbit max-w-full truncate rounded-lg border px-4 py-2 text-sm
                       bg-white dark:bg-surface-dark
                       text-zinc-700 dark:text-zinc-300
                       hover:text-zinc-900 dark:hover:text-zinc-100
                       shadow-sm transition-colors"
          >
            {suggestion}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** "Today, 3:42 PM" / "Yesterday, 3:42 PM" / "21 Oct 2026, 3:42 PM". */
function readableTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(new Date()) - day(at)) / 86_400_000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  return `${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}, ${time}`;
}

/** The answer as plain text — the bold markers dropped, everything else as written. */
const plainAnswer = (text: string) => text.replace(/\*\*/g, '');

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    // Commands stay where they were typed, highlighted in place — the same
    // inline pills as the composer — so the question reads as it was asked.
    return (
      <li data-role="question" className="group flex items-center justify-end gap-1.5">
        <CopyButton
          text={message.text}
          label="Copy question"
          className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        />
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-blue-600 px-3.5 py-2.5 text-sm text-white whitespace-pre-wrap break-words shadow-sm">
          {commandSegments(message.text).map((segment, index) =>
            segment.command ? (
              <span
                key={index}
                className="rounded-[5px] bg-white/20 font-medium text-white shadow-[0_0_0_2px_rgba(255,255,255,0.2)]"
              >
                {segment.text}
              </span>
            ) : (
              <Fragment key={index}>{segment.text}</Fragment>
            ),
          )}
        </div>
      </li>
    );
  }

  // The answer sits on a plain white card: the page behind it is the grid
  // backdrop, and text read straight off the grid is harder work. The steps
  // above it and the time / copy line under it stay off the card.
  // An error keeps its tinted panel instead: it needs to read as a thing that
  // went wrong.
  return (
    <li data-message-id={message.id} className="flex justify-start">
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
            <>
              {/* As wide as its text, up to the column — a chart needs the full width to draw. */}
              <div
                className={clsx(
                  'rounded-2xl border border-[#e3e8ef] bg-white px-5 py-4 shadow-[0_1px_3px_rgba(17,24,39,0.05)] dark:border-white/[0.08] dark:bg-surface-dark',
                  message.chart ? 'w-full' : 'w-fit max-w-full',
                )}
              >
                <AnswerBody text={message.text} animate={message.animate} chart={message.chart} />
                {!!message.exports?.length && <ExportFiles exports={message.exports} />}
              </div>
              <div className="mt-2 flex items-center gap-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                {message.createdAt && (
                  <time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>
                    {readableTime(message.createdAt)}
                  </time>
                )}
                <CopyButton text={plainAnswer(message.text)} label="Copy answer" />
              </div>
            </>
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

  const { messages, send, stop, isPending, isRestoring, loadError } = useChat(
    conversationId ?? null,
  );
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Follow the newest turn as it grows. Counting the steps too, not just the
  // messages: during a long answer the message count doesn't change, but the
  // bubble gets taller with every round and would otherwise grow off-screen.
  const stepCount = messages.reduce((total, m) => total + (m.steps?.length ?? 0), 0);

  // Which turns were still being worked on at the last scroll — so the moment
  // one of them finishes can be told apart from any other update.
  const streamingIds = useRef<Set<string>>(new Set());

  /**
   * The answer that just arrived, while the view still follows it.
   *
   * The transcript stays one continuous page, filled to the bottom — no empty
   * room is ever added below the last answer. While the answer types itself
   * in, the view keeps its end in sight, until the question it answers reaches
   * the top of the panel; from there it holds still, so a long answer is read
   * from its question downward. Any scroll or click of the reader's own ends
   * the following.
   */
  const [following, setFollowing] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const landed = messages.find(
      (m) => m.role === 'assistant' && !m.isStreaming && streamingIds.current.has(m.id),
    );
    streamingIds.current = new Set(messages.filter((m) => m.isStreaming).map((m) => m.id));

    const scroller = scrollerRef.current;
    if (!scroller) return;

    if (landed) {
      setFollowing(landed.id);
      return;
    }

    // Anything else — a question sent, a step reported, a thread opened —
    // follows the bottom, and ends following an earlier answer.
    if (following && messages[messages.length - 1]?.id !== following) setFollowing(null);
    // Instant, by position. A smooth scroll is cancelled by the browser when
    // the content under it changes, and here it always does: the steps tick
    // while an answer is worked out. Smooth scrolls stopped hundreds of
    // pixels short of the bottom.
    scroller.scrollTop = scroller.scrollHeight;
    // `messages` is read for the transition, not tracked: re-running on every
    // patch (a file finishing after the answer, say) would yank the reader
    // back to the bottom of something they are reading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, stepCount, isPending]);

  // A layout effect, so the first placement happens before the frame is painted.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const list = listRef.current;
    if (!following || !scroller || !list) return;

    const place = () => {
      const answer = scroller.querySelector(`[data-message-id="${following}"]`);
      if (!answer) return;
      const question = answer.previousElementSibling;
      const start = question?.getAttribute('data-role') === 'question' ? question : answer;
      const top =
        start.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 16;
      // The bottom while the turn still fits; the question at the top once it doesn't.
      scroller.scrollTop = Math.min(top, scroller.scrollHeight - scroller.clientHeight);
    };
    place();

    const observer = new ResizeObserver(place);
    observer.observe(list);
    const release = () => setFollowing(null);
    scroller.addEventListener('wheel', release, { passive: true });
    scroller.addEventListener('touchmove', release, { passive: true });
    scroller.addEventListener('pointerdown', release);
    return () => {
      observer.disconnect();
      scroller.removeEventListener('wheel', release);
      scroller.removeEventListener('touchmove', release);
      scroller.removeEventListener('pointerdown', release);
    };
  }, [following]);

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
        <AnalyticsAiIcon className="w-[18px] h-[18px] shrink-0 text-blue-600 dark:text-blue-400" />
        <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 truncate">
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
    <div className="flex-1 min-h-0 flex flex-col">
      {title}

      {/* The transcript scrolls; the composer below it does not. */}
      <div ref={scrollerRef} className="flex-1 min-h-0 overflow-y-auto px-6 pt-4 pb-4">
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
          <div className="h-full flex flex-col items-center justify-end">
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
            <Welcome />
          </div>
        ) : (
          <ul ref={listRef} className="space-y-5 max-w-4xl mx-auto">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}

            {/* No separate spinner row: the in-flight assistant message is
                already on screen, reporting each step as it happens. */}
          </ul>
        )}
      </div>

      <div className="max-w-4xl w-full mx-auto">
        <ChatComposer
          onSend={send}
          onStop={stop}
          isPending={isPending}
          threadId={conversationId ?? null}
        />
      </div>

      {/* The space below the composer, which does the moving. On a blank page
          it grows as much as the transcript above it, so the composer sits in
          the middle with the greeting over it and the suggestions under it;
          when the first question lands it shrinks to nothing and the composer
          slides to the foot of the page. flex-grow is animated, which is what
          makes that a movement rather than a jump. */}
      <div
        className={clsx(
          'min-h-0 basis-0 transition-[flex-grow] duration-500 ease-in-out motion-reduce:transition-none',
          isBlank ? 'grow' : 'grow-0',
        )}
      >
        {isBlank && (
          <div className="mx-auto -mt-8 max-w-4xl">
            <Suggestions onPick={send} />
          </div>
        )}
      </div>
    </div>
  );
}
