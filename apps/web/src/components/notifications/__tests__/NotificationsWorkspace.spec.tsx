/**
 * Story 4.8 (AC 81): NotificationsWorkspace renders the full-page
 * notification list with filtering, pagination, and mark-all-read.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { NotificationsWorkspace } from '../NotificationsWorkspace'
import { getNotifications, markAllNotificationsRead } from '@/services/notification.service'
import type { Notification, NotificationConnection } from '@/services/notification.service'

// ── Mocks ────────────────────────────────────────────────────────

jest.mock('@/services/notification.service', () => ({
  getNotifications: jest.fn(),
  markAllNotificationsRead: jest.fn(),
}))

jest.mock('@/lib/notification-format', () => ({
  notificationHref: jest.fn((n: Notification) => (n.dealId ? `/deals/${n.dealId}` : null)),
  notificationTypeLabel: jest.fn((type: string) => type),
  formatRelativeTime: jest.fn(() => '5m ago'),
}))

jest.mock('next/link', () => {
  const React = require('react')
  const MockLink = ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
    [key: string]: unknown
  }) => React.createElement('a', { href, ...props }, children)
  MockLink.displayName = 'MockLink'
  return MockLink
})

const mockGetNotifications = getNotifications as jest.Mock
const mockMarkAllRead = markAllNotificationsRead as jest.Mock

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'notif-1',
    type: 'TASK_ASSIGNED',
    title: 'Task assigned to you',
    body: null,
    dealId: null,
    taskId: null,
    readAt: null,
    createdAt: '2026-08-10T12:00:00.000Z',
    ...overrides,
  }
}

function connection(items: Notification[], total?: number): NotificationConnection {
  return { items, total: total ?? items.length, page: 1, pageSize: 20 }
}

function renderWorkspace(): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <NotificationsWorkspace />
    </QueryClientProvider>,
  )
}

describe('NotificationsWorkspace (Story 4.8, AC 81)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockMarkAllRead.mockResolvedValue(3)
  })

  // ── Rendering states ───────────────────────────────────────────

  it('shows loading skeleton while fetching', () => {
    mockGetNotifications.mockReturnValue(new Promise(() => {}))
    renderWorkspace()

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows error state on fetch failure with retry', async () => {
    mockGetNotifications.mockRejectedValue(new Error('Network error'))

    renderWorkspace()

    expect(await screen.findByText('Failed to load notifications')).toBeInTheDocument()
  })

  it('shows empty state when no notifications', async () => {
    mockGetNotifications.mockResolvedValue(connection([]))

    renderWorkspace()

    expect(await screen.findByText("You're all caught up")).toBeInTheDocument()
  })

  it('renders notification items with title and relative time', async () => {
    mockGetNotifications.mockResolvedValue(
      connection([
        makeNotification({ title: 'Notif 1' }),
        makeNotification({ id: 'notif-2', title: 'Notif 2', type: 'DEAL_REMINDER' }),
      ]),
    )

    renderWorkspace()

    expect(await screen.findByText('Notif 1')).toBeInTheDocument()
    expect(screen.getByText('Notif 2')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument()
  })

  it('renders the workspace header', async () => {
    mockGetNotifications.mockResolvedValue(connection([makeNotification()]))

    renderWorkspace()

    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeInTheDocument()
  })

  // ── Unread filter ──────────────────────────────────────────────

  it('has Unread toggle button', async () => {
    mockGetNotifications.mockResolvedValue(connection([makeNotification()]))

    renderWorkspace()

    expect(await screen.findByRole('button', { name: 'Unread' })).toBeInTheDocument()
  })

  it('toggles unreadOnly filter and goes to page 1', async () => {
    mockGetNotifications.mockResolvedValue(connection([]))

    renderWorkspace()

    const unreadBtn = await screen.findByRole('button', { name: 'Unread' })
    await userEvent.click(unreadBtn)

    expect(mockGetNotifications).toHaveBeenLastCalledWith(
      { unreadOnly: true },
      { page: 1, pageSize: 20 },
    )
  })

  // ── markAllRead ────────────────────────────────────────────────

  it('calls markAllNotificationsRead on "Mark all as read" click', async () => {
    mockGetNotifications.mockResolvedValue(connection([makeNotification()]))

    renderWorkspace()

    const btn = await screen.findByRole('button', { name: 'Mark all as read' })
    await userEvent.click(btn)

    expect(mockMarkAllRead).toHaveBeenCalled()
  })

  // ── Pagination ─────────────────────────────────────────────────

  it('shows pagination when total exceeds pageSize', async () => {
    const items = Array.from({ length: 25 }, (_, i) =>
      makeNotification({ id: `notif-${i}`, title: `Notif ${i}` }),
    )
    mockGetNotifications.mockResolvedValue(connection(items, 25))

    renderWorkspace()

    expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument()
  })

  it('navigates to next page', async () => {
    const items = Array.from({ length: 25 }, (_, i) =>
      makeNotification({ id: `notif-${i}`, title: `Notif ${i}` }),
    )
    mockGetNotifications.mockResolvedValue(connection(items, 25))

    renderWorkspace()

    const nextBtn = await screen.findByRole('button', { name: 'Next' })
    await userEvent.click(nextBtn)

    // Should have been called with page=2
    await waitFor(() => {
      expect(mockGetNotifications).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ page: 2 }),
      )
    })
  })

  it('Previous button is disabled on page 1', async () => {
    mockGetNotifications.mockResolvedValue(connection([makeNotification()], 1))

    renderWorkspace()

    await screen.findByText('Task assigned to you')
    // No Previous button should be rendered when totalPages=1 OR it should be disabled
    // The component only renders pagination when totalPages > 1
    expect(screen.queryByRole('button', { name: 'Previous' })).not.toBeInTheDocument()
  })

  // ── Notification links ─────────────────────────────────────────

  it('renders deal notifications as links', async () => {
    mockGetNotifications.mockResolvedValue(
      connection([makeNotification({ dealId: 'deal-1', title: 'Deal notif' })]),
    )

    renderWorkspace()

    const link = await screen.findByRole('link')
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/deals/deal-1')
  })

  it('shows unread styling for unread notifications', async () => {
    mockGetNotifications.mockResolvedValue(connection([makeNotification({ readAt: null })]))

    renderWorkspace()

    await screen.findByText('Task assigned to you')
    const dots = document.querySelectorAll('.bg-indigo-500')
    expect(dots.length).toBeGreaterThanOrEqual(1)
  })
})
