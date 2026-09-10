import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import { NotificationsService } from '../notifications.service'
import { PUBSUB_NOTIFICATION_CREATED } from '../notification-pubsub.service'

/* eslint-disable @typescript-eslint/no-explicit-any */

const row = (overrides: Record<string, unknown> = {}): any => {
  const now = new Date('2026-01-01T00:00:00.000Z')
  return {
    id: 'notification-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    type: 'TASK_ASSIGNED',
    title: 'Task assigned',
    body: 'Follow up',
    taskId: 'task-1',
    reportExportId: null,
    dedupeKey: null,
    readAt: null,
    createdAt: now,
    updatedAt: now,
    createdBy: 'system',
    updatedBy: 'system',
    deletedAt: null,
    ...overrides,
  }
}

const duplicateError = (): PrismaClientKnownRequestError =>
  new PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  })

describe('NotificationsService', () => {
  let service: NotificationsService
  let prisma: any
  let pubsub: any

  beforeEach(() => {
    prisma = {
      notification: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        updateMany: jest.fn(),
      },
    }
    pubsub = { publish: jest.fn() }
    service = new NotificationsService(prisma, pubsub)
  })

  describe('create', () => {
    it('normalizes input, persists, and publishes on the recipient channel', async () => {
      const created = row({ title: 'A title', body: 'A body' })
      prisma.notification.create.mockResolvedValue(created)

      await expect(
        service.create('tenant-1', 'actor-1', {
          recipientUserId: 'user-1',
          type: 'TASK_ASSIGNED',
          title: '  A   title ',
          body: '  A body ',
          taskId: 'task-1',
          dedupeKey: 'task-1-assigned',
        }),
      ).resolves.toEqual(created)

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 'tenant-1',
            userId: 'user-1',
            title: 'A   title',
            body: 'A body',
            createdBy: 'actor-1',
            dedupeKey: 'task-1-assigned',
          }),
        }),
      )
      expect(pubsub.publish).toHaveBeenCalledWith(
        `${PUBSUB_NOTIFICATION_CREATED}:tenant-1:user-1`,
        created,
      )
    })

    it('returns the existing row and does not publish on a dedupe collision', async () => {
      const existing = row({ title: 'Existing' })
      prisma.notification.create.mockRejectedValue(duplicateError())
      prisma.notification.findFirst.mockResolvedValue(existing)

      await expect(
        service.create('tenant-1', 'actor-1', {
          recipientUserId: 'user-1',
          type: 'TASK_ASSIGNED',
          title: 'New title',
          dedupeKey: 'task-1-assigned',
        }),
      ).resolves.toEqual(existing)
      expect(pubsub.publish).not.toHaveBeenCalled()
    })

    it('retries creation when the colliding row was soft-deleted', async () => {
      const recreated = row({ id: 'notification-2' })
      prisma.notification.create
        .mockRejectedValueOnce(duplicateError())
        .mockResolvedValueOnce(recreated)
      prisma.notification.findFirst.mockResolvedValue(null)

      await expect(
        service.create('tenant-1', 'actor-1', {
          recipientUserId: 'user-1',
          type: 'TASK_ASSIGNED',
          title: 'Retry me',
          dedupeKey: 'task-1-assigned',
        }),
      ).resolves.toEqual(recreated)
      expect(prisma.notification.create).toHaveBeenCalledTimes(2)
      expect(pubsub.publish).toHaveBeenCalledTimes(1)
    })
  })

  describe('findMany and countUnread', () => {
    it('filters unread notifications and clamps pagination', async () => {
      prisma.notification.findMany.mockResolvedValue([row()])
      prisma.notification.count.mockResolvedValue(1)

      await expect(
        service.findMany('tenant-1', 'user-1', { unreadOnly: true }, { page: 0, pageSize: 999 }),
      ).resolves.toEqual({ items: [row()], total: 1, page: 1, pageSize: 100 })
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-1', userId: 'user-1', deletedAt: null, readAt: null },
          skip: 0,
          take: 100,
        }),
      )
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', userId: 'user-1', deletedAt: null, readAt: null },
      })
    })

    it('counts only active unread notifications', async () => {
      prisma.notification.count.mockResolvedValue(3)
      await expect(service.countUnread('tenant-1', 'user-1')).resolves.toBe(3)
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', userId: 'user-1', readAt: null, deletedAt: null },
      })
    })
  })

  describe('markRead', () => {
    it('marks an unread notification and returns the updated record', async () => {
      const updated = row({ readAt: new Date('2026-01-02T00:00:00.000Z') })
      prisma.notification.updateMany.mockResolvedValue({ count: 1 })
      prisma.notification.findFirst.mockResolvedValue(updated)

      await expect(service.markRead('tenant-1', 'user-1', 'notification-1')).resolves.toEqual(
        updated,
      )
      expect(prisma.notification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'notification-1',
            tenantId: 'tenant-1',
            userId: 'user-1',
            readAt: null,
            deletedAt: null,
          },
          data: expect.objectContaining({ updatedBy: 'user-1', readAt: expect.any(Date) }),
        }),
      )
    })

    it('is idempotent when the notification was already read', async () => {
      const existing = row({ readAt: new Date('2026-01-02T00:00:00.000Z') })
      prisma.notification.updateMany.mockResolvedValue({ count: 0 })
      prisma.notification.findFirst.mockResolvedValue(existing)
      await expect(service.markRead('tenant-1', 'user-1', 'notification-1')).resolves.toEqual(
        existing,
      )
    })

    it('throws when no active notification belongs to the caller', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 0 })
      prisma.notification.findFirst.mockResolvedValue(null)
      await expect(service.markRead('tenant-1', 'user-1', 'missing')).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('markAllRead', () => {
    it('returns the number of unread notifications updated', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 4 })
      await expect(service.markAllRead('tenant-1', 'user-1')).resolves.toBe(4)
      expect(prisma.notification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-1', userId: 'user-1', readAt: null, deletedAt: null },
        }),
      )
    })
  })

  it('preserves non-duplicate create failures', async () => {
    const error = new ForbiddenException('blocked')
    prisma.notification.create.mockRejectedValue(error)
    await expect(
      service.create('tenant-1', 'actor-1', {
        recipientUserId: 'user-1',
        type: 'TASK_ASSIGNED',
        title: 'Blocked',
      }),
    ).rejects.toThrow(error)
  })
})
