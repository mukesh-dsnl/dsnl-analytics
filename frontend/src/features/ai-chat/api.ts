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

export const aiApi = {
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
