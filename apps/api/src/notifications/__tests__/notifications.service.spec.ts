import { NotFoundException } from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

import { NotificationsService, NOTIFICATION_SELECT } from '../notifications.service'

interface MockPrismaNotification {
  create: jest.Mock
  findFirst: jest.Mock
  findMany: jest.Mock
  count: jest.Mock
  updateMany: jest.Mock
}

interface MockPubSub {
  publish: jest.Mock
  subscribe: jest.Mock
}

interface MockServiceBundle {
  prisma: { notification: MockPrismaNotification }
  pubSub: MockPubSub
}

function makeMocks(): MockServiceBundle {
  return {
    prisma: {
      notification: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        updateMany: jest.fn(),
      },
    },
    pubSub: { publish: jest.fn(), subscribe: jest.fn() },
  }
}

function makeService(mocks: MockServiceBundle): NotificationsService {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return new NotificationsService(mocks.prisma as any, mocks.pubSub as any)
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

const TENANT = 't1'
const USER = 'u1'
const NOW = new Date('2026-08-08T12:00:00Z')

function notificationRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'notif-1',
    tenantId: TENANT,
    userId: USER,
    type: 'TASK_ASSIGNED',
    title: 'Task assigned to you',
    body: null,
    dealId: null,
    taskId: 'task-1',
    dedupeKey: null,
    readAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: USER,
    updatedBy: USER,
    deletedAt: null,
    ...overrides,
  }
}

describe('NotificationsService', () => {
  let mocks: MockServiceBundle
  let service: NotificationsService

  beforeEach(() => {
    mocks = makeMocks()
    service = makeService(mocks)
  })

  describe('NOTIFICATION_SELECT', () => {
    it('includes all NotificationRef fields', () => {
      expect(NOTIFICATION_SELECT).toHaveProperty('id', true)
      expect(NOTIFICATION_SELECT).toHaveProperty('tenantId', true)
      expect(NOTIFICATION_SELECT).toHaveProperty('userId', true)
      expect(NOTIFICATION_SELECT).toHaveProperty('type', true)
      expect(NOTIFICATION_SELECT).toHaveProperty('title', true)
      expect(NOTIFICATION_SELECT).toHaveProperty('body', true)
      expect(NOTIFICATION_SELECT).toHaveProperty('dealId', true)
      expect(NOTIFICATION_SELECT).toHaveProperty('taskId', true)
      expect(NOTIFICATION_SELECT).toHaveProperty('dedupeKey', true)
      expect(NOTIFICATION_SELECT).toHaveProperty('readAt', true)
      expect(NOTIFICATION_SELECT).toHaveProperty('createdAt', true)
      expect(NOTIFICATION_SELECT).toHaveProperty('updatedAt', true)
      expect(NOTIFICATION_SELECT).toHaveProperty('createdBy', true)
      expect(NOTIFICATION_SELECT).toHaveProperty('updatedBy', true)
      expect(NOTIFICATION_SELECT).toHaveProperty('deletedAt', true)
    })
  })

  describe('create', () => {
    it('creates a notification row and publishes on own-scoped channel', async () => {
      const row = notificationRow()
      mocks.prisma.notification.create.mockResolvedValue(row)

      const result = await service.create(TENANT, USER, {
        recipientUserId: USER,
        type: 'TASK_ASSIGNED',
        title: 'Task assigned to you',
        taskId: 'task-1',
      })

      expect(mocks.prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT,
            userId: USER,
            type: 'TASK_ASSIGNED',
            title: 'Task assigned to you',
            taskId: 'task-1',
            createdBy: USER,
            updatedBy: USER,
          }),
          select: NOTIFICATION_SELECT,
        }),
      )

      // Publishes with the exact channel string (AC 74)
      expect(mocks.pubSub.publish).toHaveBeenCalledWith(
        `NOTIFICATION_CREATED:${TENANT}:${USER}`,
        expect.any(Object),
      )
      expect(result).toEqual(row)
    })

    it('returns existing row on P2002 dedupeKey collision without publishing (AC 74)', async () => {
      const existing = notificationRow({ dedupeKey: 'dup-1' })
      const p2002Error = new PrismaClientKnownRequestError('Unique constraint violation', {
        code: 'P2002',
        clientVersion: '5.0.0',
      })
      mocks.prisma.notification.create.mockRejectedValue(p2002Error)
      mocks.prisma.notification.findFirst.mockResolvedValue(existing)

      const result = await service.create(TENANT, USER, {
        recipientUserId: USER,
        type: 'TASK_ASSIGNED',
        title: 'Task assigned to you',
        dedupeKey: 'dup-1',
      })

      // Must NOT publish on dedupe
      expect(mocks.pubSub.publish).not.toHaveBeenCalled()
      expect(result).toEqual(existing)
    })

    it('normalizes title and body before saving', async () => {
      const row = notificationRow({ title: 'Hello', body: 'World' })
      mocks.prisma.notification.create.mockResolvedValue(row)

      await service.create(TENANT, USER, {
        recipientUserId: USER,
        type: 'TASK_ASSIGNED',
        title: '  Hello  ',
        body: '  World  ',
      })

      expect(mocks.prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Hello',
            body: 'World',
          }),
        }),
      )
    })
  })

  describe('notifySafe', () => {
    it('creates a notification and returns true', async () => {
      const row = notificationRow()
      mocks.prisma.notification.create.mockResolvedValue(row)

      const result = await service.notifySafe(TENANT, USER, {
        recipientUserId: USER,
        type: 'TASK_ASSIGNED',
        title: 'Test',
      })

      expect(result).toBe(true)
      expect(mocks.pubSub.publish).toHaveBeenCalled()
    })

    it('returns false when the row was deduped via P2002 (no over-count)', async () => {
      // Same dedupeKey already exists → create rejects P2002, the existing row
      // is returned WITHOUT a new insert → notifySafe must report not-created.
      const existing = notificationRow()
      mocks.prisma.notification.create.mockRejectedValue(
        new PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.22.0',
        }),
      )
      mocks.prisma.notification.findFirst.mockResolvedValue(existing)

      const result = await service.notifySafe(TENANT, USER, {
        recipientUserId: USER,
        type: 'TASK_ASSIGNED',
        title: 'Test',
        dedupeKey: 'dup:1',
      })

      expect(result).toBe(false)
      expect(mocks.pubSub.publish).not.toHaveBeenCalled()
    })

    it('swallows error, logs and returns false (AC 75)', async () => {
      // Spy on logger
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const logSpy = jest.spyOn((service as any).logger, 'error').mockImplementation()

      mocks.prisma.notification.create.mockRejectedValue(new Error('Boom'))

      await expect(
        service.notifySafe(TENANT, USER, {
          recipientUserId: USER,
          type: 'TASK_ASSIGNED',
          title: 'Test',
        }),
      ).resolves.toBe(false)

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Boom'))
      logSpy.mockRestore()
    })

    it('returns false on error (never throws)', async () => {
      mocks.prisma.notification.create.mockRejectedValue(new Error('DB down'))

      await expect(
        service.notifySafe(TENANT, USER, {
          recipientUserId: USER,
          type: 'TASK_ASSIGNED',
          title: 'Test',
        }),
      ).resolves.toBe(false)
    })
  })

  describe('markRead', () => {
    it('marks a notification as read and returns the updated row', async () => {
      mocks.prisma.notification.updateMany.mockResolvedValue({ count: 1 })
      const updated = notificationRow({ readAt: new Date() })
      mocks.prisma.notification.findFirst.mockResolvedValue(updated)

      const result = await service.markRead(TENANT, USER, 'notif-1')

      expect(mocks.prisma.notification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'notif-1', tenantId: TENANT, userId: USER, readAt: null, deletedAt: null },
          data: { readAt: expect.any(Date), updatedBy: USER },
        }),
      )
      expect(result).toEqual(updated)
    })

    it('is idempotent when already read (AC 75)', async () => {
      mocks.prisma.notification.updateMany.mockResolvedValue({ count: 0 })
      const alreadyRead = notificationRow({ readAt: NOW })
      mocks.prisma.notification.findFirst.mockResolvedValue(alreadyRead)

      const result = await service.markRead(TENANT, USER, 'notif-1')

      expect(result).toEqual(alreadyRead)
      expect(result?.readAt).toEqual(NOW)
    })

    it('throws NotFoundException when notification not found', async () => {
      mocks.prisma.notification.updateMany.mockResolvedValue({ count: 0 })
      mocks.prisma.notification.findFirst.mockResolvedValue(null)

      await expect(service.markRead(TENANT, USER, 'notif-1')).rejects.toThrow(NotFoundException)
    })

    it('throws NotFoundException with same message as cross-tenant', async () => {
      mocks.prisma.notification.updateMany.mockResolvedValue({ count: 0 })
      mocks.prisma.notification.findFirst.mockResolvedValue(null)

      await expect(service.markRead(TENANT, 'other-user', 'notif-1')).rejects.toThrow(
        'Notification not found',
      )
    })
  })

  describe('findMany', () => {
    it('returns paginated results for the user', async () => {
      const rows = [notificationRow(), notificationRow({ id: 'notif-2' })]
      mocks.prisma.notification.findMany.mockResolvedValue(rows)
      mocks.prisma.notification.count.mockResolvedValue(2)

      const result = await service.findMany(TENANT, USER)

      expect(result).toEqual({
        items: rows,
        total: 2,
        page: 1,
        pageSize: 20,
      })
    })

    it('filters by unreadOnly', async () => {
      mocks.prisma.notification.findMany.mockResolvedValue([])
      mocks.prisma.notification.count.mockResolvedValue(0)

      await service.findMany(TENANT, USER, { unreadOnly: true })

      expect(mocks.prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT, userId: USER, deletedAt: null, readAt: null },
        }),
      )
    })

    it('clamps pageSize to MAX_PAGE_SIZE', async () => {
      mocks.prisma.notification.findMany.mockResolvedValue([])
      mocks.prisma.notification.count.mockResolvedValue(0)

      await service.findMany(TENANT, USER, {}, { page: 1, pageSize: 200 })

      expect(mocks.prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      )
    })

    it('scopes to tenantId and userId', async () => {
      mocks.prisma.notification.findMany.mockResolvedValue([])
      mocks.prisma.notification.count.mockResolvedValue(0)

      await service.findMany(TENANT, USER)

      expect(mocks.prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT, userId: USER, deletedAt: null },
        }),
      )
    })
  })

  describe('countUnread', () => {
    it('counts unread notifications for the user', async () => {
      mocks.prisma.notification.count.mockResolvedValue(5)

      const result = await service.countUnread(TENANT, USER)

      expect(result).toBe(5)
      expect(mocks.prisma.notification.count).toHaveBeenCalledWith({
        where: { tenantId: TENANT, userId: USER, readAt: null, deletedAt: null },
      })
    })
  })

  describe('markAllRead', () => {
    it('marks all unread notifications for the user as read', async () => {
      mocks.prisma.notification.updateMany.mockResolvedValue({ count: 3 })

      const result = await service.markAllRead(TENANT, USER)

      expect(result).toBe(3)
      expect(mocks.prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT, userId: USER, readAt: null, deletedAt: null },
        data: { readAt: expect.any(Date), updatedBy: USER },
      })
    })
  })
})
