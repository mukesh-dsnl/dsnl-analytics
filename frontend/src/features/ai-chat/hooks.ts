/**
 * Conversation state for the AI chat.
 *
 * The transcript lives on the server. What this hook keeps is:
 *
 *   `messages` — what is on screen, including the pending question, the live
 *                progress steps, and any error bubble. The server knows about
 *                none of those three.
 *   `usage`    — the running token totals and cost, as reported by the server.
 *
 * Which conversation is open lives in `store.ts`, not here: the sidebar list
 * can change it too, and the two are siblings under the layout.
 *
 * Keeping `messages` separate from the server's record is what lets a failed
 * question stay on screen (so the user can read what they asked and retry)
 * without that failure entering the conversation the model is given.
 *
 * The steps are kept on the message rather than in page state so they survive
 * as part of the transcript: after the answer lands they stop being progress
 * and become the record of how it was reached.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { aiApi } from './api';
import { CONVERSATIONS_KEY } from './components/ConversationList';
import type { ChatEvent, ChatQuery, InteractionUsage, TokenUsage } from './api';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store';
import { summarizeQuery } from './queryLabel';

export interface ChatStep {
  id: string;
  /** The line of text shown, already human-readable. */
  label: string;
  /** Filled in when the step finishes. */
  seconds?: number;
  /** False when a tool was rejected and the model had to retry. */
  ok?: boolean;
  done: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Assistant turns only — the tool calls behind the answer. */
  queries?: ChatQuery[];
  /** Assistant turns only — what happened, in order, while answering. */
  steps?: ChatStep[];
  /** What this one exchange cost. Stored and returned; not shown in the UI. */
  interaction?: InteractionUsage;
  /**
   * Type this answer in rather than showing it at once. Set only on an answer
   * that just arrived — restored history should already be there, not replay
   * itself every time the thread is opened.
   */
  animate?: boolean;
  /** True for the bubble that reports a failed request. */
  isError?: boolean;
  provider?: string;
  model?: string;
  /** True while this turn is still being worked on. */
  isStreaming?: boolean;
}

const EMPTY_USAGE: TokenUsage = {
  input_tokens: 0,
  output_tokens: 0,
  total_tokens: 0,
  cost: 0,
  currency: 'USD',
};

let messageCounter = 0;
const nextId = () => `m${++messageCounter}`;

export function useChat(conversationId: string | null) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const username = useAuthStore((state) => state.username);

  // Forces a reload of the thread already on screen — after a poll lands, or
  // after a load failed. Deliberately local: it is this hook's own business,
  // not something another component should be able to trigger.
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isPending, setIsPending] = useState(false);
  const [usage, setUsage] = useState<TokenUsage>(EMPTY_USAGE);
  const [isRestoring, setIsRestoring] = useState(false);
  // Set to a conversation id when it has an interaction the server is still
  // working on — see the poll effect below.
  const [pollFor, setPollFor] = useState<string | null>(null);

  // A ref as well as the store: the send callback needs the value at call
  // time, not the one captured when it was created.
  const conversationRef = useRef<string | null>(conversationId);
  const abortRef = useRef<AbortController | null>(null);

  /**
   * The thread whose transcript is already on screen.
   *
   * Load-bearing. The first question of a new thread gets its id from the
   * server *mid-stream*, and storing that id changes `conversationId` — which
   * would otherwise re-run the effect below, refetch a conversation whose
   * answer has not been written yet, and replace the live message with the
   * question alone. The answer would then arrive for a message id that no
   * longer existed and be dropped, which is why the first reply of a
   * conversation went missing until the thread was reopened.
   */
  const loadedRef = useRef<string | null>(conversationId);
  // The reload token last acted on. A bump means someone asked for this
  // thread explicitly — re-selecting the open one from the sidebar — and that
  // must still refetch, so it overrides the guard above.
  const tokenRef = useRef(reloadToken);

  /**
   * Load whichever conversation the store points at.
   *
   * Keyed on `reloadToken` as well as the id so that picking the same thread
   * again, or starting a new one, still runs. A conversation the server does
   * not recognise is dropped rather than retried — starting fresh is a fine
   * outcome and better than a wedged screen.
   */
  useEffect(() => {
    const id = conversationId;
    conversationRef.current = id;

    const wasAskedExplicitly = reloadToken !== tokenRef.current;
    tokenRef.current = reloadToken;

    // Already showing this thread — including the case above, where this
    // component is the reason the id changed.
    if (!wasAskedExplicitly && id && id === loadedRef.current) return;

    loadedRef.current = id;

    if (!id) {
      setMessages([]);
      setUsage(EMPTY_USAGE);
      return;
    }

    let cancelled = false;
    setIsRestoring(true);

    aiApi
      .getConversation(id)
      .then((detail) => {
        if (cancelled) return;
        setUsage(detail.usage);
        // One stored row is one exchange, so it unfolds into two bubbles.
        setMessages(
          detail.interactions.flatMap((item) => {
            const turns: ChatMessage[] = [
              { id: nextId(), role: 'user', text: item.query },
            ];

            if (item.status === 'pending') {
              // The server is still answering this one — the work outlives the
              // request that started it, so the answer is coming. Show it as
              // in-flight and let the poll below pick it up.
              turns.push({
                id: nextId(),
                role: 'assistant',
                text: '',
                steps: [{ id: 'resumed', label: 'Still working on this', done: false }],
                isStreaming: true,
              });
            } else if (item.status === 'pass' && item.response) {
              turns.push({
                id: nextId(),
                role: 'assistant',
                text: item.response,
                queries: item.queries,
                interaction: {
                  input_tokens: item.input_token,
                  output_tokens: item.output_tokens,
                  total_tokens: item.total_tokens,
                },
              });
            } else if (item.status === 'fail') {
              turns.push({
                id: nextId(),
                role: 'assistant',
                text: item.response || 'This question was not answered.',
                isError: true,
              });
            }
            return turns;
          }),
        );

        // Something is still being worked on server-side. Watch for it to
        // land — the alternative is a question sitting on screen with nothing
        // after it and no indication that an answer is on its way.
        if (detail.interactions.some((item) => item.status === 'pending')) {
          setPollFor(detail.id);
        } else {
          setPollFor(null);
        }
      })
      .catch(() => {
        // The thread is gone, or the server is unreachable. Clear the panel
        // and leave the URL alone: rewriting it here is what previously put
        // this in a fight with the address bar.
        if (cancelled) return;
        setMessages([]);
        setUsage(EMPTY_USAGE);
      })
      .finally(() => {
        if (!cancelled) setIsRestoring(false);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, reloadToken]);

  /**
   * Wait for an answer that is being worked out without us.
   *
   * The server runs the answer on its own thread, so a refresh mid-question
   * loses the live event stream but not the work. Re-attaching to that stream
   * would need buffering, replay and — with more than one worker — a shared
   * broker; polling for the finished row gets the answer on screen for a
   * fraction of that, and the only thing lost is watching the progress lines
   * tick over a second time.
   */
  useEffect(() => {
    if (!pollFor) return;

    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const detail = await aiApi.getConversation(pollFor);
        if (cancelled) return;
        if (detail.interactions.some((item) => item.status === 'pending')) return;

        // Landed. Reload the thread through the normal path so the finished
        // answer renders exactly as any other stored one.
        setPollFor(null);
        loadedRef.current = null;
        reload();
      } catch {
        // The thread was deleted, or the server is unreachable. Either way
        // there is nothing left to wait for.
        if (!cancelled) setPollFor(null);
      }
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pollFor, reload]);

  /** Rewrite the in-flight assistant message. */
  const patchLive = useCallback((liveId: string, patch: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === liveId ? patch(m) : m)));
  }, []);

  const send = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || isPending) return;

      const liveId = nextId();
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'user', text: trimmed },
        { id: liveId, role: 'assistant', text: '', steps: [], isStreaming: true },
      ]);
      setIsPending(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const addStep = (step: ChatStep) =>
        patchLive(liveId, (m) => ({ ...m, steps: [...(m.steps ?? []), step] }));

      const finishStep = (id: string, seconds: number, ok: boolean) =>
        patchLive(liveId, (m) => ({
          ...m,
          steps: (m.steps ?? []).map((s) =>
            s.id === id ? { ...s, seconds, ok, done: true } : s,
          ),
        }));

      const adopt = (id: string) => {
        if (conversationRef.current === id) return;
        conversationRef.current = id;
        // Claim it as already-loaded *before* changing the URL, so when the
        // new id arrives back as a prop the effect above sees its own value
        // and skips the refetch. Without this the live answer is replaced by
        // a half-written transcript — see loadedRef.
        loadedRef.current = id;
        // `replace`, so a brand-new thread learning its id does not add a
        // history entry — Back should leave the chat, not step through it.
        navigate(`/assistant/${id}`, { replace: true });
      };

      const onEvent = (event: ChatEvent) => {
        switch (event.type) {
          case 'conversation':
            // Arrives before any work, so a browser that navigates away
            // mid-answer still knows which thread it started.
            adopt(event.conversation_id);
            break;

          case 'round_start':
            addStep({
              id: `r${event.round}`,
              // Round one is the model reading the question; later rounds are
              // it reading what the last tool returned.
              label: event.round === 1 ? 'Reading the question' : 'Reviewing the results',
              done: false,
            });
            break;

          case 'round_thinking':
            finishStep(`r${event.round}`, event.seconds, true);
            break;

          case 'tool_start':
            addStep({
              id: `t${event.round}-${event.index}`,
              // The same wording the finished trace uses, so the live line and
              // the record it becomes are the one sentence.
              label: summarizeQuery({ tool: event.tool, input: event.input, error: false }).title,
              done: false,
            });
            break;

          case 'tool_end':
            finishStep(`t${event.round}-${event.index}`, event.seconds, event.ok);
            break;

          case 'done':
            adopt(event.conversation_id);
            setUsage(event.usage ?? EMPTY_USAGE);
            // The sidebar list now has a new thread, or a changed token total,
            // on the row it is already showing.
            queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
            patchLive(liveId, (m) => ({
              ...m,
              text: event.answer || 'The assistant returned an empty answer.',
              queries: event.queries,
              interaction: event.interaction,
              provider: event.provider,
              model: event.model,
              animate: true,
              isStreaming: false,
              // Any step still open never reported an end — mark them closed
              // so nothing spins forever after the answer has arrived.
              steps: (m.steps ?? []).map((s) => (s.done ? s : { ...s, done: true })),
            }));
            break;

          case 'error':
            patchLive(liveId, (m) => ({
              ...m,
              text: event.detail,
              isError: true,
              isStreaming: false,
            }));
            break;
        }
      };

      try {
        await aiApi.chatStream(
          { question: trimmed, conversation_id: conversationRef.current, username },
          onEvent,
          controller.signal,
        );
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') {
          // Cancelled by the user: drop the placeholder rather than leaving a
          // half-finished turn in the transcript. The question is still on the
          // server — the row is opened before the model is called — so a
          // reload will show it again, which is the honest state.
          setMessages((prev) => prev.filter((m) => m.id !== liveId));
        } else {
          patchLive(liveId, (m) => ({
            ...m,
            text: (error as Error).message,
            isError: true,
            isStreaming: false,
          }));
        }
      } finally {
        abortRef.current = null;
        setIsPending(false);
      }
    },
    [isPending, navigate, patchLive, queryClient, username],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    navigate('/assistant');
  }, [navigate]);

  return {
    messages,
    send,
    stop,
    reset,
    isPending,
    isRestoring,
    usage,
    conversationId,
    hasConversation: messages.length > 0,
  };
}
