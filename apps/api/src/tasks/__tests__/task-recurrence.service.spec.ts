import { TaskRecurrenceService } from '../task-recurrence.service'
import type { PrismaService } from '../../prisma/prisma.service'
import type { TaskPubSubService } from '../task-pubsub.service'
import type { BackgroundMetricsPort } from '../../observability/metrics.types'

const TENANT = 'tenant-1'
const USER = 'user-1'

interface MockPrisma {
  task: {
    findFirst: jest.Mock
    findMany: jest.Mock
    create: jest.Mock
  }
  auditLog: {
    create: jest.Mock
  }
  $transaction: jest.Mock
}

function buildPrismaMock(): MockPrisma {
  const task = {
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: 'new-task-1' }),
  }
  const auditLog = {
    create: jest.fn(),
  }
  return {
    task,
    auditLog,
    $transaction: jest.fn(async (cb: (tx: Record<string, unknown>) => unknown) => {
      return cb({ task, auditLog })
    }),
  }
}

interface MockServiceBundle {
  service: TaskRecurrenceService
  pubsub: { publish: jest.Mock }
}

function makeService(
  prisma: MockPrisma,
  backgroundMetrics?: BackgroundMetricsPort,
): MockServiceBundle {
  const pubsub = { publish: jest.fn() }
  const service = new TaskRecurrenceService(
    prisma as unknown as PrismaService,
    pubsub as unknown as TaskPubSubService,
    backgroundMetrics,
  )
  return { service, pubsub }
}

describe('TaskRecurrenceService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = buildPrismaMock()
  })

  describe('runRecurringTaskGeneration()', () => {
    it('returns empty when there are no recurring templates', async () => {
      const { service } = makeService(prisma)
      prisma.task.findMany.mockResolvedValue([])

      const result = await service.runRecurringTaskGeneration(
        TENANT,
        USER,
        new Date('2026-08-08T00:00:00.000Z'),
      )

      expect(result).toEqual({ generated: 0, templatesScanned: 0 })
    })

    it('records bounded success labels and duration without affecting the result', async () => {
      const metrics: BackgroundMetricsPort = {
        recordJob: jest.fn(),
        observeJobDuration: jest.fn(),
      }
      const { service } = makeService(prisma, metrics)

      await expect(
        service.runRecurringTaskGeneration(TENANT, USER, new Date('2026-08-08T00:00:00.000Z')),
      ).resolves.toEqual({ generated: 0, templatesScanned: 0 })

      expect(metrics.recordJob).toHaveBeenCalledWith({
        jobGroup: 'task_recurrence',
        outcome: 'success',
      })
      expect(metrics.observeJobDuration).toHaveBeenCalledWith(
        { jobGroup: 'task_recurrence', outcome: 'success' },
        expect.any(Number),
      )
    })

    it('keeps recurrence behavior when metrics throw', async () => {
      const metrics: BackgroundMetricsPort = {
        recordJob: jest.fn(() => {
          throw new Error('metrics unavailable')
        }),
        observeJobDuration: jest.fn(() => {
          throw new Error('metrics unavailable')
        }),
      }
      const { service } = makeService(prisma, metrics)

      await expect(
        service.runRecurringTaskGeneration(TENANT, USER, new Date('2026-08-08T00:00:00.000Z')),
      ).resolves.toEqual({ generated: 0, templatesScanned: 0 })
    })

    it('records error labels when the recurrence query fails', async () => {
      const metrics: BackgroundMetricsPort = {
        recordJob: jest.fn(),
        observeJobDuration: jest.fn(),
      }
      prisma.task.findMany.mockRejectedValueOnce(new Error('database unavailable'))
      const { service } = makeService(prisma, metrics)

      await expect(
        service.runRecurringTaskGeneration(TENANT, USER, new Date('2026-08-08T00:00:00.000Z')),
      ).rejects.toThrow('database unavailable')

      expect(metrics.recordJob).toHaveBeenCalledWith({
        jobGroup: 'task_recurrence',
        outcome: 'error',
      })
      expect(metrics.observeJobDuration).toHaveBeenCalledWith(
        { jobGroup: 'task_recurrence', outcome: 'error' },
        expect.any(Number),
      )
    })

    it('generates occurrences for a daily template', async () => {
      const { service } = makeService(prisma)
      const now = new Date('2026-08-04T00:00:00.000Z')

      // One template with dueDate on Aug 1
      prisma.task.findMany
        .mockResolvedValueOnce([
          {
            id: 'template-1',
            tenantId: TENANT,
            title: 'Daily standup',
            description: null,
            priority: 'MEDIUM',
            dueDate: new Date('2026-08-01T00:00:00.000Z'),
            assignedTo: USER,
            contactId: null,
            dealId: null,
            recurrencePattern: 'DAILY',
            recurrenceEndDate: null,
          },
        ])
        // findFirst for max occurrence date — returns null (no existing occurrences)
        .mockResolvedValueOnce(null)

      const result = await service.runRecurringTaskGeneration(TENANT, USER, now)

      // Aug 2, Aug 3, Aug 4 = 3 occurrences
      expect(result.generated).toBe(3)
      expect(result.templatesScanned).toBe(1)
      expect(prisma.task.create).toHaveBeenCalledTimes(3)
    })

    it('does not resurrect soft-deleted occurrences (idempotency)', async () => {
      const { service } = makeService(prisma)
      const now = new Date('2026-08-03T00:00:00.000Z')

      prisma.task.findMany
        .mockResolvedValueOnce([
          {
            id: 'template-1',
            tenantId: TENANT,
            title: 'Task',
            description: null,
            priority: 'MEDIUM',
            dueDate: new Date('2026-08-01T00:00:00.000Z'),
            assignedTo: USER,
            contactId: null,
            dealId: null,
            recurrencePattern: 'DAILY',
            recurrenceEndDate: null,
          },
        ])
        .mockResolvedValueOnce(null)

      // The findFirst inside $transaction returns a match (soft-deleted occurrence exists)
      const existingTask = { id: 'existing-1' }
      prisma.$transaction.mockImplementation(
        async (cb: (tx: Record<string, unknown>) => unknown) => {
          const tx = {
            task: {
              findFirst: jest.fn().mockResolvedValue(existingTask),
              create: jest.fn(),
            },
            auditLog: { create: jest.fn() },
          }
          return cb(tx)
        },
      )

      const result = await service.runRecurringTaskGeneration(TENANT, USER, now)

      // findFirst returned existing, so create should not be called
      expect(result.generated).toBe(0)
    })

    it('stops at recurrenceEndDate (inclusive)', async () => {
      const { service } = makeService(prisma)
      const now = new Date('2026-08-10T00:00:00.000Z')

      prisma.task.findMany
        .mockResolvedValueOnce([
          {
            id: 'template-1',
            tenantId: TENANT,
            title: 'Task',
            description: null,
            priority: 'MEDIUM',
            dueDate: new Date('2026-08-01T00:00:00.000Z'),
            assignedTo: USER,
            contactId: null,
            dealId: null,
            recurrencePattern: 'DAILY',
            recurrenceEndDate: new Date('2026-08-03T00:00:00.000Z'), // stops at Aug 3
          },
        ])
        .mockResolvedValueOnce(null)

      const result = await service.runRecurringTaskGeneration(TENANT, USER, now)

      // Aug 2, Aug 3 only (endDate inclusive), not Aug 4+
      expect(result.generated).toBe(2)
    })

    it('skips templates with no dueDate', async () => {
      const { service } = makeService(prisma)
      const now = new Date('2026-08-08T00:00:00.000Z')

      prisma.task.findMany.mockResolvedValueOnce([
        {
          id: 'template-1',
          tenantId: TENANT,
          title: 'Task',
          description: null,
          priority: 'MEDIUM',
          dueDate: null, // no dueDate
          assignedTo: USER,
          contactId: null,
          dealId: null,
          recurrencePattern: 'DAILY',
          recurrenceEndDate: null,
        },
      ])

      const result = await service.runRecurringTaskGeneration(TENANT, USER, now)

      expect(result.generated).toBe(0)
      expect(result.templatesScanned).toBe(1)
    })

    it('never generates for an occurrence (parentTaskId != null)', async () => {
      const { service } = makeService(prisma)
      const now = new Date('2026-08-08T00:00:00.000Z')

      // Templates are filtered by parentTaskId: null in the query,
      // but let's verify the query is correct
      prisma.task.findMany.mockResolvedValueOnce([])

      await service.runRecurringTaskGeneration(TENANT, USER, now)

      const templatesQuery = prisma.task.findMany.mock.calls[0][0]
      expect(templatesQuery.where.parentTaskId).toBeNull()
      expect(templatesQuery.where.isRecurring).toBe(true)
    })

    it('caps at MAX_OCCURRENCES_PER_TEMPLATE_PER_RUN (30)', async () => {
      const { service } = makeService(prisma)
      // Use a far-future date to trigger the max cap
      const now = new Date('2027-01-01T00:00:00.000Z')

      prisma.task.findMany
        .mockResolvedValueOnce([
          {
            id: 'template-1',
            tenantId: TENANT,
            title: 'Task',
            description: null,
            priority: 'MEDIUM',
            dueDate: new Date('2026-01-01T00:00:00.000Z'),
            assignedTo: USER,
            contactId: null,
            dealId: null,
            recurrencePattern: 'DAILY',
            recurrenceEndDate: null,
          },
        ])
        .mockResolvedValueOnce(null)

      const result = await service.runRecurringTaskGeneration(TENANT, USER, now)

      expect(result.generated).toBe(30) // capped at 30
    })
  })

  describe('ensureRecurrenceGeneratedToday()', () => {
    it('does not throw when the sweep fails', async () => {
      const { service } = makeService(prisma)
      prisma.task.findMany.mockRejectedValue(new Error('DB error'))

      // Should not throw
      await expect(
        service.ensureRecurrenceGeneratedToday(TENANT, USER, new Date()),
      ).resolves.toBeUndefined()
    })

    it('only runs once per day', async () => {
      const { service } = makeService(prisma)
      const now = new Date('2026-08-08T14:00:00.000Z')

      prisma.task.findMany.mockResolvedValue([])

      await service.ensureRecurrenceGeneratedToday(TENANT, USER, now)
      await service.ensureRecurrenceGeneratedToday(TENANT, USER, now)

      // findMany should only be called once (second call is a no-op)
      expect(prisma.task.findMany).toHaveBeenCalledTimes(1)
    })
  })
})
