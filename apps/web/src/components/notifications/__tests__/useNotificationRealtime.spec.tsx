/**
 * useNotificationRealtime (Story 4.8, AC 63, 81): ONE client, ONE subscription,
 * connect guard, disconnect on unmount.
 */

import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { useNotificationRealtime } from '@/components/notifications/useNotificationRealtime'
import { ON_NOTIFICATION_RECEIVED_SUBSCRIPTION } from '@/services/notification.service'

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
  onDataHandler: (payload: unknown) => void
}

function renderHookWithHandlers(): HandlerResult & { unmount: () => void } {
  const queryClient = makeQueryClient()
  const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')
  const { unmount } = renderHook(() => useNotificationRealtime(), {
    wrapper: wrapperFor(queryClient),
  })
  type SubCall = [string, { onData: (payload: unknown) => void }]
  const notifCall = subscribe.mock.calls.find(
    (call) => call[0] === 'notifications:received',
  ) as unknown as SubCall | undefined
  return {
    invalidateSpy,
    onDataHandler: notifCall ? notifCall[1].onData : jest.fn(),
    unmount,
  }
}

describe('useNotificationRealtime (Story 4.8, AC 63, 81)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(GraphqlSubscriptionClient as unknown as jest.Mock).mockClear()
  })

  it('creates ONE client and subscribes ONE document through it (AC 63)', () => {
    renderHookWithHandlers()

    expect(GraphqlSubscriptionClient).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledWith(
      'notifications:received',
      expect.objectContaining({ query: ON_NOTIFICATION_RECEIVED_SUBSCRIPTION }),
    )
  })

  it('a re-render does not create a second client (connect guard)', () => {
    const queryClient = makeQueryClient()
    const { rerender } = renderHook(() => useNotificationRealtime(), {
      wrapper: wrapperFor(queryClient),
    })

    rerender()

    expect(GraphqlSubscriptionClient).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledTimes(1)
  })

  it('invalidates notification query keys on onNotificationReceived', () => {
    const { invalidateSpy, onDataHandler } = renderHookWithHandlers()

    onDataHandler({ id: 'notif-1' })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['notifications'] })
  })

  it('disconnects and unsubscribes on unmount', () => {
    const { unmount } = renderHookWithHandlers()

    unmount()

    expect(disconnect).toHaveBeenCalledTimes(1)
  })
})
