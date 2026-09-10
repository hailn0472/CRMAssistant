import { NotificationsService } from '../notifications.service'
import type { BackgroundMetricsPort } from '../../observability/metrics.types'
import type { PrismaService } from '../../prisma/prisma.service'
import type { NotificationPubSubService } from '../notification-pubsub.service'

function makeRow(): Record<string, unknown> {
  const now = new Date('2026-01-01T00:00:00.000Z')
  return {
    id: 'notification-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    type: 'TASK_ASSIGNED',
    title: 'Task assigned',
    body: null,
    taskId: null,
    reportExportId: null,
    dedupeKey: null,
    readAt: null,
    createdAt: now,
    updatedAt: now,
    createdBy: 'system',
    updatedBy: 'system',
    deletedAt: null,
  }
}

function makeMetrics(): BackgroundMetricsPort & {
  recordJob: jest.Mock
  observeJobDuration: jest.Mock
} {
  return { recordJob: jest.fn(), observeJobDuration: jest.fn() }
}

describe('NotificationsService background metrics', () => {
  it('records success and duration for a notification producer', async () => {
    const metrics = makeMetrics()
    const prisma = { notification: { create: jest.fn().mockResolvedValue(makeRow()) } }
    const pubsub = { publish: jest.fn() }
    const service = new NotificationsService(
      prisma as unknown as PrismaService,
      pubsub as unknown as NotificationPubSubService,
      metrics,
    )

    await expect(
      service.notifySafe('tenant-1', 'system', {
        recipientUserId: 'user-1',
        type: 'TASK_ASSIGNED',
        title: 'Task assigned',
      }),
    ).resolves.toBe(true)

    expect(metrics.recordJob).toHaveBeenCalledWith({
      jobGroup: 'notification',
      outcome: 'success',
    })
    expect(metrics.observeJobDuration).toHaveBeenCalledWith(
      { jobGroup: 'notification', outcome: 'success' },
      expect.any(Number),
    )
  })

  it('records error while preserving notifySafe failure behavior', async () => {
    const metrics = makeMetrics()
    const prisma = {
      notification: { create: jest.fn().mockRejectedValue(new Error('database unavailable')) },
    }
    const pubsub = { publish: jest.fn() }
    const service = new NotificationsService(
      prisma as unknown as PrismaService,
      pubsub as unknown as NotificationPubSubService,
      metrics,
    )

    await expect(
      service.notifySafe('tenant-1', 'system', {
        recipientUserId: 'user-1',
        type: 'TASK_ASSIGNED',
        title: 'Task assigned',
      }),
    ).resolves.toBe(false)

    expect(metrics.recordJob).toHaveBeenCalledWith({ jobGroup: 'notification', outcome: 'error' })
    expect(metrics.observeJobDuration).toHaveBeenCalledWith(
      { jobGroup: 'notification', outcome: 'error' },
      expect.any(Number),
    )
  })

  it('ignores metric failures', async () => {
    const metrics: BackgroundMetricsPort = {
      recordJob: jest.fn(() => {
        throw new Error('metrics unavailable')
      }),
      observeJobDuration: jest.fn(() => {
        throw new Error('metrics unavailable')
      }),
    }
    const prisma = { notification: { create: jest.fn().mockResolvedValue(makeRow()) } }
    const pubsub = { publish: jest.fn() }
    const service = new NotificationsService(
      prisma as unknown as PrismaService,
      pubsub as unknown as NotificationPubSubService,
      metrics,
    )

    await expect(
      service.notifySafe('tenant-1', 'system', {
        recipientUserId: 'user-1',
        type: 'TASK_ASSIGNED',
        title: 'Task assigned',
      }),
    ).resolves.toBe(true)
  })
})
