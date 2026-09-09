'use client'

import { CheckSquare, DollarSign, Bell as BellIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/shared'
import { Button } from '@/components/ui/button'
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type Notification,
  type NotificationConnection,
} from '@/services/notification.service'
import {
  notificationHref,
  notificationTypeLabel,
  notificationTypeIconName,
  formatRelativeTime,
} from '@/lib/notification-format'

function NotificationTypeIcon({ type }: { type: string }): React.JSX.Element {
  const iconName = notificationTypeIconName(type)
  if (iconName === 'DollarSign') return <DollarSign className="h-4 w-4 text-emerald-500" />
  if (iconName === 'CheckSquare') return <CheckSquare className="h-4 w-4 text-blue-500" />
  return <BellIcon className="h-4 w-4 text-slate-400" />
}

export function NotificationPanel(): React.JSX.Element {
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['notifications', 'panel'],
    queryFn: () => getNotifications({}, { pageSize: 10 }),
  })

  const snapshotNotifications = () =>
    queryClient.getQueriesData<NotificationConnection>({ queryKey: ['notifications'] })

  const restoreNotifications = (snapshot: ReturnType<typeof snapshotNotifications>) => {
    for (const [queryKey, data] of snapshot) {
      if (data) {
        queryClient.setQueriesData<NotificationConnection>(queryKey as any, data)
      }
    }
  }

  const markReadMutation = useMutation({
    mutationFn: markNotificationRead,
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['notifications'] })
      return { snapshot: snapshotNotifications() }
    },
    onError: (_err: Error, _vars, context) => {
      if (context?.snapshot) restoreNotifications(context.snapshot)
      toast.error(_err.message || 'Failed to mark notification as read')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const markAllReadMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['notifications'] })
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to mark all notifications as read')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const handleItemClick = async (n: Notification): Promise<void> => {
    if (!n.readAt) {
      await markReadMutation.mutateAsync(n.id)
    }
    const href = notificationHref(n)
    if (href) {
      router.push(href)
    }
  }

  const items = data?.items ?? []
  const unreadCount = items.filter((notification) => !notification.readAt).length

  return (
    <section
      aria-label="Notifications"
      className="flex h-[min(34rem,calc(100dvh-5.5rem))] min-h-[18rem] flex-col bg-white"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-[#ececf0] px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[#f0efff] text-[#5b50d6]">
            <BellIcon className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-[14px] font-semibold text-[#1b1b1f]">Notifications</h2>
            <p className="text-[11.5px] text-[#8c8c96]">
              {unreadCount > 0 ? `${unreadCount} unread` : 'You are all caught up'}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-[11.5px] font-medium text-[#5b50d6] hover:bg-[#f3f2ff] hover:text-[#4c42c2]"
          onClick={() => markAllReadMutation.mutate()}
          disabled={unreadCount === 0 || markAllReadMutation.isPending}
        >
          Mark all read
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {isLoading ? (
          <div className="p-4">
            <LoadingSkeleton />
          </div>
        ) : isError ? (
          <div className="p-4">
            <ErrorState message="Failed to load notifications" onRetry={() => refetch()} />
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full items-center justify-center px-5">
            <EmptyState
              title="You're all caught up"
              description="New reminders, alerts and mentions will appear here."
            />
          </div>
        ) : (
          <div className="divide-y divide-[#f0f0f3]">
            {items.map((n) => {
              const isUnread = !n.readAt

              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    handleItemClick(n).catch(() => {})
                  }}
                  className={`group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[#fafafb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#665ce0]/35 ${
                    isUnread ? 'bg-[#f8f7ff]' : 'bg-white'
                  }`}
                >
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f4f4f6]">
                    <NotificationTypeIcon type={n.type} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="line-clamp-1 text-[13px] font-semibold text-[#2c2c33]">
                        {n.title}
                      </span>
                      <time
                        dateTime={n.createdAt}
                        className="shrink-0 text-[11px] font-medium text-[#a0a0aa]"
                      >
                        {formatRelativeTime(n.createdAt)}
                      </time>
                    </span>
                    {n.body ? (
                      <span className="mt-1 line-clamp-2 block text-[12px] leading-[1.45] text-[#77777f]">
                        {n.body}
                      </span>
                    ) : null}
                    <span className="mt-1.5 block text-[10.5px] font-medium text-[#a0a0aa]">
                      {notificationTypeLabel(n.type)}
                    </span>
                  </span>
                  {isUnread ? (
                    <span
                      className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#665ce0]"
                      aria-label="Unread"
                    />
                  ) : null}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <footer className="flex shrink-0 justify-end border-t border-[#ececf0] px-4 py-2.5">
        <a
          href="/notifications"
          className="text-[11.5px] font-semibold text-[#5b50d6] hover:text-[#4c42c2]"
        >
          View all
        </a>
      </footer>
    </section>
  )
}
