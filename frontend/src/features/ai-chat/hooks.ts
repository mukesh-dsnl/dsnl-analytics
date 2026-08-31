/**
 * Conversation state for the AI chat.
 *
 * Two representations, deliberately separate:
 *
 *   `messages` — what the user sees. Includes the pending question and any
 *                error bubble, neither of which the server knows about.
 *   `history`  — what the server sees. Only turns it produced, passed back
 *                verbatim.
 *
 * Keeping them apart is what lets a failed question stay on screen (so the
 * user can read what they asked and retry) without that failure entering the
 * conversation the model is given. Replaying a question the server never
 * answered would have it answer it twice.
 */

import { useCallback, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { aiApi } from './api';
import type { ChatHistoryEntry, ChatQuery, ChatResponse } from './api';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Assistant turns only — the tool calls behind the answer. */
  queries?: ChatQuery[];
  /** True for the bubble that reports a failed request. */
  isError?: boolean;
  provider?: string;
  model?: string;
}

let messageCounter = 0;
const nextId = () => `m${++messageCounter}`;

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // A ref, not state: it is never rendered, and reading it inside the mutation
  // must give the value at send time rather than the one captured when the
  // callback was created.
  const historyRef = useRef<ChatHistoryEntry[]>([]);

  const mutation = useMutation<ChatResponse, Error, string>({
    mutationFn: (question) => aiApi.chat({ question, history: historyRef.current }),
    onSuccess: (data) => {
      historyRef.current = data.history;
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          text: data.answer || 'The assistant returned an empty answer.',
          queries: data.queries,
          provider: data.provider,
          model: data.model,
        },
      ]);
    },
    onError: (error) => {
      // Not added to `history` — see the module docstring.
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'assistant', text: error.message, isError: true },
      ]);
    },
  });

  const { mutate } = mutation;

  const send = useCallback(
    (question: string) => {
      const trimmed = question.trim();
      if (!trimmed) return;
      setMessages((prev) => [...prev, { id: nextId(), role: 'user', text: trimmed }]);
      mutate(trimmed);
    },
    [mutate],
  );

  const reset = useCallback(() => {
    historyRef.current = [];
    setMessages([]);
  }, []);

  return {
    messages,
    send,
    reset,
    isPending: mutation.isPending,
    hasConversation: messages.length > 0,
  };
}
