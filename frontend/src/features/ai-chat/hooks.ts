/**
 * Conversation state for the AI chat.
 *
 * The transcript lives on the server. What this hook keeps is:
 *
 *   `messages`       — what is on screen, including the pending question, the
 *                      live progress steps, and any error bubble. The server
 *                      knows about none of those three.
 *   `conversationId` — the only thing sent back with the next question.
 *   `usage`          — the running token totals, as reported by the server.
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
import { aiApi } from './api';
import type { ChatEvent, ChatQuery, TokenUsage } from './api';
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
  /** True for the bubble that reports a failed request. */
  isError?: boolean;
  provider?: string;
  model?: string;
  /** True while this turn is still being worked on. */
  isStreaming?: boolean;
}

const EMPTY_USAGE: TokenUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

/** Survives a refresh, so the open thread is still the open thread. */
const STORAGE_KEY = 'ai-chat-conversation-id';

let messageCounter = 0;
const nextId = () => `m${++messageCounter}`;

export function useChat() {
  const username = useAuthStore((state) => state.username);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isPending, setIsPending] = useState(false);
  const [usage, setUsage] = useState<TokenUsage>(EMPTY_USAGE);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  // A ref as well as state: the send callback needs the value at call time,
  // not the one captured when it was created.
  const conversationRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const adoptConversation = useCallback((id: string) => {
    conversationRef.current = id;
    setConversationId(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Private browsing, or storage disabled. The thread still works for as
      // long as the tab is open; it just won't survive a refresh.
    }
  }, []);

  // Restore the thread that was open last time. Runs once; a failure here is
  // not worth surfacing, since starting a fresh conversation is a fine outcome.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    if (!stored) return;

    let cancelled = false;
    setIsRestoring(true);

    aiApi
      .getConversation(stored)
      .then((detail) => {
        if (cancelled) return;
        conversationRef.current = detail.id;
        setConversationId(detail.id);
        setUsage(detail.usage);
        setMessages(
          detail.messages.map((m) => ({
            id: nextId(),
            role: m.role,
            text: m.text,
            queries: m.role === 'assistant' ? m.queries : undefined,
          })),
        );
      })
      .catch(() => {
        // The thread is gone (or the server was reset) — forget it rather than
        // sending an id the server will not recognise.
        try {
          window.localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* nothing to clean up */
        }
      })
      .finally(() => {
        if (!cancelled) setIsRestoring(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
          case 'conversation':
            // Arrives before any work, so a browser that navigates away
            // mid-answer still knows which thread it started.
            adoptConversation(event.conversation_id);
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
            adoptConversation(event.conversation_id);
            setUsage(event.usage ?? EMPTY_USAGE);
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
        await aiApi.chatStream(
          { question: trimmed, conversation_id: conversationRef.current, username },
          onEvent,
          controller.signal,
        );
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') {
          // Cancelled by the user: drop the placeholder rather than leaving a
          // half-finished turn in the transcript. The question is still on the
          // server — it is written before the model is called — so a reload
          // will show it again, which is the honest state.
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
    [adoptConversation, isPending, patchLive, username],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    // The thread is not deleted, only let go of: it stays on the server as a
    // record, and the next question starts a new one.
    conversationRef.current = null;
    setConversationId(null);
    setUsage(EMPTY_USAGE);
    setMessages([]);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* nothing to clean up */
    }
  }, []);

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
