'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { WorkspaceHeader } from '@/components/layout/AppShellChrome'
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/shared'
import { Button } from '@/components/ui/button'
import {
  getNotifications,
  markAllNotificationsRead,
  type Notification,
  type NotificationConnection,
} from '@/services/notification.service'
import {
  notificationHref,
  notificationTypeLabel,
  formatRelativeTime,
} from '@/lib/notification-format'
import { CheckSquare, Bell as BellIcon } from 'lucide-react'
import Link from 'next/link'

function NotificationTypeIcon({ type }: { type: string }): React.JSX.Element {
  if (type === 'TASK_ASSIGNED') return <CheckSquare className="h-4 w-4 text-blue-500" />
  return <BellIcon className="h-4 w-4 text-slate-400" />
}

const PAGE_SIZE = 20

export function NotificationsWorkspace(): React.JSX.Element {
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [page, setPage] = useState(1)
  const queryClient = useQueryClient()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['notifications', 'workspace', { unreadOnly, page }],
    queryFn: () => getNotifications({ unreadOnly }, { page, pageSize: PAGE_SIZE }),
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

  const markAllReadMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['notifications'] })
      return { snapshot: snapshotNotifications() }
    },
    onError: (_err: Error, _vars, context) => {
      if (context?.snapshot) restoreNotifications(context.snapshot)
      toast.error(_err.message || 'Failed to mark all notifications as read')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  if (isLoading) return <LoadingSkeleton />

  if (isError) {
    return <ErrorState message="Failed to load notifications" onRetry={() => refetch()} />
  }

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const handleMarkAllRead = (): void => {
    markAllReadMutation.mutate()
  }

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader
        eyebrow="Notifications"
        title="Notifications"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant={unreadOnly ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setUnreadOnly(!unreadOnly)
                setPage(1)
              }}
            >
              Unread
            </Button>
            <Button variant="outline" size="sm" onClick={handleMarkAllRead}>
              Mark all as read
            </Button>
          </div>
        }
      />

      {items.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            title="You're all caught up"
            description="New reminders, alerts and mentions will appear here."
          />
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <div className="divide-y divide-slate-100">
            {items.map((n: Notification) => {
              const href = notificationHref(n)
              const isUnread = !n.readAt

              const row = (
                <div
                  className={`flex items-start gap-4 px-6 py-4 hover:bg-slate-50 ${isUnread ? 'bg-indigo-50/40' : ''}`}
                >
                  <div className="mt-0.5 shrink-0">
                    <NotificationTypeIcon type={n.type} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium text-slate-900">{n.title}</p>
                      <span className="text-xs text-slate-400 shrink-0">
                        <time dateTime={n.createdAt}>{formatRelativeTime(n.createdAt)}</time>
                      </span>
                    </div>
                    {n.body && <p className="mt-0.5 text-sm text-slate-500">{n.body}</p>}
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-[11px] text-slate-400">
                        {notificationTypeLabel(n.type)}
                      </span>
                      {isUnread && <span className="h-2 w-2 rounded-full bg-indigo-500" />}
                    </div>
                  </div>
                </div>
              )

              if (href) {
                return (
                  <Link key={n.id} href={href} className="block">
                    {row}
                  </Link>
                )
              }

              return <div key={n.id}>{row}</div>
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 px-6 py-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="text-sm text-slate-500">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
