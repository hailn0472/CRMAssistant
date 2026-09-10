/**
 * Story 4.8 (AC 81): NotificationBell renders the bell button with unread badge,
 * opens popover with NotificationPanel, and integrates realtime hook.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { NotificationBell } from '../NotificationBell'
import { getUnreadNotificationCount } from '@/services/notification.service'
import type { NotificationConnection } from '@/services/notification.service'

// ── Mocks ────────────────────────────────────────────────────────

jest.mock('@/services/notification.service', () => ({
  getUnreadNotificationCount: jest.fn(),
  getNotifications: jest.fn(),
  markNotificationRead: jest.fn(),
  markAllNotificationsRead: jest.fn(),
}))

jest.mock('@/lib/graphql-subscription', () => ({
  GraphqlSubscriptionClient: jest.fn().mockImplementation(() => ({
    connect: jest.fn(() => Promise.resolve()),
    subscribe: jest.fn(() => () => undefined),
    disconnect: jest.fn(),
  })),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    success: jest.fn(),
  },
}))

const mockGetUnreadCount = getUnreadNotificationCount as jest.Mock

import { getNotifications } from '@/services/notification.service'
const mockGetNotifications = getNotifications as jest.Mock

const EMPTY_CONNECTION: NotificationConnection = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 10,
}

function renderBell(): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mockGetNotifications.mockResolvedValue(EMPTY_CONNECTION)
  return render(
    <QueryClientProvider client={queryClient}>
      <NotificationBell />
    </QueryClientProvider>,
  )
}

describe('NotificationBell (Story 4.8, AC 81)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetUnreadCount.mockResolvedValue(0)
  })

  it('renders the bell button with accessible name', () => {
    renderBell()

    expect(screen.getByRole('button', { name: 'View notifications' })).toBeInTheDocument()
  })

  it('shows unread count badge when there are unread notifications', async () => {
    mockGetUnreadCount.mockResolvedValue(3)

    renderBell()

    const badge = await screen.findByText('3')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveAttribute('aria-hidden', 'true')
  })

  it('shows "99+" when unread count exceeds 99', async () => {
    mockGetUnreadCount.mockResolvedValue(150)

    renderBell()

    expect(await screen.findByText('99+')).toBeInTheDocument()
  })

  it('does not show badge when unread count is 0', () => {
    renderBell()

    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('has sr-only live region with unread count', async () => {
    mockGetUnreadCount.mockResolvedValue(5)

    renderBell()

    expect(await screen.findByText('5 unread notifications')).toBeInTheDocument()
  })

  it('opens popover on click with NotificationPanel', async () => {
    const user = userEvent.setup()
    renderBell()

    const bell = screen.getByRole('button', { name: 'View notifications' })
    await user.click(bell)

    // After click, the NotificationPanel should render
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument()
  })

  it('has focus-visible ring class on button', () => {
    renderBell()

    const bell = screen.getByRole('button', { name: 'View notifications' })
    expect(bell.className).toContain('focus-visible:ring-2')
  })
})
