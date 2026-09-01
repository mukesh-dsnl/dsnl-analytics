/**
 * Which conversation is open.
 *
 * Hoisted out of the chat page because two things now decide it: the page
 * itself (a new question adopts the id the server returns) and the sidebar
 * list (picking a past thread). They are siblings under the layout, so they
 * cannot share it through props.
 *
 * Persisted, so the thread that was open survives a refresh — the transcript
 * itself lives on the server and is fetched from this id.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ChatState {
  conversationId: string | null;
  /** Bumped to ask the page to reload from the server. */
  reloadToken: number;
  select: (id: string) => void;
  startNew: () => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      conversationId: null,
      reloadToken: 0,

      // Picking a thread from the list. The token change is what tells the
      // page to fetch it, including when the same thread is re-selected after
      // being edited elsewhere.
      select: (id) =>
        set((state) => ({ conversationId: id, reloadToken: state.reloadToken + 1 })),

      // The thread is not deleted, only let go of: it stays on the server as a
      // record, and the next question starts a new one.
      startNew: () =>
        set((state) => ({ conversationId: null, reloadToken: state.reloadToken + 1 })),
    }),
    { name: 'ai-chat-conversation' },
  ),
);
