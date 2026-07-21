'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, Facebook, MoreVertical, RefreshCcw, StickyNote } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'
import type { GraphqlSubscriptionClient } from '@/lib/graphql-subscription'
import type { Message } from '@/services/inbox.service'
import { getMessages, sendMessage as apiSendMessage, markAsRead } from '@/services/inbox.service'
import { MessageBubble } from './MessageBubble'
import { MessageComposer } from './MessageComposer'
import { InternalNoteBadge } from './InternalNoteBadge'

const POLL_INTERVAL_MS = 3000

const MESSAGE_FIELDS = `
  id conversationId senderId senderType content messageType metadata internalNote
  sentAt deliveredAt readAt createdAt
`

type ConversationDetailProps = {
  conversationId: string
  contactName: string
  status: string
  channel?: string
  className?: string
  onBack?: () => void
  /** Shared subscription client from the inbox page — used to deliver new
   * messages instantly via WebSocket instead of waiting for the poll. */
  wsClient?: GraphqlSubscriptionClient | null
}

export function ConversationDetail({
  conversationId,
  contactName,
  status,
  channel,
  className,
  onBack,
  wsClient,
}: ConversationDetailProps): React.JSX.Element {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [internalNoteMode, setInternalNoteMode] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const initializedRef = useRef(false)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const currentUser = useAuthStore((s) => s.user)

  const fetchMessages = useCallback(
    async (showLoading = true) => {
      if (showLoading) {
        setLoading(true)
      }
      setError(null)
      try {
        const result = await getMessages(conversationId)
        setMessages(result.items)
        setHasMore(result.hasMore)
        setNextCursor(result.nextCursor)
      } catch {
        setError('Failed to load messages')
      } finally {
        if (showLoading) {
          setLoading(false)
        }
      }
    },
    [conversationId],
  )

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true
    }
    fetchMessages(true)
  }, [fetchMessages])

  // Polling for real-time updates (fallback/reconciliation — WS subscription
  // below is the primary delivery path when connected)
  useEffect(() => {
    // Start polling after initial load
    pollTimerRef.current = setInterval(() => {
      fetchMessages(false)
    }, POLL_INTERVAL_MS)

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [fetchMessages])

  // Real-time message delivery via WebSocket — append directly instead of
  // refetching the whole thread, so an incoming message doesn't flash/reload
  // the message list.
  useEffect(() => {
    if (!wsClient) return

    const unsubscribe = wsClient.subscribe(`messages:${conversationId}`, {
      query: `subscription OnNewMessage($conversationId: ID!) {
        onNewMessage(conversationId: $conversationId) { ${MESSAGE_FIELDS} }
      }`,
      variables: { conversationId },
      onData: (data: { onNewMessage: Message }) => {
        const incoming = data.onNewMessage
        setMessages((prev) => {
          if (prev.some((m) => m.id === incoming.id)) return prev
          return [...prev, incoming]
        })
      },
    })

    return unsubscribe
  }, [wsClient, conversationId])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Auto-mark messages from others as read (enables Đã xem status)
  useEffect(() => {
    if (!currentUser || messages.length === 0) return
    const unreadFromOthers = messages.filter(
      (m) => m.senderId !== currentUser.userId && !m.readAt && !m.id.startsWith('optimistic-'),
    )
    if (unreadFromOthers.length > 0) {
      markAsRead(
        conversationId,
        unreadFromOthers.map((m) => m.id),
      ).catch(() => {})
    }
  }, [messages, conversationId, currentUser])

  async function loadMore(): Promise<void> {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const result = await getMessages(conversationId, { cursor: nextCursor, limit: 50 })
      setMessages((prev) => [...result.items, ...prev])
      setHasMore(result.hasMore)
      setNextCursor(result.nextCursor)
    } catch {
      // silently fail
    } finally {
      setLoadingMore(false)
    }
  }

  async function handleSend(
    content: string,
    options?: { metadata?: Record<string, unknown> },
  ): Promise<void> {
    const user = useAuthStore.getState().user
    if (!user) throw new Error('Not authenticated')

    const metadataString = options?.metadata ? JSON.stringify(options.metadata) : undefined

    // AC #8: a composer-built Facebook template must actually be delivered as
    // a template attachment, not silently sent as plain text — the mapper's
    // TEMPLATE case only fires when messageType is 'TEMPLATE'.
    const messageType = internalNoteMode
      ? 'INTERNAL_NOTE'
      : options?.metadata?.['template']
        ? 'TEMPLATE'
        : 'TEXT'

    // Optimistic update — add message to UI immediately
    const optimisticMsg: Message = {
      id: `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      conversationId,
      senderId: user.userId,
      senderType: 'AGENT',
      content,
      messageType,
      internalNote: internalNoteMode,
      metadata: metadataString ?? null,
      sentAt: new Date().toISOString(),
      deliveredAt: null,
      readAt: null,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimisticMsg])

    try {
      const serverMsg = await apiSendMessage({
        conversationId,
        senderId: user.userId,
        senderType: 'AGENT',
        content,
        messageType,
        metadata: metadataString,
      })

      // Immediately replace optimistic message with real server message (Sending → Sent)
      setMessages((prev) => prev.map((m) => (m.id === optimisticMsg.id ? serverMsg : m)))

      if (internalNoteMode) {
        setInternalNoteMode(false)
      }
      // Background refresh to get final delivery state
      fetchMessages(false)
    } catch {
      // Remove optimistic message on failure
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id))
    }
  }

  const initials = contactName
    .split(' ')
    .map((n) => n.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <div className={cn('flex flex-col h-full bg-white', className)}>
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 bg-white/95 backdrop-blur-xl px-4 py-3.5 lg:px-6 z-10 sticky top-0 shadow-sm">
        <div className="flex items-center gap-2.5">
          {onBack && (
            <button
              type="button"
              aria-label="Back to conversations"
              onClick={onBack}
              className="mr-1 flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors lg:hidden"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}

          <div className="relative">
            <div className="h-8 w-8 flex-shrink-0 rounded-full bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center text-xs font-bold tracking-wide text-white shadow-sm">
              {initials}
            </div>
            <div className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" />
          </div>

          <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-slate-900 tracking-tight leading-none ml-1">
            {contactName}
            {channel === 'FACEBOOK' && (
              <Facebook
                aria-label="Facebook Messenger conversation"
                className="h-3.5 w-3.5 text-blue-600"
              />
            )}
          </h2>
        </div>

        <div className="flex items-center gap-1.5 text-slate-500">
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-100 hover:text-slate-900 transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-phone"
            >
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          </button>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-100 hover:text-slate-900 transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-search"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </button>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-100 hover:text-slate-900 transition-colors"
          >
            <MoreVertical className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-6 lg:px-8 relative bg-white"
        style={{
          backgroundImage: 'radial-gradient(#e2e8f0 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      >
        {loading ? (
          <div className="flex flex-col gap-6 max-w-3xl mx-auto">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className={cn('flex w-full', i % 2 === 0 ? 'justify-start' : 'justify-end')}
              >
                <div
                  className={cn(
                    'h-16 w-64 animate-pulse rounded-2xl bg-white shadow-sm border border-slate-100/50',
                    i % 2 === 0 ? 'rounded-tl-[4px]' : 'rounded-tr-[4px]',
                  )}
                />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-500 mb-2 shadow-sm">
              <RefreshCcw className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium text-slate-700">{error}</p>
            <button
              type="button"
              onClick={() => fetchMessages(true)}
              className="mt-2 rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white shadow-md hover:bg-slate-800 transition-all hover:scale-105"
            >
              Try Again
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center pb-20 bg-white">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-500 mb-4 shadow-sm ring-4 ring-white">
              <span className="text-2xl">👋</span>
            </div>
            <p className="text-[17px] font-bold text-slate-900 tracking-tight">
              Start the conversation
            </p>
            <p className="mt-1.5 text-[15px] text-slate-500 max-w-sm">
              Send a friendly message to begin chatting with {contactName}.
            </p>
          </div>
        ) : (
          <div className="flex flex-col max-w-4xl mx-auto pb-4">
            {/* Load earlier messages */}
            {hasMore && (
              <div className="mb-6 text-center">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-full border border-slate-200/80 bg-white/90 backdrop-blur-sm px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 transition-all"
                >
                  {loadingMore ? 'Loading earlier...' : 'Load earlier messages'}
                </button>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              {messages.map((msg, index, arr) => {
                const prevMsg = index > 0 ? arr[index - 1] : null
                const isDifferentSender = prevMsg && prevMsg.senderId !== msg.senderId
                // Find the last message sent by the current user
                const isMine = currentUser
                  ? msg.senderId === currentUser.userId
                  : msg.senderType === 'AGENT'
                const isLastFromMe =
                  isMine &&
                  !arr
                    .slice(index + 1)
                    .some((m) =>
                      currentUser ? m.senderId === currentUser.userId : m.senderType === 'AGENT',
                    )

                // Messenger-style seen avatar: show under the last of "my" messages that has readAt
                const showSeenAvatar =
                  isMine &&
                  !!msg.readAt &&
                  // Only on the LAST read message from me (no later read message from me)
                  !arr
                    .slice(index + 1)
                    .some(
                      (m) =>
                        (currentUser
                          ? m.senderId === currentUser.userId
                          : m.senderType === 'AGENT') && m.readAt,
                    )

                return (
                  <div key={msg.id} className={cn(isDifferentSender ? 'mt-4' : '')}>
                    <MessageBubble
                      message={msg}
                      currentUserId={currentUser?.userId}
                      isLastFromMe={isLastFromMe}
                      showSeenAvatar={showSeenAvatar}
                      seenByName={contactName}
                    />
                  </div>
                )
              })}
            </div>
            <div ref={bottomRef} className="h-4" />
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 z-10 relative bg-white">
        {/* Internal note toggle */}
        <div className="flex items-center justify-between px-4 pt-2 pb-1">
          <div className="flex items-center gap-2">{internalNoteMode && <InternalNoteBadge />}</div>
          <button
            type="button"
            onClick={() => setInternalNoteMode((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition-colors',
              internalNoteMode
                ? 'bg-amber-100 text-amber-700 border border-amber-200'
                : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50',
            )}
            title="Toggle internal note"
          >
            <StickyNote className="h-3.5 w-3.5" />
            {internalNoteMode ? 'Note active' : 'Internal note'}
          </button>
        </div>
        <MessageComposer
          onSend={handleSend}
          disabled={status === 'ARCHIVED' || status === 'RESOLVED'}
          channel={channel}
        />
      </div>
    </div>
  )
}
