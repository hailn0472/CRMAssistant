/**
 * useActivityRealtime (Story 4.4, AC 37): ONE client, BOTH subscriptions,
 * invalidate-on-receipt, connect guard, disconnect on unmount.
 */

import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { useActivityRealtime } from '@/components/activities/useActivityRealtime'
import {
  ON_ACTIVITY_LOGGED_SUBSCRIPTION,
  ON_TASK_CHANGED_SUBSCRIPTION,
} from '@/services/activity.service'

// GraphqlSubscriptionClient is excluded from coverage — mock it entirely.
const subscribe = jest.fn((_key: string, _opts: unknown) => () => undefined)
const disconnect = jest.fn()
const connect = jest.fn(() => Promise.resolve())

jest.mock('@/lib/graphql-subscription', () => ({
  GraphqlSubscriptionClient: jest.fn().mockImplementation(() => ({
    connect,
    subscribe,
    disconnect,
  })),
}))

import { GraphqlSubscriptionClient } from '@/lib/graphql-subscription'

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

function wrapperFor(
  queryClient: QueryClient,
): (props: { children: ReactNode }) => React.JSX.Element {
  function TestWrapper({ children }: { children: ReactNode }): React.JSX.Element {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return TestWrapper
}

type HandlerResult = {
  invalidateSpy: jest.SpyInstance
  taskHandler: (payload: unknown) => void
  activityHandler: (payload: unknown) => void
}

function renderHookWithHandlers(): HandlerResult & { unmount: () => void; rerender: () => void } {
  const queryClient = makeQueryClient()
  const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')
  const { unmount, rerender } = renderHook(() => useActivityRealtime(), {
    wrapper: wrapperFor(queryClient),
  })
  type SubCall = [string, { onData: (payload: unknown) => void }]
  const taskCall = subscribe.mock.calls.find(
    (call) => call[0] === 'activities:task-changed',
  ) as unknown as SubCall | undefined
  const activityCall = subscribe.mock.calls.find(
    (call) => call[0] === 'activities:activity-logged',
  ) as unknown as SubCall | undefined
  return {
    invalidateSpy,
    taskHandler: taskCall ? taskCall[1].onData : jest.fn(),
    activityHandler: activityCall ? activityCall[1].onData : jest.fn(),
    unmount,
    rerender,
  }
}

describe('useActivityRealtime (Story 4.4, AC 37)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(GraphqlSubscriptionClient as unknown as jest.Mock).mockClear()
  })

  it('creates ONE client and subscribes BOTH documents through it (AC 37)', () => {
    renderHookWithHandlers()

    expect(GraphqlSubscriptionClient).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledTimes(2)
    expect(subscribe).toHaveBeenCalledWith(
      'activities:task-changed',
      expect.objectContaining({ query: ON_TASK_CHANGED_SUBSCRIPTION }),
    )
    expect(subscribe).toHaveBeenCalledWith(
      'activities:activity-logged',
      expect.objectContaining({ query: ON_ACTIVITY_LOGGED_SUBSCRIPTION }),
    )
  })

  it('a re-render does not create a second client (connect guard)', () => {
    const { rerender } = renderHookWithHandlers()

    act(() => {
      rerender()
    })

    expect(GraphqlSubscriptionClient).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledTimes(2)
  })

  it('invalidates task and activity query keys on onTaskChanged', () => {
    const { invalidateSpy, taskHandler } = renderHookWithHandlers()

    act(() => {
      taskHandler({ id: 'task-1' })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['activities'] })
  })

  it('invalidates activity query keys on onActivityLogged', () => {
    const { invalidateSpy, activityHandler } = renderHookWithHandlers()

    act(() => {
      activityHandler({ id: 'activity-1' })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['activities'] })
  })

  it('disconnects and unsubscribes on unmount', () => {
    const { unmount } = renderHookWithHandlers()

    unmount()

    expect(disconnect).toHaveBeenCalledTimes(1)
  })
})
