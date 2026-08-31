/**
 * Conversation state for the AI chat.
 *
 * Three representations, deliberately separate:
 *
 *   `messages` — what the user sees. Includes the pending question, the live
 *                progress steps, and any error bubble; the server knows about
 *                none of those.
 *   `history`  — what the server sees. Only turns it produced, passed back
 *                verbatim.
 *   `steps`    — what the assistant did to reach the answer, one line per
 *                round or tool call, with its own duration.
 *
 * Keeping the first two apart is what lets a failed question stay on screen
 * (so the user can read what they asked and retry) without that failure
 * entering the conversation the model is given. Replaying a question the
 * server never answered would have it answer it twice.
 *
 * The steps are kept on the message rather than in page state so they survive
 * as part of the transcript: after the answer lands they stop being progress
 * and become the record of how it was reached.
 */

import { useCallback, useRef, useState } from 'react';
import { aiApi } from './api';
import type { ChatEvent, ChatHistoryEntry, ChatQuery } from './api';
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
  /** True for the bubble that reports a failed request. */
  isError?: boolean;
  provider?: string;
  model?: string;
  /** True while this turn is still being worked on. */
  isStreaming?: boolean;
}

let messageCounter = 0;
const nextId = () => `m${++messageCounter}`;

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isPending, setIsPending] = useState(false);
  // A ref, not state: it is never rendered, and reading it at send time must
  // give the current value rather than the one captured when the callback was
  // created.
  const historyRef = useRef<ChatHistoryEntry[]>([]);
  const abortRef = useRef<AbortController | null>(null);

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

      const onEvent = (event: ChatEvent) => {
        switch (event.type) {
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
            historyRef.current = event.history;
            patchLive(liveId, (m) => ({
              ...m,
              text: event.answer || 'The assistant returned an empty answer.',
              queries: event.queries,
              provider: event.provider,
              model: event.model,
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
        await aiApi.chatStream({ question: trimmed, history: historyRef.current }, onEvent, controller.signal);
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') {
          // Cancelled by the user: drop the placeholder rather than leaving a
          // half-finished turn in the transcript.
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
    [isPending, patchLive],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    historyRef.current = [];
    setMessages([]);
  }, []);

  return {
    messages,
    send,
    stop,
    reset,
    isPending,
    hasConversation: messages.length > 0,
  };
}
