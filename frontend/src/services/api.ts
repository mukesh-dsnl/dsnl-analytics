const API_BASE = '/api';

/**
 * Raised for any 401 from the API.
 *
 * Distinguished from an ordinary failure because it means something specific
 * and recoverable — the session is gone, and the only useful response is to
 * send the user back to sign in. See `onUnauthorized`.
 */
export class Unauthorized extends Error {
  constructor(message = 'Your session has ended. Please sign in again.') {
    super(message);
    this.name = 'Unauthorized';
  }
}

/**
 * Any non-401 failure, carrying the status so callers can tell the cases apart.
 *
 * A plain Error only carried the server's prose, which meant "this thread does
 * not exist or is not yours" was indistinguishable from "the server is down" —
 * and the two need opposite responses: forget the conversation, or keep it and
 * retry.
 */
export class ApiError extends Error {
  // Declared and assigned rather than a constructor parameter property: this
  // project builds with `erasableSyntaxOnly`, which forbids the shorthand.
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

/**
 * Register what should happen when any request comes back 401.
 *
 * Set once, by the auth store. A session can expire between two clicks, and
 * without this the app would show empty panels and failed queries with no
 * explanation — each call site would have to recognise the same condition and
 * react to it identically, which is the definition of something belonging in
 * one place.
 */
export function onUnauthorized(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

/**
 * Fire the handler directly.
 *
 * For responses that cannot go through `handle` — the SSE stream, whose body
 * is not a JSON document. Without this the chat would throw on an expired
 * session but never tell the store, leaving the app rendering a signed-in
 * shell whose every other request also fails.
 */
export function notifyUnauthorized(): void {
  unauthorizedHandler?.();
}

/**
 * The single place a response is turned into either data or an error.
 *
 * Every fetch in the app goes through this, so a 401 is noticed exactly once
 * no matter which endpoint produced it.
 */
export async function handle<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    const body = await res.json().catch(() => ({}));
    notifyUnauthorized();
    throw new Unauthorized(body.detail || undefined);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail || `Request failed (${res.status})`);
  }
  // 204 and friends have no body to parse.
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface Me {
  username: string;
  user_id: string | null;
}

export const api = {
  // --- Auth ---
  /**
   * Exchange credentials for a session cookie.
   *
   * Nothing is returned that the client needs to keep. The cookie is httpOnly,
   * so this code cannot read it and does not have to: the browser attaches it
   * to every subsequent request on its own.
   */
  login: async (username: string, password: string): Promise<Me> => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      // Deliberately not routed through `handle`: a 401 here means "wrong
      // password", which belongs on the form, not in the session-expired path.
      throw new Error(body.detail || 'Invalid username or password');
    }
    return res.json();
  },

  /** Destroy the session server-side and clear the cookie. */
  logout: async (): Promise<void> => {
    await fetch(`${API_BASE}/auth/logout`, { method: 'POST' }).catch(() => {
      // The local session is being cleared regardless. A network failure here
      // leaves a row on the server that will expire on its own; refusing to
      // sign the user out locally would be the worse outcome.
    });
  },

  /**
   * Who the cookie belongs to. 401 when there is no live session.
   *
   * This is the app's source of truth for "am I signed in" — asked of the
   * server on boot rather than remembered locally, because only the server
   * knows whether the session still exists.
   */
  me: async (): Promise<Me> => {
    const res = await fetch(`${API_BASE}/auth/me`);
    if (res.status === 401) throw new Unauthorized();
    return handle<Me>(res);
  },
};
