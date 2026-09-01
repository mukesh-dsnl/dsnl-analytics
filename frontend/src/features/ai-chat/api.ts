/**
 * AI chat API layer.
 *
 * The chat is session-based: this module sends a `conversation_id` and the
 * server rebuilds the transcript from its own database. The browser therefore
 * holds an identifier, not the conversation — which is what lets a thread
 * survive a refresh, and what makes the token totals below authoritative
 * rather than a guess assembled on the client.
 *
 * A request with no `conversation_id` starts a new thread; the id to use from
 * then on comes back in the response (and, when streaming, in the very first
 * event, so a browser that navigates away mid-answer still knows which thread
 * it started).
 */

const API_BASE = '/api/ai';

/** One tool the model ran while answering — what the figure was built from. */
export interface ChatQuery {
  tool: string;
  input: Record<string, unknown>;
  error: boolean;
}

/** Running token totals for the whole conversation, not just one answer. */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  /** At the server's configured rates — an estimate, not a bill. */
  cost: number;
  currency: string;
}

/** What one exchange cost, as opposed to the thread's running total. */
export interface InteractionUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface ChatResponse {
  answer: string;
  conversation_id: string;
  provider: string;
  model: string;
  /**
   * Empty on a refusal, which is the correct outcome for a question this data
   * can't answer — an answer with no queries behind it means the model
   * declined to look, not that it failed.
   */
  queries: ChatQuery[];
  /** This exchange alone — shown under the answer. */
  interaction: InteractionUsage;
  /** The whole thread, including this exchange — shown on the cost card. */
  usage: TokenUsage;
}

export interface ChatRequest {
  question: string;
  /** Omit to start a new thread. */
  conversation_id?: string | null;
  /** Recorded for attribution; the server does not treat it as authentication. */
  username?: string | null;
}

/** One stored exchange: the question, its answer, and what it cost. */
export interface StoredInteraction {
  id: number;
  status: 'pass' | 'fail';
  query: string;
  response: string;
  queries: ChatQuery[];
  input_token: number;
  output_tokens: number;
  total_tokens: number;
  created_at?: string;
}

export interface ConversationSummary {
  id: string;
  title?: string;
  username?: string;
  user_id?: string;
  created_at?: string;
  updated_at?: string;
  message_count: number;
  usage: TokenUsage;
}

export interface ConversationDetail extends ConversationSummary {
  interactions: StoredInteraction[];
}

/**
 * Progress events from POST /api/ai/chat/stream.
 *
 * `conversation` arrives first (before any work, so the id can be adopted
 * immediately) and `done` always arrives last.
 */
export type ChatEvent =
  | { type: 'conversation'; conversation_id: string }
  | { type: 'round_start'; round: number }
  | {
      type: 'round_thinking';
      round: number;
      seconds: number;
      input_tokens: number;
      output_tokens: number;
    }
  | { type: 'tool_start'; round: number; index: number; tool: string; input: Record<string, unknown> }
  | { type: 'tool_end'; round: number; index: number; tool: string; ok: boolean; seconds: number }
  | ({ type: 'done' } & ChatResponse)
  | { type: 'error'; detail: string };

export const aiApi = {
  /**
   * Stream an answer, reporting each step as it happens.
   *
   * Hand-parsed SSE rather than `EventSource`, which is GET-only — the
   * question and the whole prior conversation go in the body, not the URL.
   *
   * The buffer is split on the blank line that terminates an SSE frame, and
   * whatever follows the last one is kept for the next chunk: a JSON payload
   * of any size can be cut mid-way by the network, and parsing a half-received
   * frame would throw on the largest and most important event, the answer.
   */
  chatStream: async (
    body: ChatRequest,
    onEvent: (event: ChatEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> => {
    const res = await fetch(`${API_BASE}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const detail = await res
        .json()
        .then((b) => b?.detail)
        .catch(() => null);
      if (res.status === 503) {
        throw new Error(detail || 'AI chat is not configured on the server.');
      }
      throw new Error(detail || `The assistant could not answer that (HTTP ${res.status}).`);
    }

    if (!res.body) throw new Error('The server sent no response body.');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const drain = (chunk: string, isFinal: boolean) => {
      buffer += chunk;
      const frames = buffer.split('\n\n');
      // The trailing element is an incomplete frame unless this is the end.
      buffer = isFinal ? '' : (frames.pop() ?? '');

      for (const frame of frames) {
        const line = frame.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        try {
          onEvent(JSON.parse(line.slice(6)) as ChatEvent);
        } catch {
          // A malformed frame costs one progress line, not the answer.
        }
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      drain(decoder.decode(value, { stream: true }), false);
    }
    drain(decoder.decode(), true);
  },

  /** Recent threads, newest first. */
  listConversations: async (username?: string | null): Promise<ConversationSummary[]> => {
    const query = username ? `?username=${encodeURIComponent(username)}` : '';
    const res = await fetch(`${API_BASE}/conversations${query}`);
    if (!res.ok) throw new Error('Could not load past conversations.');
    return res.json();
  },

  /** One thread and its messages — what the UI restores a conversation from. */
  getConversation: async (id: string): Promise<ConversationDetail> => {
    const res = await fetch(`${API_BASE}/conversations/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error('Could not load that conversation.');
    return res.json();
  },

  /** Give a thread a name of its own instead of its opening question. */
  renameConversation: async (id: string, title: string): Promise<ConversationSummary> => {
    const res = await fetch(`${API_BASE}/conversations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) throw new Error('Could not rename that conversation.');
    return res.json();
  },

  /**
   * Remove a thread from the list.
   *
   * The server moves it, transcript and all, into an archive table rather than
   * destroying it — so this is reversible in the database even though the UI
   * offers no undo.
   */
  deleteConversation: async (id: string): Promise<void> => {
    const res = await fetch(`${API_BASE}/conversations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Could not delete that conversation.');
  },

  chat: async (body: ChatRequest): Promise<ChatResponse> => {
    const res = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res
        .json()
        .then((b) => b?.detail)
        .catch(() => null);

      // 503 is configuration, not failure, and its detail names the env var to
      // set — worth surfacing verbatim rather than flattening to "request
      // failed", since it tells whoever is running this exactly what to do.
      if (res.status === 503) {
        throw new Error(detail || 'AI chat is not configured on the server.');
      }
      throw new Error(detail || `The assistant could not answer that (HTTP ${res.status}).`);
    }

    return res.json();
  },
};
