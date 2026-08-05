'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { GraphqlSubscriptionClient } from '@/lib/graphql-subscription'
import {
  ON_ACTIVITY_LOGGED_SUBSCRIPTION,
  ON_TASK_CHANGED_SUBSCRIPTION,
} from '@/services/activity.service'

/**
 * Story 4.4 (AC 37): ALL real-time wiring for the Activities workspace lives
 * here — ONE `GraphqlSubscriptionClient`, BOTH tenant-wide subscriptions,
 * invalidate-on-receipt. Three views mounting three clients would be three
 * auth handshakes and three reconnect loops.
 *
 * 🚨 `connectGuardRef` prevents the React StrictMode double-connect
 * (TasksTable.tsx:128 pattern) and the client is always disconnected on
 * unmount. The server filters every event inside `subscribe` (AC 15), so the
 * client never sees a record it cannot read — there is nothing to filter here.
 *
 * Query keys: the workspace uses `['tasks', …]` / `['activities', …]`
 * prefixes everywhere, so the prefix invalidations below reach every view
 * (list, calendar, timeline) with one call each.
 */
export function useActivityRealtime(): void {
  const queryClient = useQueryClient()
  const connectGuardRef = useRef(false)

  useEffect(() => {
    if (connectGuardRef.current) return
    connectGuardRef.current = true

    const client = new GraphqlSubscriptionClient()
    client.connect().catch(() => {
      // The client schedules its own reconnect — never fail the page.
    })

    const unsubTask = client.subscribe('activities:task-changed', {
      query: ON_TASK_CHANGED_SUBSCRIPTION,
      variables: {},
      onData: () => {
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
        queryClient.invalidateQueries({ queryKey: ['activities'] })
      },
    })

    const unsubActivity = client.subscribe('activities:activity-logged', {
      query: ON_ACTIVITY_LOGGED_SUBSCRIPTION,
      variables: {},
      onData: () => {
        queryClient.invalidateQueries({ queryKey: ['activities'] })
      },
    })

    return () => {
      connectGuardRef.current = false
      unsubTask()
      unsubActivity()
      client.disconnect()
    }
  }, [queryClient])
}
