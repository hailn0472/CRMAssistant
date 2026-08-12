import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { TopbarActions } from '../TopbarActions'

// Story 4.8 (AC 82, Trap T23): NotificationBell uses useQuery and
// useNotificationRealtime. TopbarActions renders bare → needs a
// QueryClientProvider. Mock graphql-subscription wholesale to prevent
// a real jsdom WebSocket.

jest.mock('@/lib/graphql-subscription', () => ({
  GraphqlSubscriptionClient: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockReturnValue(jest.fn()),
    disconnect: jest.fn(),
  })),
}))

function renderTopbar(): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <TopbarActions />
    </QueryClientProvider>,
  )
}

describe('TopbarActions', () => {
  it('renders notification button', () => {
    renderTopbar()

    expect(screen.getByRole('button', { name: 'View notifications' })).toBeInTheDocument()
  })

  it('keeps the notification button at the 44x44px touch target', () => {
    renderTopbar()

    expect(screen.getByRole('button', { name: 'View notifications' })).toHaveClass('h-11', 'w-11')
  })

  it('renders the system status pill', () => {
    renderTopbar()

    expect(screen.getByText('All systems normal')).toBeInTheDocument()
  })

  it('does not render identity controls (moved to the sidebar profile menu)', () => {
    renderTopbar()

    expect(screen.queryByRole('button', { name: 'User menu' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'User profile menu' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })
})
