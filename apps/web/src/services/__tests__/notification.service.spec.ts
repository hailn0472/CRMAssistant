import { graphqlRequest } from '@/lib/graphql-client'
import {
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '../notification.service'
import type { Notification } from '../notification.service'

jest.mock('@/lib/graphql-client', () => ({
  graphqlRequest: jest.fn(),
}))

const mockGraphqlRequest = graphqlRequest as jest.Mock

const notification: Notification = {
  id: 'notification-1',
  type: 'TASK_ASSIGNED',
  title: 'Task assigned',
  body: 'Follow up with Alice',
  taskId: 'task-1',
  reportExportId: null,
  readAt: null,
  createdAt: '2026-08-10T00:00:00.000Z',
}

afterEach(() => {
  mockGraphqlRequest.mockReset()
})

describe('getNotifications', () => {
  it('returns the connection and applies default filter and pagination', async () => {
    const connection = { items: [notification], total: 1, page: 1, pageSize: 20 }
    mockGraphqlRequest.mockResolvedValue({ notifications: connection })

    await expect(getNotifications()).resolves.toEqual(connection)
    expect(mockGraphqlRequest).toHaveBeenCalledWith(
      expect.stringContaining('query Notifications'),
      {
        filter: { unreadOnly: undefined },
        pagination: { page: undefined, pageSize: undefined },
      },
    )
  })

  it('passes unread and pagination options through to GraphQL', async () => {
    mockGraphqlRequest.mockResolvedValue({
      notifications: { items: [], total: 0, page: 2, pageSize: 5 },
    })

    await getNotifications({ unreadOnly: true }, { page: 2, pageSize: 5 })

    expect(mockGraphqlRequest).toHaveBeenCalledWith(
      expect.stringContaining('query Notifications'),
      {
        filter: { unreadOnly: true },
        pagination: { page: 2, pageSize: 5 },
      },
    )
  })
})

describe('getUnreadNotificationCount', () => {
  it('returns the unread count from the GraphQL payload', async () => {
    mockGraphqlRequest.mockResolvedValue({ unreadNotificationCount: 4 })

    await expect(getUnreadNotificationCount()).resolves.toBe(4)
    expect(mockGraphqlRequest).toHaveBeenCalledWith(
      expect.stringContaining('query UnreadNotificationCount'),
      {},
    )
  })
})

describe('markNotificationRead', () => {
  it('returns the marked notification and sends its id', async () => {
    mockGraphqlRequest.mockResolvedValue({ markNotificationRead: notification })

    await expect(markNotificationRead('notification-1')).resolves.toEqual(notification)
    expect(mockGraphqlRequest).toHaveBeenCalledWith(
      expect.stringContaining('mutation MarkNotificationRead'),
      { id: 'notification-1' },
    )
  })
})

describe('markAllNotificationsRead', () => {
  it('returns the number of notifications marked read', async () => {
    mockGraphqlRequest.mockResolvedValue({ markAllNotificationsRead: 7 })

    await expect(markAllNotificationsRead()).resolves.toBe(7)
    expect(mockGraphqlRequest).toHaveBeenCalledWith(
      expect.stringContaining('mutation MarkAllNotificationsRead'),
      {},
    )
  })
})
