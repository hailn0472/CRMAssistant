'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, MessageCircle, Hash, Facebook } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { Conversation, ConversationFilter } from '@/services/inbox.service'
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
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState('')
  const [channelFilter] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [assigneeFilter] = useState('')

  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')

  const PAGE_SIZE = 20
  const initialized = useRef(false)

  const fetchConversations = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true)
      if (showLoading) setError(null)
      try {
        const filter: ConversationFilter = {}
        if (statusFilter) filter.status = statusFilter
        if (channelFilter) filter.channel = channelFilter
        if (unreadOnly) filter.unreadOnly = true
        if (assigneeFilter) filter.assignedTo = assigneeFilter

        const result = await getConversations({ page, pageSize: PAGE_SIZE }, filter)
        let items = result.items
        if (searchQuery) {
          items = items.filter((c) => {
            const name = `${c.contact?.firstName || ''} ${c.contact?.lastName || ''}`.toLowerCase()
            return name.includes(searchQuery.toLowerCase())
          })
        }
        setConversations(items)
        setTotal(result.total)
      } catch {
        // Background refreshes (polling / real-time) fail silently — only
        // surface an error state for the user-visible initial/filtered load.
        if (showLoading) setError('Failed to load conversations')
      } finally {
        if (showLoading) setLoading(false)
      }
    },
    [statusFilter, channelFilter, unreadOnly, assigneeFilter, page, searchQuery],
  )

  // Initial load + reload when filters/page/search change (shows loading state)
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true
    }
    fetchConversations(true)
  }, [fetchConversations])

  // Real-time refresh trigger (from onConversationUpdated subscription) —
  // silent, no loading skeleton, so an update doesn't flash the whole list.
  const skipNextRefreshKey = useRef(true)
  useEffect(() => {
    if (skipNextRefreshKey.current) {
      skipNextRefreshKey.current = false
      return
    }
    fetchConversations(false)
  }, [refreshKey, fetchConversations])

  // Polling for real-time list updates (fallback/reconciliation — silent)
  useEffect(() => {
    const timer = setInterval(() => {
      fetchConversations(false)
    }, LIST_POLL_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [fetchConversations])

  useEffect(() => {
    setPage(1)
  }, [statusFilter, channelFilter, unreadOnly, assigneeFilter, searchQuery])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className={cn('flex flex-col bg-white', className)}>
      {/* Filters & Search */}
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4">
        {/* Internal chat button */}
        {onStartInternalChat && (
          <button
            type="button"
            onClick={onStartInternalChat}
            className="flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-indigo-700 transition-all hover:shadow-md"
          >
            <MessageCircle className="h-4 w-4" />
            New Internal Chat
          </button>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 w-full rounded-full border border-slate-200 bg-slate-50/50 pl-9 pr-4 text-[13px] outline-none transition-all focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
          />
        </div>
        <div className="flex items-center gap-5 px-1 pt-1">
          {['All', 'Unread', 'Pending', 'Archived'].map((tab) => {
            const isActive =
              (tab === 'Unread' && unreadOnly) ||
              (tab === 'All' && statusFilter === '' && !unreadOnly) ||
              (tab === 'Archived' && statusFilter === 'ARCHIVED' && !unreadOnly) ||
              (tab === 'Pending' && statusFilter === 'PENDING' && !unreadOnly)
            return (
              <button
                key={tab}
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
                  'pb-3 text-[13px] font-semibold transition-colors relative',
                  isActive ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700',
                )}
              >
                {tab}
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-900 rounded-t-full" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4">
            <InboxSkeleton />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
            <div className="rounded-full bg-red-50 p-3 text-red-500">
              <MessageCircle className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium text-slate-800">Oops, something went wrong</p>
            <p className="text-xs text-slate-500">{error}</p>
            <button
              type="button"
              onClick={() => fetchConversations(true)}
              className="mt-2 rounded-full bg-slate-900 px-5 py-2 text-xs font-medium text-white shadow-sm hover:bg-slate-800 transition-transform hover:scale-105 active:scale-95"
            >
              Try Again
            </button>
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
            <div className="rounded-full bg-slate-50 p-4 text-slate-300 mb-4">
              <MessageCircle className="h-8 w-8" />
            </div>
            <p className="text-[15px] font-bold text-slate-900">All caught up!</p>
            <p className="mt-1.5 text-sm text-slate-500 max-w-[200px]">
              {statusFilter || channelFilter || unreadOnly || assigneeFilter || searchQuery
                ? 'No conversations match your current filters.'
                : "When contacts reach out, you'll see them here."}
            </p>
          </div>
        ) : (
          <ul role="list" className="divide-y divide-slate-100/60">
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
                      'group flex w-full items-start gap-3.5 p-4 text-left transition-all duration-200 relative',
                      isSelected ? 'bg-blue-50/50' : 'hover:bg-slate-50/80',
                    )}
                  >
                    {isSelected && (
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-600 rounded-r-full shadow-[0_0_8px_rgba(37,99,235,0.4)]" />
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
                        <ChannelIcon className="h-3 w-3 text-slate-400" />
                      </div>
                    </div>

                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            'truncate text-[15px] tracking-tight',
                            isUnread ? 'font-bold text-slate-900' : 'font-semibold text-slate-800',
                          )}
                        >
                          {contactName}
                        </span>
                        <span
                          className={cn(
                            'shrink-0 text-[11px] font-medium tracking-wide',
                            isUnread ? 'text-blue-600' : 'text-slate-400',
                          )}
                        >
                          {timeAgo(conv.lastMessageAt)}
                        </span>
                      </div>

                      <div className="mt-1 flex items-start justify-between gap-3">
                        <span
                          className={cn(
                            'line-clamp-2 text-[13px] leading-relaxed',
                            isUnread ? 'font-medium text-slate-800' : 'text-slate-500',
                          )}
                        >
                          {truncate(
                            conv.lastMessagePreview ||
                              (conv.lastMessageAt ? 'Sent a message' : 'No messages yet'),
                            80,
                          )}
                        </span>
                        {isUnread ? (
                          <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[11px] font-bold text-white shadow-sm">
                            {conv.unreadCount! > 99 ? '99+' : conv.unreadCount}
                          </span>
                        ) : null}
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
          <div className="flex items-center justify-between border-t border-slate-100 p-4">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-full px-4 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-colors"
            >
              Previous
            </button>
            <span className="text-xs font-medium text-slate-400 bg-slate-50 px-3 py-1 rounded-full">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-full px-4 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
