'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Archive, ChevronLeft, Facebook, RefreshCcw, StickyNote, UserPlus } from 'lucide-react'
import toast from 'react-hot-toast'

import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { GraphqlSubscriptionClient } from '@/lib/graphql-subscription'
import type { AgentInfo, Message } from '@/services/inbox.service'
import {
  archiveConversation,
  assignConversation,
  getInternalAgents,
  getMessages,
  markAsRead,
  resolveConversation,
  sendMessage as apiSendMessage,
} from '@/services/inbox.service'
import { MessageBubble } from './MessageBubble'
import { MessageComposer } from './MessageComposer'
import { InternalNoteBadge } from './InternalNoteBadge'

const POLL_INTERVAL_MS = 3000

function AssignPopover({
  conversationId,
  assignedToUser,
  onAssigned,
}: {
  conversationId: string
  assignedToUser?: { id: string; firstName: string; lastName: string } | null
  onAssigned: () => void
}): React.JSX.Element {
  const currentUser = useAuthStore((s) => s.user)
  const [open, setOpen] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const { data: agents = [] } = useQuery({
    queryKey: ['internalAgents', currentUser?.tenantId],
    queryFn: () => getInternalAgents(currentUser!.tenantId),
    enabled: open && !!currentUser,
  })

  async function handleAssign(agent: AgentInfo): Promise<void> {
    setAssigning(true)
    try {
      await assignConversation(conversationId, agent.id)
      toast.success(`Assigned to ${agent.firstName} ${agent.lastName}`)
      setOpen(false)
      onAssigned()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to assign conversation')
    } finally {
      setAssigning(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-[11px] text-[12.5px] font-medium transition-colors',
          assignedToUser
            ? 'border-[#1b1b1f] bg-[#fafafb] text-[#1b1b1f]'
            : 'border-[#e6e6eb] bg-white text-[#4b4b55] hover:bg-[#f4f4f6]',
        )}
      >
        <UserPlus className="h-3.5 w-3.5" />
        {assignedToUser ? `Assigned: ${assignedToUser.firstName}` : 'Assign'}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <div className="flex flex-col gap-0.5 max-h-64 overflow-y-auto">
          {agents.length === 0 ? (
            <p className="px-2 py-2 text-[12.5px] text-[#a0a0aa]">No agents found.</p>
          ) : (
            agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                disabled={assigning}
                onClick={() => handleAssign(agent)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-[7px] px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-[#f4f4f6] disabled:opacity-50',
                  assignedToUser?.id === agent.id ? 'font-medium text-[#1b1b1f]' : 'text-[#4b4b55]',
                )}
              >
                <span className="truncate">
                  {agent.firstName} {agent.lastName}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

const MESSAGE_FIELDS = `
  id conversationId senderId senderType content messageType metadata internalNote
  sentAt deliveredAt readAt createdAt
`

type ConversationDetailProps = {
  conversationId: string
  contactName: string
  status: string
  channel?: string
  assignedToUser?: { id: string; firstName: string; lastName: string } | null
  className?: string
  onBack?: () => void
  /** Shared subscription client from the inbox page — used to deliver new
   * messages instantly via WebSocket instead of waiting for the poll. */
  wsClient?: GraphqlSubscriptionClient | null
  /** Called after assign/resolve/archive succeed so the parent can refetch
   * the conversation (status/assignee shown here are read from its props). */
  onConversationUpdated?: () => void
}

export function ConversationDetail({
  conversationId,
  contactName,
  status,
  channel,
  assignedToUser,
  className,
  onBack,
  wsClient,
  onConversationUpdated,
}: ConversationDetailProps): React.JSX.Element {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [internalNoteMode, setInternalNoteMode] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const canResolveOrArchive = status === 'OPEN' || status === 'PENDING'

  async function handleResolve(): Promise<void> {
    setResolving(true)
    try {
      await resolveConversation(conversationId)
      toast.success('Conversation resolved')
      onConversationUpdated?.()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to resolve conversation')
    } finally {
      setResolving(false)
    }
  }

  async function handleArchive(): Promise<void> {
    setArchiving(true)
    try {
      await archiveConversation(conversationId)
      toast.success('Conversation archived')
      onConversationUpdated?.()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to archive conversation')
    } finally {
      setArchiving(false)
    }
  }
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
    <div className={cn('flex min-h-0 min-w-0 h-full flex-col bg-white', className)}>
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-[#ececf0] bg-white px-4 py-3 lg:px-5 z-10 sticky top-0">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {onBack && (
            <button
              type="button"
              aria-label="Back to conversations"
              onClick={onBack}
              className="mr-1 flex h-8 w-8 items-center justify-center rounded-full text-[#8c8c96] hover:bg-[#f4f4f6] hover:text-[#1b1b1f] transition-colors lg:hidden"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}

          <div className="h-8 w-8 flex-shrink-0 rounded-full bg-[#f0f0f3] flex items-center justify-center text-[11px] font-semibold text-[#4b4b55]">
            {initials}
          </div>

          <div className="min-w-0 flex-1 flex flex-col gap-0.5">
            <h2 className="flex min-w-0 items-center gap-1.5 truncate text-[14px] font-semibold text-[#1b1b1f] tracking-tight leading-none">
              <span className="truncate">{contactName}</span>
            </h2>
            <span className="flex min-w-0 items-center gap-1 truncate text-[11.5px] text-[#8c8c96]">
              {channel === 'FACEBOOK' && (
                <Facebook
                  aria-label="Facebook Messenger conversation"
                  className="h-3 w-3 shrink-0"
                />
              )}
              <span className="truncate">{channel ?? 'Conversation'}</span>
            </span>
          </div>
        </div>

        <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-1.5 sm:w-auto">
          <AssignPopover
            conversationId={conversationId}
            assignedToUser={assignedToUser}
            onAssigned={() => onConversationUpdated?.()}
          />
          <button
            type="button"
            disabled={!canResolveOrArchive || resolving}
            onClick={handleResolve}
            className="inline-flex h-8 items-center rounded-[8px] border border-[#e6e6eb] bg-white px-[11px] text-[12.5px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {resolving ? 'Resolving...' : 'Resolve'}
          </button>
          <button
            type="button"
            disabled={!canResolveOrArchive || archiving}
            onClick={handleArchive}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e6e6eb] bg-white px-[11px] text-[12.5px] font-medium text-[#4b4b55] transition-colors hover:bg-[#f4f4f6] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Archive className="h-3.5 w-3.5" />
            {archiving ? 'Archiving...' : 'Archive'}
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-5 lg:px-8 relative bg-[#fafafb]"
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
                    'h-16 w-64 animate-pulse rounded-2xl bg-white shadow-sm border border-[#ececf0]',
                    i % 2 === 0 ? 'rounded-tl-[4px]' : 'rounded-tr-[4px]',
                  )}
                />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#fdeceb] text-[#b91c1c] mb-2">
              <RefreshCcw className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium text-[#1b1b1f]">{error}</p>
            <button
              type="button"
              onClick={() => fetchMessages(true)}
              className="mt-2 rounded-[9px] border border-[#1b1b1f] bg-[#1b1b1f] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-black"
            >
              Try Again
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center pb-20">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-[#a0a0aa] mb-4 shadow-sm ring-4 ring-white">
              <span className="text-2xl">👋</span>
            </div>
            <p className="text-[17px] font-bold text-[#1b1b1f] tracking-tight">
              Start the conversation
            </p>
            <p className="mt-1.5 text-[15px] text-[#8c8c96] max-w-sm">
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
                  className="rounded-full border border-[#e6e6eb] bg-white px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-[#4b4b55] hover:bg-[#f4f4f6] disabled:opacity-50 transition-colors"
                >
                  {loadingMore ? 'Loading earlier...' : 'Load earlier messages'}
                </button>
              </div>
            )}

            <div className="mb-3 flex items-center gap-3 text-[11.5px] text-[#a0a0aa]">
              <span className="h-px flex-1 bg-[#ececf0]" />
              Today
              <span className="h-px flex-1 bg-[#ececf0]" />
            </div>

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
      <div className="shrink-0 z-10 relative bg-white border-t border-[#ececf0]">
        {/* Internal note toggle — mock's composeModes (Reply / Internal note) */}
        <div className="flex items-center gap-1.5 px-4 pt-3">
          <button
            type="button"
            onClick={() => internalNoteMode && setInternalNoteMode(false)}
            className={cn(
              'h-7 rounded-[8px] border px-[11px] text-[12px] font-medium transition-colors',
              !internalNoteMode
                ? 'border-[#1b1b1f] bg-[#1b1b1f] text-white'
                : 'border-[#e6e6eb] bg-white text-[#4b4b55] hover:border-[#c7c7d1]',
            )}
          >
            Reply
          </button>
          <button
            type="button"
            onClick={() => setInternalNoteMode(true)}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-[8px] border px-[11px] text-[12px] font-medium transition-colors',
              internalNoteMode
                ? 'border-[#1b1b1f] bg-[#1b1b1f] text-white'
                : 'border-[#e6e6eb] bg-white text-[#4b4b55] hover:border-[#c7c7d1]',
            )}
          >
            <StickyNote className="h-3.5 w-3.5" />
            Internal note
          </button>
          {internalNoteMode && (
            <span className="ml-auto">
              <InternalNoteBadge />
            </span>
          )}
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
