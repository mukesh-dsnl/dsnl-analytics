import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, MessageSquarePlus, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import { aiApi } from '../api';
import type { ConversationSummary } from '../api';
import { useChatStore } from '../store';
import { useAuthStore } from '../../../store';

interface ConversationListProps {
  isCollapsed: boolean;
}

export const CONVERSATIONS_KEY = ['ai-conversations'] as const;

/** One row: select it, rename it in place, or archive it. */
function ConversationRow({
  conversation,
  isActive,
  onSelect,
  onRename,
  onDelete,
}: {
  conversation: ConversationSummary;
  isActive: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState(conversation.title ?? '');
  const rowRef = useRef<HTMLLIElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close the menu on any click outside it. Without this a menu left open in
  // one row stays open while you work in another.
  useEffect(() => {
    if (!menuOpen && !confirming) return;
    const onDocumentClick = (event: MouseEvent) => {
      if (!rowRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
        setConfirming(false);
      }
    };
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, [menuOpen, confirming]);

  useEffect(() => {
    if (isEditing) inputRef.current?.select();
  }, [isEditing]);

  const commitRename = () => {
    const next = draft.trim();
    setIsEditing(false);
    if (next && next !== conversation.title) onRename(next);
    else setDraft(conversation.title ?? '');
  };

  if (isEditing) {
    return (
      <li ref={rowRef} className="px-1">
        <div className="flex items-center gap-1 rounded-xl bg-white/15 px-2 py-1.5">
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitRename();
              if (event.key === 'Escape') {
                setDraft(conversation.title ?? '');
                setIsEditing(false);
              }
            }}
            aria-label="Conversation name"
            className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder:text-white/50
                       focus:outline-none"
          />
          <button
            type="button"
            onClick={commitRename}
            aria-label="Save name"
            className="p-1 rounded text-white/80 hover:text-white hover:bg-white/20"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(conversation.title ?? '');
              setIsEditing(false);
            }}
            aria-label="Cancel rename"
            className="p-1 rounded text-white/80 hover:text-white hover:bg-white/20"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </li>
    );
  }

  return (
    <li ref={rowRef} className="relative group">
      <button
        type="button"
        onClick={onSelect}
        title={conversation.title ?? 'Untitled chat'}
        className={clsx(
          'w-full text-left pl-3 pr-9 py-2 rounded-xl text-sm transition-colors min-w-0',
          isActive
            ? 'bg-white/20 text-white font-medium'
            : 'text-white/75 hover:text-white hover:bg-white/10',
        )}
      >
        <span className="block truncate">{conversation.title ?? 'Untitled chat'}</span>
      </button>

      {/* Revealed on hover or focus, and kept mounted while its menu is open
          so the menu doesn't vanish as the pointer travels to it. */}
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-label="Conversation options"
        aria-expanded={menuOpen}
        className={clsx(
          'absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-opacity',
          'text-white/70 hover:text-white hover:bg-white/20',
          menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100',
        )}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {menuOpen && (
        // Light surface, not the brand blue: this is a menu over the sidebar,
        // and it reads as the same kind of object as the app's other popovers.
        <div
          className="absolute right-1 top-full z-40 mt-1 w-40 rounded-lg py-1
                     bg-white dark:bg-surface-dark
                     border border-zinc-200 dark:border-zinc-700
                     shadow-lg shadow-black/25"
        >
          {!confirming ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setDraft(conversation.title ?? '');
                  setIsEditing(true);
                  setMenuOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs
                           text-zinc-700 dark:text-zinc-300
                           hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
              >
                <Pencil className="w-3.5 h-3.5" />
                Rename
              </button>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs
                           text-red-600 dark:text-red-400
                           hover:bg-red-50 dark:hover:bg-red-950/30"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            </>
          ) : (
            <div className="px-3 py-2">
              <p className="text-[11px] text-zinc-600 dark:text-zinc-400 mb-2">
                Delete this chat? It is archived, not erased.
              </p>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirming(false);
                    onDelete();
                  }}
                  className="flex-1 rounded px-2 py-1 text-[11px] font-medium text-white bg-red-600 hover:bg-red-500"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="flex-1 rounded px-2 py-1 text-[11px] font-medium
                             text-zinc-600 dark:text-zinc-300
                             hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Past chats, in the sidebar, while the chat is open.
 *
 * Styled from the same white-on-brand vocabulary the analytics nav uses —
 * this replaces what sits in that column, it does not introduce a second look
 * for it. The active row takes the same filled pill an active nav item does.
 */
export function ConversationList({ isCollapsed }: ConversationListProps) {
  const queryClient = useQueryClient();
  const username = useAuthStore((state) => state.username);
  const conversationId = useChatStore((state) => state.conversationId);
  const select = useChatStore((state) => state.select);
  const startNew = useChatStore((state) => state.startNew);

  const { data, isLoading } = useQuery({
    queryKey: [...CONVERSATIONS_KEY, username],
    queryFn: () => aiApi.listConversations(username),
    // A new thread appears as soon as its first answer lands, so this is
    // refetched on mount rather than trusted indefinitely.
    staleTime: 10_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      aiApi.renameConversation(id, title),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (id: string) => aiApi.deleteConversation(id),
    onSuccess: (_data, id) => {
      // Deleting the thread you are reading has to clear the panel too,
      // otherwise the transcript stays on screen with nothing behind it.
      if (id === conversationId) startNew();
      refresh();
    },
  });

  const conversations = data ?? [];

  if (isCollapsed) {
    // The rail has no room for titles; only the "new chat" affordance survives.
    return (
      <div className="px-3 py-6">
        <button
          type="button"
          onClick={startNew}
          title="New chat"
          aria-label="New chat"
          className="w-full flex items-center justify-center py-2.5 rounded-xl text-white/80 hover:text-white hover:bg-white/15 transition-colors"
        >
          <MessageSquarePlus className="w-5 h-5" />
        </button>
      </div>
    );
  }

  return (
    <div className="py-6 px-3 space-y-1">
      <button
        type="button"
        onClick={startNew}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
                   text-white/90 hover:text-white hover:bg-white/15 transition-colors"
      >
        <MessageSquarePlus className="w-5 h-5 shrink-0" />
        <span className="whitespace-nowrap">New chat</span>
      </button>

      <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wide text-white/50">
        Recent
      </p>

      {isLoading && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-white/60">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading…
        </div>
      )}

      {!isLoading && conversations.length === 0 && (
        <p className="px-3 py-2 text-xs text-white/60">
          No chats yet. Ask a question to start one.
        </p>
      )}

      <ul className="space-y-0.5">
        {conversations.map((conversation) => (
          <ConversationRow
            key={conversation.id}
            conversation={conversation}
            isActive={conversation.id === conversationId}
            onSelect={() => select(conversation.id)}
            onRename={(title) => rename.mutate({ id: conversation.id, title })}
            onDelete={() => remove.mutate(conversation.id)}
          />
        ))}
      </ul>
    </div>
  );
}
