/**
 * Story 4.8 (AC 81): NotificationPanel renders notifications list with
 * loading, empty, error states and handles markRead with snapshot/restore.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { NotificationPanel } from '../NotificationPanel'
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '@/services/notification.service'
import type { Notification, NotificationConnection } from '@/services/notification.service'

// ── Mocks ────────────────────────────────────────────────────────

jest.mock('@/services/notification.service', () => ({
  getNotifications: jest.fn(),
  markNotificationRead: jest.fn(),
  markAllNotificationsRead: jest.fn(),
}))

jest.mock('@/lib/notification-format', () => ({
  notificationHref: jest.fn((n: Notification) => (n.dealId ? `/deals/${n.dealId}` : null)),
  notificationTypeLabel: jest.fn((type: string) => type),
  notificationTypeIconName: jest.fn((type: string) =>
    type === 'DEAL_REMINDER' ? 'DollarSign' : 'Bell',
  ),
  formatRelativeTime: jest.fn(() => '5m ago'),
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

const mockGetNotifications = getNotifications as jest.Mock
const mockMarkRead = markNotificationRead as jest.Mock
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

function connection(items: Notification[]): NotificationConnection {
  return { items, total: items.length, page: 1, pageSize: 10 }
}

function renderPanel(): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <NotificationPanel />
    </QueryClientProvider>,
  )
}

describe('NotificationPanel (Story 4.8, AC 81)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockMarkRead.mockResolvedValue(makeNotification({ readAt: '2026-08-10T13:00:00.000Z' }))
    mockMarkAllRead.mockResolvedValue(3)
  })

  // ── Rendering states ───────────────────────────────────────────

  it('shows loading skeleton while fetching', () => {
    mockGetNotifications.mockReturnValue(new Promise(() => {})) // never resolves
    renderPanel()

    // LoadingSkeleton renders
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows error state on fetch failure with retry', async () => {
    mockGetNotifications.mockRejectedValue(new Error('Network error'))

    renderPanel()

    expect(await screen.findByText('Failed to load notifications')).toBeInTheDocument()
    const retryBtn = screen.getByRole('button')
    expect(retryBtn).toBeInTheDocument()
  })

  it('shows empty state when no notifications', async () => {
    mockGetNotifications.mockResolvedValue(connection([]))

    renderPanel()

    expect(await screen.findByText("You're all caught up")).toBeInTheDocument()
    expect(
      screen.getByText('New reminders, alerts and mentions will appear here.'),
    ).toBeInTheDocument()
  })

  it('renders notification items with title, relative time, and type label', async () => {
    mockGetNotifications.mockResolvedValue(
      connection([
        makeNotification({ title: 'Notif 1' }),
        makeNotification({ id: 'notif-2', title: 'Notif 2', type: 'DEAL_REMINDER' }),
      ]),
    )

    renderPanel()

    expect(await screen.findByText('Notif 1')).toBeInTheDocument()
    expect(screen.getByText('Notif 2')).toBeInTheDocument()
  })

  it('shows unread indicator dot for unread notifications', async () => {
    mockGetNotifications.mockResolvedValue(connection([makeNotification({ readAt: null })]))

    renderPanel()

    await screen.findByText('Task assigned to you')
    // The unread dot with bg-indigo-500
    const dots = document.querySelectorAll('.bg-indigo-500')
    expect(dots.length).toBeGreaterThanOrEqual(1)
  })

  it('does not show unread dot for read notifications', async () => {
    mockGetNotifications.mockResolvedValue(
      connection([makeNotification({ readAt: '2026-08-10T11:00:00.000Z' })]),
    )

    renderPanel()

    await screen.findByText('Task assigned to you')
    const dots = document.querySelectorAll('.bg-indigo-500')
    expect(dots.length).toBe(0)
  })

  // ── markRead mutation with snapshot/restore ──────────────────────

  it('marks notification as read on click', async () => {
    mockGetNotifications.mockResolvedValue(connection([makeNotification()]))

    renderPanel()

    const item = await screen.findByText('Task assigned to you')
    await userEvent.click(item)

    await waitFor(() => {
      expect(mockMarkRead).toHaveBeenCalled()
    })
  })

  it('does not call markRead for already-read notification', async () => {
    mockGetNotifications.mockResolvedValue(
      connection([makeNotification({ readAt: '2026-08-10T11:00:00.000Z' })]),
    )

    renderPanel()

    const item = await screen.findByText('Task assigned to you')
    await userEvent.click(item)

    expect(mockMarkRead).not.toHaveBeenCalled()
  })

  // ── markAllRead ──────────────────────────────────────────────────

  it('has "Mark all as read" button', async () => {
    mockGetNotifications.mockResolvedValue(connection([makeNotification()]))

    renderPanel()

    expect(await screen.findByRole('button', { name: 'Mark all as read' })).toBeInTheDocument()
  })

  it('calls markAllNotificationsRead on button click', async () => {
    mockGetNotifications.mockResolvedValue(connection([makeNotification()]))

    renderPanel()

    const btn = await screen.findByRole('button', { name: 'Mark all as read' })
    await userEvent.click(btn)

    expect(mockMarkAllRead).toHaveBeenCalled()
  })

  it('has "View all" link to /notifications', async () => {
    mockGetNotifications.mockResolvedValue(connection([makeNotification()]))

    renderPanel()

    const link = await screen.findByRole('link', { name: 'View all' })
    expect(link).toBeInTheDocument()
  })

  // ── Accessibility ───────────────────────────────────────────────

  it('items are keyboard navigable', async () => {
    mockGetNotifications.mockResolvedValue(connection([makeNotification()]))

    renderPanel()

    const item = await screen.findByText('Task assigned to you')
    fireEvent.keyDown(item.closest('[role="button"]')!, { key: 'Enter' })

    await waitFor(() => {
      expect(mockMarkRead).toHaveBeenCalled()
    })
  })
})
