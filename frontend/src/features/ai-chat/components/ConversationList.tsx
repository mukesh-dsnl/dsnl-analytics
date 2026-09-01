import { useQuery } from '@tanstack/react-query';
import { Loader2, MessageSquarePlus } from 'lucide-react';
import clsx from 'clsx';
import { aiApi } from '../api';
import { useChatStore } from '../store';
import { useAuthStore } from '../../../store';

interface ConversationListProps {
  isCollapsed: boolean;
}

export const CONVERSATIONS_KEY = ['ai-conversations'] as const;

/**
 * Past chats, in the sidebar, while the chat is open.
 *
 * Styled from the same white-on-brand vocabulary the analytics nav uses —
 * this replaces what sits in that column, it does not introduce a second look
 * for it. The active row takes the same filled pill an active nav item does.
 */
export function ConversationList({ isCollapsed }: ConversationListProps) {
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
        {conversations.map((conversation) => {
          const isActive = conversation.id === conversationId;
          return (
            <li key={conversation.id}>
              <button
                type="button"
                onClick={() => select(conversation.id)}
                title={conversation.title ?? 'Untitled chat'}
                className={clsx(
                  'w-full text-left px-3 py-2 rounded-xl text-sm transition-colors min-w-0',
                  isActive
                    ? 'bg-white/20 text-white font-medium'
                    : 'text-white/75 hover:text-white hover:bg-white/10',
                )}
              >
                <span className="block truncate">
                  {conversation.title ?? 'Untitled chat'}
                </span>
                <span className="block text-[10px] text-white/50 tabular-nums">
                  {conversation.message_count}{' '}
                  {conversation.message_count === 1 ? 'exchange' : 'exchanges'}
                  {conversation.usage.total_tokens > 0 &&
                    ` · ${conversation.usage.total_tokens.toLocaleString()} tokens`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
