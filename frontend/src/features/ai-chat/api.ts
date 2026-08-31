/**
 * AI chat API layer.
 *
 * One endpoint, and it is stateless: the server keeps no session, so the
 * conversation lives here and is sent back with every question. That is why
 * `history` is round-tripped opaquely — its shape is the backend's neutral
 * message format, and nothing in this module reads into it beyond passing it
 * along. Treating it as an opaque token is what lets the backend change
 * provider without this file changing at all.
 */

const API_BASE = '/api/ai';

/** One tool the model ran while answering — what the figure was built from. */
export interface ChatQuery {
  tool: string;
  input: Record<string, unknown>;
  error: boolean;
}

/**
 * A conversation turn as the server stores it. Opaque by design: it goes back
 * out exactly as it came in.
 */
export interface ChatHistoryEntry {
  role: 'user' | 'assistant';
  text: string | null;
  tool_calls?: unknown[];
  tool_results?: unknown[];
}

export interface ChatResponse {
  answer: string;
  provider: string;
  model: string;
  /**
   * Empty on a refusal, which is the correct outcome for a question this data
   * can't answer — an answer with no queries behind it means the model
   * declined to look, not that it failed.
   */
  queries: ChatQuery[];
  history: ChatHistoryEntry[];
}

export interface ChatRequest {
  question: string;
  history: ChatHistoryEntry[];
}

/** Progress events from POST /api/ai/chat/stream. `done` always arrives last. */
export type ChatEvent =
  | { type: 'round_start'; round: number }
  | { type: 'round_thinking'; round: number; seconds: number }
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
