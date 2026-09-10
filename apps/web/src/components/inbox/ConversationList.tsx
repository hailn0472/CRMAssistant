'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, MessageCircle, Hash, Facebook } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { ConversationFilter } from '@/services/inbox.service'
import { getConversations } from '@/services/inbox.service'
import { InboxSkeleton } from './InboxSkeleton'

const LIST_POLL_INTERVAL_MS = 5000

type ConversationListProps = {
  selectedId: string | null
  onSelect: (id: string) => void
  className?: string
  refreshKey?: number
  onStartInternalChat?: () => void
}

const CHANNEL_ICONS: Record<string, React.ElementType> = {
  INTERNAL: Hash,
  FACEBOOK: Facebook,
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const now = Date.now()
  const date = new Date(dateStr).getTime()
  const diffMs = now - date
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return 'now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 7) return `${diffDay}d`
  return new Date(dateStr).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen).trimEnd() + '...'
}

function initials(firstName?: string, lastName?: string): string {
  const first = firstName?.charAt(0) ?? ''
  const last = lastName?.charAt(0) ?? ''
  return (first + last).toUpperCase() || '?'
}

function getRandomColor(str: string): string {
  const colors = [
    'from-blue-500 to-indigo-600',
    'from-emerald-400 to-teal-600',
    'from-orange-400 to-red-500',
    'from-purple-500 to-fuchsia-600',
    'from-pink-500 to-rose-600',
  ]
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

export function ConversationList({
  selectedId,
  onSelect,
  className,
  refreshKey = 0,
  onStartInternalChat,
}: ConversationListProps): React.JSX.Element {
  const [statusFilter, setStatusFilter] = useState('')
  const [channelFilter] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [assigneeFilter] = useState('')

  const [page, setPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')

  const PAGE_SIZE = 20
  const filter = useMemo<ConversationFilter>(() => {
    const nextFilter: ConversationFilter = {}
    if (statusFilter) nextFilter.status = statusFilter
    if (channelFilter) nextFilter.channel = channelFilter
    if (unreadOnly) nextFilter.unreadOnly = true
    if (assigneeFilter) nextFilter.assignedTo = assigneeFilter
    return nextFilter
  }, [statusFilter, channelFilter, unreadOnly, assigneeFilter])

  // The list remains in the dashboard QueryClient when the user changes
  // sections. Polling and subscriptions refresh the same cache entry rather
  // than replacing it with component-local state.
  const { data, error, isLoading, isError, refetch } = useQuery({
    queryKey: ['conversations', page, filter],
    queryFn: () => getConversations({ page, pageSize: PAGE_SIZE }, filter),
    staleTime: 10_000,
    refetchInterval: LIST_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  })

  const conversations = useMemo(() => {
    const items = data?.items ?? []
    const normalizedSearch = searchQuery.trim().toLowerCase()
    if (!normalizedSearch) return items

    return items.filter((conversation) => {
      const name = `${conversation.contact?.firstName ?? ''} ${conversation.contact?.lastName ?? ''}`
      return name.toLowerCase().includes(normalizedSearch)
    })
  }, [data?.items, searchQuery])

  const total = data?.total ?? 0

  // Real-time refresh trigger (from onConversationUpdated subscription) —
  // silent, no loading skeleton, so an update doesn't flash the whole list.
  const skipNextRefreshKey = useRef(true)
  useEffect(() => {
    if (skipNextRefreshKey.current) {
      skipNextRefreshKey.current = false
      return
    }
    void refetch()
  }, [refreshKey, refetch])

  useEffect(() => {
    setPage(1)
  }, [statusFilter, channelFilter, unreadOnly, assigneeFilter, searchQuery])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className={cn('flex min-h-0 flex-col bg-white', className)}>
      {/* Filters & Search */}
      <div className="flex flex-col gap-[11px] border-b border-[#f2f2f5] px-4 pb-3 pt-3.5">
        {/* Internal chat button */}
        {onStartInternalChat && (
          <button
            type="button"
            onClick={onStartInternalChat}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[9px] border border-[#1b1b1f] bg-[#1b1b1f] px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-black"
          >
            <MessageCircle className="h-4 w-4" />
            New Internal Chat
          </button>
        )}

        <label className="flex h-[34px] items-center gap-[9px] rounded-[9px] border border-[#e6e6eb] bg-[#fafafb] px-[11px] transition-colors focus-within:border-[#c7c7d1] focus-within:bg-white">
          <Search className="h-3.5 w-3.5 flex-none text-[#a0a0aa]" />
          <input
            type="text"
            placeholder="Search conversations"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="min-w-0 flex-1 border-none bg-transparent text-[13px] outline-none"
          />
        </label>
        <div className="flex items-center gap-1.5">
          {['All', 'Unread', 'Pending', 'Archived'].map((tab) => {
            const isActive =
              (tab === 'Unread' && unreadOnly) ||
              (tab === 'All' && statusFilter === '' && !unreadOnly) ||
              (tab === 'Archived' && statusFilter === 'ARCHIVED' && !unreadOnly) ||
              (tab === 'Pending' && statusFilter === 'PENDING' && !unreadOnly)
            return (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  if (tab === 'Unread') {
                    setUnreadOnly(true)
                    setStatusFilter('')
                  } else if (tab === 'All') {
                    setUnreadOnly(false)
                    setStatusFilter('')
                  } else if (tab === 'Archived') {
                    setUnreadOnly(false)
                    setStatusFilter('ARCHIVED')
                  } else if (tab === 'Pending') {
                    setUnreadOnly(false)
                    setStatusFilter('PENDING')
                  }
                }}
                className={cn(
                  'h-7 rounded-full border px-[11px] text-[12px] font-medium transition-colors',
                  isActive
                    ? 'border-[#1b1b1f] bg-[#1b1b1f] text-white'
                    : 'border-[#e6e6eb] bg-white text-[#4b4b55] hover:border-[#c7c7d1]',
                )}
              >
                {tab}
              </button>
            )
          })}
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4">
            <InboxSkeleton />
          </div>
        ) : isError && !data ? (
          <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
            <div className="rounded-full bg-[#fdeceb] p-3 text-[#b91c1c]">
              <MessageCircle className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium text-[#1b1b1f]">Oops, something went wrong</p>
            <p className="text-xs text-[#8c8c96]">
              {error instanceof Error ? error.message : 'Failed to load conversations'}
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-2 rounded-[9px] border border-[#1b1b1f] bg-[#1b1b1f] px-5 py-2 text-xs font-medium text-white transition-colors hover:bg-black"
            >
              Try Again
            </button>
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
            <div className="rounded-full bg-[#fafafb] p-4 text-[#c7c7d1] mb-4">
              <MessageCircle className="h-8 w-8" />
            </div>
            <p className="text-[15px] font-bold text-[#1b1b1f]">All caught up!</p>
            <p className="mt-1.5 text-sm text-[#8c8c96] max-w-[200px]">
              {statusFilter || channelFilter || unreadOnly || assigneeFilter || searchQuery
                ? 'No conversations match your current filters.'
                : "When contacts reach out, you'll see them here."}
            </p>
          </div>
        ) : (
          <ul role="list" className="divide-y divide-[#f4f4f7]">
            {conversations.map((conv) => {
              const isSelected = conv.id === selectedId
              const isUnread = conv.unreadCount && conv.unreadCount > 0
              const contactName = conv.contact
                ? `${conv.contact.firstName} ${conv.contact.lastName}`
                : conv.title || 'Internal chat'
              const init = initials(conv.contact?.firstName, conv.contact?.lastName)
              const colorClass = getRandomColor(contactName)
              const ChannelIcon = CHANNEL_ICONS[conv.channel] || Hash

              return (
                <li key={conv.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(conv.id)}
                    className={cn(
                      'group flex w-full items-start gap-3.5 p-4 text-left transition-colors relative',
                      isSelected
                        ? 'bg-[#f6f5ff] shadow-[inset_0_0_0_1px_#dedbff]'
                        : 'hover:bg-[#fafafb]',
                    )}
                  >
                    {isSelected && (
                      <div className="absolute bottom-0 left-0 top-0 w-[3px] bg-[#5b50d6]" />
                    )}

                    <div className="relative mt-0.5">
                      <div
                        className={cn(
                          'h-12 w-12 flex-shrink-0 rounded-full bg-gradient-to-br flex items-center justify-center text-[15px] font-bold text-white shadow-sm ring-2 ring-white',
                          colorClass,
                        )}
                      >
                        {init}
                      </div>
                      <div className="absolute -bottom-1 -right-1 rounded-full border-2 border-white bg-white p-0.5 shadow-sm">
                        <ChannelIcon className="h-3 w-3 text-[#a0a0aa]" />
                      </div>
                    </div>

                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            'truncate text-[13.5px] tracking-tight',
                            isUnread ? 'font-bold text-[#1b1b1f]' : 'font-semibold text-[#1b1b1f]',
                          )}
                        >
                          {contactName}
                        </span>
                        <span className="shrink-0 text-[11px] text-[#a0a0aa]">
                          {timeAgo(conv.lastMessageAt)}
                        </span>
                      </div>

                      <div className="mt-1 flex items-start justify-between gap-3">
                        <span
                          className={cn(
                            'line-clamp-2 text-[12.5px] leading-relaxed',
                            isUnread ? 'font-medium text-[#1b1b1f]' : 'text-[#8c8c96]',
                          )}
                        >
                          {truncate(
                            conv.lastMessagePreview ||
                              (conv.lastMessageAt ? 'Sent a message' : 'No messages yet'),
                            80,
                          )}
                        </span>
                        {isUnread ? (
                          <span className="flex h-[17px] min-w-[17px] shrink-0 items-center justify-center rounded-full bg-[#1b1b1f] px-1.5 text-[10.5px] font-semibold text-white">
                            {conv.unreadCount! > 99 ? '99+' : conv.unreadCount}
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span className="rounded-[5px] bg-[#f4f4f6] px-1.5 py-px text-[10.5px] font-medium text-[#6b6b76]">
                          {conv.channel}
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-[#f2f2f5] p-4">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-full px-4 py-1.5 text-xs font-medium text-[#4b4b55] hover:bg-[#f4f4f6] disabled:opacity-40 transition-colors"
            >
              Previous
            </button>
            <span className="text-xs font-medium text-[#a0a0aa] bg-[#fafafb] px-3 py-1 rounded-full">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-full px-4 py-1.5 text-xs font-medium text-[#4b4b55] hover:bg-[#f4f4f6] disabled:opacity-40 transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
