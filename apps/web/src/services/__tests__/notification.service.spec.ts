import { graphqlRequest } from '@/lib/graphql-client'

import {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  NOTIFICATION_FIELDS,
  ON_NOTIFICATION_RECEIVED_SUBSCRIPTION,
} from '../notification.service'
import type { Notification, NotificationConnection } from '../notification.service'

jest.mock('@/lib/graphql-client', () => ({
  graphqlRequest: jest.fn(),
}))

const mockGraphqlRequest = graphqlRequest as jest.MockedFunction<typeof graphqlRequest>

describe('notification.service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('NOTIFICATION_FIELDS', () => {
    it('includes all required fields', () => {
      expect(NOTIFICATION_FIELDS).toContain('id')
      expect(NOTIFICATION_FIELDS).toContain('type')
      expect(NOTIFICATION_FIELDS).toContain('title')
      expect(NOTIFICATION_FIELDS).toContain('body')
      expect(NOTIFICATION_FIELDS).toContain('dealId')
      expect(NOTIFICATION_FIELDS).toContain('taskId')
      expect(NOTIFICATION_FIELDS).toContain('readAt')
      expect(NOTIFICATION_FIELDS).toContain('createdAt')
    })
  })

  describe('ON_NOTIFICATION_RECEIVED_SUBSCRIPTION', () => {
    it('is a non-empty string containing the subscription keyword', () => {
      expect(typeof ON_NOTIFICATION_RECEIVED_SUBSCRIPTION).toBe('string')
      expect(ON_NOTIFICATION_RECEIVED_SUBSCRIPTION).toContain('subscription')
      expect(ON_NOTIFICATION_RECEIVED_SUBSCRIPTION).toContain('onNotificationReceived')
    })
  })

  describe('getNotifications', () => {
    it('calls graphqlRequest and unwraps the response', async () => {
      const mockConnection: NotificationConnection = {
        items: [],
        total: 0,
        page: 1,
        pageSize: 10,
      }
      mockGraphqlRequest.mockResolvedValue({ notifications: mockConnection })

      const result = await getNotifications({}, { pageSize: 10 })

      expect(result).toEqual(mockConnection)
      expect(mockGraphqlRequest).toHaveBeenCalledWith(
        expect.stringContaining('query Notifications'),
        expect.objectContaining({
          filter: { unreadOnly: undefined },
          pagination: { page: undefined, pageSize: 10 },
        }),
      )
    })

    it('passes unreadOnly filter', async () => {
      mockGraphqlRequest.mockResolvedValue({
        notifications: { items: [], total: 0, page: 1, pageSize: 10 },
      })

      await getNotifications({ unreadOnly: true })

      expect(mockGraphqlRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          filter: { unreadOnly: true },
        }),
      )
    })
  })

  describe('getUnreadNotificationCount', () => {
    it('returns the unread count', async () => {
      mockGraphqlRequest.mockResolvedValue({ unreadNotificationCount: 5 })

      const result = await getUnreadNotificationCount()

      expect(result).toBe(5)
      expect(mockGraphqlRequest).toHaveBeenCalledWith(
        expect.stringContaining('query UnreadNotificationCount'),
        {},
      )
    })
  })

  describe('markNotificationRead', () => {
    it('calls graphqlRequest and returns the notification', async () => {
      const mockNotification: Notification = {
        id: 'notif-1',
        type: 'TASK_ASSIGNED',
        title: 'Test',
        body: null,
        dealId: null,
        taskId: null,
        readAt: '2026-08-10T12:00:00.000Z',
        createdAt: '2026-08-10T11:00:00.000Z',
      }
      mockGraphqlRequest.mockResolvedValue({ markNotificationRead: mockNotification })

      const result = await markNotificationRead('notif-1')

      expect(result).toEqual(mockNotification)
      expect(mockGraphqlRequest).toHaveBeenCalledWith(
        expect.stringContaining('mutation MarkNotificationRead'),
        { id: 'notif-1' },
      )
    })
  })

  describe('markAllNotificationsRead', () => {
    it('returns the count of marked notifications', async () => {
      mockGraphqlRequest.mockResolvedValue({ markAllNotificationsRead: 3 })

      const result = await markAllNotificationsRead()

      expect(result).toBe(3)
      expect(mockGraphqlRequest).toHaveBeenCalledWith(
        expect.stringContaining('mutation MarkAllNotificationsRead'),
        {},
      )
    })
  })
})
