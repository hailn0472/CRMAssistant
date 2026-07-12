'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, MoreVertical, RefreshCcw } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'
import type { Message } from '@/services/inbox.service'
import { getMessages, sendMessage as apiSendMessage } from '@/services/inbox.service'
import { MessageBubble } from './MessageBubble'
import { MessageComposer } from './MessageComposer'

type ConversationDetailProps = {
  conversationId: string
  contactName: string
  status: string
  className?: string
  onBack?: () => void
}

export function ConversationDetail({
  conversationId,
  contactName,
  status,
  className,
  onBack,
}: ConversationDetailProps): React.JSX.Element {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const initializedRef = useRef(false)

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

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

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

  async function handleSend(content: string): Promise<void> {
    const currentUser = useAuthStore.getState().user
    if (!currentUser) throw new Error('Not authenticated')

    await apiSendMessage({
      conversationId,
      senderId: currentUser.userId,
      senderType: 'AGENT',
      content,
    })
    // Refresh messages after send without showing the full screen loading skeleton
    await fetchMessages(false)
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

          <h2 className="text-[15px] font-bold text-slate-900 tracking-tight leading-none ml-1">
            {contactName}
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
                return (
                  <div key={msg.id} className={cn(isDifferentSender ? 'mt-4' : '')}>
                    <MessageBubble message={msg} />
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
        <MessageComposer
          onSend={handleSend}
          disabled={status === 'ARCHIVED' || status === 'RESOLVED'}
        />
      </div>
    </div>
  )
}
