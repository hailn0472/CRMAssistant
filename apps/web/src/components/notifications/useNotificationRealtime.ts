'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { GraphqlSubscriptionClient } from '@/lib/graphql-subscription'
import { ON_NOTIFICATION_RECEIVED_SUBSCRIPTION } from '@/services/notification.service'

/**
 * Story 4.8 (AC 63): realtime hook for notification invalidation — a
 * verbatim adaptation of useActivityRealtime (one client, one channel,
 * prefix invalidation of ['notifications']).
 *
 * 🚨 `connectGuardRef` prevents the React StrictMode double-connect
 * (TasksTable.tsx:128 pattern) and the client is always disconnected on
 * unmount. The server scopes the channel to the current user's own id, so
 * the client never receives another user's notification.
 *
 * Called exactly ONCE from NotificationBell, which is mounted once per
 * session by the app shell.
 */
export function useNotificationRealtime(): void {
  const queryClient = useQueryClient()
  const connectGuardRef = useRef(false)

  useEffect(() => {
    if (connectGuardRef.current) return
    connectGuardRef.current = true

    const client = new GraphqlSubscriptionClient()
    client.connect().catch(() => {
      // The client schedules its own reconnect — never fail the page.
    })

    const unsub = client.subscribe('notifications:received', {
      query: ON_NOTIFICATION_RECEIVED_SUBSCRIPTION,
      variables: {},
      onData: () => {
        // Prefix invalidation reaches both the list and the count
        queryClient.invalidateQueries({ queryKey: ['notifications'] })
      },
    })

    return () => {
      connectGuardRef.current = false
      unsub()
      client.disconnect()
    }
  }, [queryClient])
}
