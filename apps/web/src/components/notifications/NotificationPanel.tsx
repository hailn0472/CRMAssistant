'use client'

import { CheckSquare, DollarSign, Bell as BellIcon } from 'lucide-react'
import Link from 'next/link'
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

  if (isLoading) return <LoadingSkeleton />

  if (isError) {
    return <ErrorState message="Failed to load notifications" onRetry={() => refetch()} />
  }

  const items = data?.items ?? []

  if (items.length === 0) {
    return (
      <EmptyState
        title="You're all caught up"
        description="New reminders, alerts and mentions will appear here."
      />
    )
  }

  return (
    <div className="flex flex-col">
      <div className="divide-y divide-slate-100">
        {items.map((n) => {
          const href = notificationHref(n)
          const isUnread = !n.readAt

          const content = (
            <div
              className={`flex items-start gap-3 px-4 py-3 hover:bg-slate-50 cursor-pointer ${isUnread ? 'bg-indigo-50/40' : ''}`}
              onClick={() => {
                handleItemClick(n).catch(() => {})
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleItemClick(n).catch(() => {})
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="mt-0.5 shrink-0">
                <NotificationTypeIcon type={n.type} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900 truncate">{n.title}</p>
                  <span className="text-xs text-slate-400 shrink-0">
                    <time dateTime={n.createdAt}>{formatRelativeTime(n.createdAt)}</time>
                  </span>
                </div>
                {n.body && <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">{n.body}</p>}
                <p className="mt-0.5 text-[11px] text-slate-400">{notificationTypeLabel(n.type)}</p>
              </div>
              {isUnread && <div className="mt-2 shrink-0 h-2 w-2 rounded-full bg-indigo-500" />}
            </div>
          )

          if (href) {
            return (
              <Link key={n.id} href={href} className="block" onClick={(e) => e.preventDefault()}>
                {content}
              </Link>
            )
          }

          return <div key={n.id}>{content}</div>
        })}
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-slate-500 hover:text-slate-700"
          onClick={() => markAllReadMutation.mutate()}
          disabled={markAllReadMutation.isPending}
        >
          Mark all as read
        </Button>
        <Link
          href="/notifications"
          className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
        >
          View all
        </Link>
      </div>
    </div>
  )
}
