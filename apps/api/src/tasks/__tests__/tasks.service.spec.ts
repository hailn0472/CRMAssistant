import { BadRequestException, NotFoundException } from '@nestjs/common'

// Mock visibility-check at module top — stubbing BOTH exports so no real DB
// role lookup runs during unit tests (AC 86).
jest.mock('../../common/guards/visibility-check', () => ({
  resolveVisibilityFilter: jest.fn(),
  registerVisibilityService: jest.fn(),
}))

import { resolveVisibilityFilter } from '../../common/guards/visibility-check'
import { TasksService } from '../tasks.service'
import type { TaskSortInput } from '../tasks.service'
import { TaskTemplatesService } from '../task-templates.service'
import { TaskPubSubService, PUBSUB_TASK_ASSIGNED } from '../task-pubsub.service'
import type { TaskListItem } from '../tasks.service'
import type { PrismaService } from '../../prisma/prisma.service'
import type { ContactsService } from '../../contacts/contacts.service'
import type { DealsService } from '../../deals/deals.service'
import type { AuditService } from '../../audit/audit.service'
import type { ActivityService } from '../../activities/activities.service'
import type { ActivityLogPreferenceService } from '../../activities/activity-log-preference.service'
import type { CalendarSyncService } from '../../calendar/calendar-sync.service'
import type { Prisma } from '@prisma/client'

const mockResolveVisibilityFilter = resolveVisibilityFilter as jest.Mock

type TaskDelegate = {
  create: jest.Mock
  findFirst: jest.Mock
  findMany: jest.Mock
  count: jest.Mock
  updateMany: jest.Mock
}

type MockPrisma = {
  task: TaskDelegate
  user: { findFirst: jest.Mock }
  taskTemplate: {
    findFirst: jest.Mock
    findMany: jest.Mock
    count: jest.Mock
    create: jest.Mock
    updateMany: jest.Mock
  }
  taskDependency: {
    findMany: jest.Mock
  }
  $transaction: jest.Mock
}

const TENANT = 'tenant-1'
const USER = 'user-1'

function makeTask(overrides: Partial<TaskListItem> = {}): TaskListItem {
  return {
    id: 'task-1',
    tenantId: TENANT,
    title: 'Follow up with Acme',
    description: null,
    status: 'TODO',
    priority: 'MEDIUM',
    dueDate: null,
    assignedTo: USER,
    contactId: null,
    dealId: null,
    completedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    createdBy: USER,
    updatedBy: USER,
    // Story 4.6: recurrence fields (AC 44)
    isRecurring: false,
    recurrencePattern: null,
    recurrenceEndDate: null,
    parentTaskId: null,
    assignee: { id: USER, firstName: 'Test', lastName: 'User', email: 'test@local', avatar: null },
    contact: null,
    deal: null,
    ...overrides,
  }
}

function buildPrismaMock(): MockPrisma {
  const task: TaskDelegate = {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    updateMany: jest.fn(),
  }
  return {
    task,
    user: { findFirst: jest.fn() },
    taskTemplate: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    taskDependency: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb({})),
  }
}

function makeService(prisma: MockPrisma): {
  service: TasksService
  contacts: { findOne: jest.Mock }
  deals: { findOne: jest.Mock }
  templates: { findOneForTenant: jest.Mock }
  pubsub: { publish: jest.Mock }
  audit: { log: jest.Mock }
  activity: { logSafe: jest.Mock }
  activityLogPreference: { isEnabled: jest.Mock }
  calendarSync: { syncTaskSafe: jest.Mock; removeTaskFromCalendarSafe: jest.Mock }
} {
  const contacts = { findOne: jest.fn() }
  const deals = { findOne: jest.fn() }
  const templates = { findOneForTenant: jest.fn() }
  const pubsub = { publish: jest.fn() }
  const audit = { log: jest.fn() }
  const activity = { logSafe: jest.fn().mockResolvedValue(null) }
  const activityLogPreference = { isEnabled: jest.fn().mockResolvedValue(true) }
  // Story 4.3: the calendar sync hook is best-effort — by default resolves
  // so hook assertions can observe the calls.
  const calendarSync = {
    syncTaskSafe: jest.fn().mockResolvedValue(undefined),
    removeTaskFromCalendarSafe: jest.fn().mockResolvedValue(undefined),
  }
  const service = new TasksService(
    prisma as unknown as PrismaService,
    contacts as unknown as ContactsService,
    deals as unknown as DealsService,
    templates as unknown as TaskTemplatesService,
    pubsub as unknown as TaskPubSubService,
    audit as unknown as AuditService,
    activity as unknown as ActivityService,
    activityLogPreference as unknown as ActivityLogPreferenceService,
    calendarSync as unknown as CalendarSyncService,
  )
  return {
    service,
    contacts,
    deals,
    templates,
    pubsub,
    audit,
    activity,
    activityLogPreference,
    calendarSync,
  }
}

describe('TasksService', () => {
  let prisma: MockPrisma

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = buildPrismaMock()
    // Default: ADMIN/ALL visibility (undefined filter) — overridden per test
    mockResolveVisibilityFilter.mockResolvedValue(undefined)
  })

  describe('create()', () => {
    it('creates a task scoped to the tenant with all required fields', async () => {
      const { service, audit } = makeService(prisma)
      const created = makeTask({ title: '  Follow up with Acme  ' })
      prisma.task.create.mockResolvedValue(created)
      prisma.task.findFirst.mockResolvedValue(created)

      const result = await service.create(TENANT, USER, {
        title: '  Follow up with Acme  ',
      })

      expect(prisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT,
            title: 'Follow up with Acme',
            createdBy: USER,
            updatedBy: USER,
          }),
        }),
      )
      expect(result.id).toBe('task-1')
      expect(audit.log).toHaveBeenCalledWith({
        tenantId: TENANT,
        userId: USER,
        action: 'CREATE',
        entity: 'TASK',
        entityId: 'task-1',
        details: { mutationName: 'CREATE' },
      })
    })

    it('rejects an empty title with BadRequestException', async () => {
      const { service } = makeService(prisma)
      await expect(service.create(TENANT, USER, { title: '   ' })).rejects.toThrow(
        BadRequestException,
      )
      expect(prisma.task.create).not.toHaveBeenCalled()
    })

    it('rejects an over-length title with BadRequestException', async () => {
      const { service } = makeService(prisma)
      await expect(service.create(TENANT, USER, { title: 'x'.repeat(201) })).rejects.toThrow(
        BadRequestException,
      )
    })

    it('rejects an over-length description with BadRequestException', async () => {
      const { service } = makeService(prisma)
      await expect(
        service.create(TENANT, USER, { title: 'Task', description: 'x'.repeat(5001) }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects an invalid status with BadRequestException and the AC 29 message', async () => {
      const { service } = makeService(prisma)
      await expect(
        service.create(TENANT, USER, { title: 'Task', status: 'BLOCKED' }),
      ).rejects.toThrow('status must be one of TODO, IN_PROGRESS, COMPLETED, CANCELLED')
    })

    it('rejects an invalid priority with BadRequestException', async () => {
      const { service } = makeService(prisma)
      await expect(
        service.create(TENANT, USER, { title: 'Task', priority: 'CRITICAL' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects an invalid dueDate with BadRequestException', async () => {
      const { service } = makeService(prisma)
      await expect(
        service.create(TENANT, USER, { title: 'Task', dueDate: 'not-a-date' }),
      ).rejects.toThrow('dueDate is not a valid date')
    })

    it('normalises dueDate to UTC midnight', async () => {
      const { service } = makeService(prisma)
      const created = makeTask({ dueDate: new Date('2026-08-05T00:00:00.000Z') })
      prisma.task.create.mockResolvedValue(created)
      prisma.task.findFirst.mockResolvedValue(created)

      await service.create(TENANT, USER, {
        title: 'Task',
        dueDate: '2026-08-05T14:30:00.000Z',
      })

      const createCall = prisma.task.create.mock.calls[0][0]
      expect(createCall.data.dueDate.toISOString()).toBe('2026-08-05T00:00:00.000Z')
    })

    it('stores null for a whitespace-only description', async () => {
      const { service } = makeService(prisma)
      const created = makeTask({ description: null })
      prisma.task.create.mockResolvedValue(created)
      prisma.task.findFirst.mockResolvedValue(created)

      await service.create(TENANT, USER, { title: 'Task', description: '   ' })

      const createCall = prisma.task.create.mock.calls[0][0]
      expect(createCall.data.description).toBeNull()
    })

    it('defaults assignedTo to the creating user', async () => {
      const { service } = makeService(prisma)
      const created = makeTask({ assignedTo: USER })
      prisma.task.create.mockResolvedValue(created)
      prisma.task.findFirst.mockResolvedValue(created)

      await service.create(TENANT, USER, { title: 'Task' })

      expect(prisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ assignedTo: USER }) }),
      )
    })

    it('defaults status to TODO and priority to MEDIUM', async () => {
      const { service } = makeService(prisma)
      const created = makeTask()
      prisma.task.create.mockResolvedValue(created)
      prisma.task.findFirst.mockResolvedValue(created)

      await service.create(TENANT, USER, { title: 'Task' })

      expect(prisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'TODO', priority: 'MEDIUM' }),
        }),
      )
    })

    it('routes contactId through ContactsService.findOne', async () => {
      const { service, contacts } = makeService(prisma)
      contacts.findOne.mockResolvedValue({ id: 'contact-1' })
      const created = makeTask({ contactId: 'contact-1' })
      prisma.task.create.mockResolvedValue(created)
      prisma.task.findFirst.mockResolvedValue(created)

      await service.create(TENANT, USER, { title: 'Task', contactId: 'contact-1' })

      expect(contacts.findOne).toHaveBeenCalledWith(TENANT, USER, 'contact-1')
    })

    it('routes dealId through DealsService.findOne', async () => {
      const { service, deals } = makeService(prisma)
      deals.findOne.mockResolvedValue({ id: 'deal-1' })
      const created = makeTask({ dealId: 'deal-1' })
      prisma.task.create.mockResolvedValue(created)
      prisma.task.findFirst.mockResolvedValue(created)

      await service.create(TENANT, USER, { title: 'Task', dealId: 'deal-1' })

      expect(deals.findOne).toHaveBeenCalledWith(TENANT, USER, 'deal-1')
    })

    it('propagates a NotFoundException from the owning service', async () => {
      const { service, contacts } = makeService(prisma)
      contacts.findOne.mockRejectedValue(new NotFoundException('Contact not found'))

      await expect(
        service.create(TENANT, USER, { title: 'Task', contactId: 'missing' }),
      ).rejects.toThrow('Contact not found')
      expect(prisma.task.create).not.toHaveBeenCalled()
    })

    it('publishes TASK_ASSIGNED when the resulting assignee is not the caller', async () => {
      const { service, pubsub } = makeService(prisma)
      const created = makeTask({ assignedTo: 'user-2' })
      prisma.user.findFirst.mockResolvedValue({ id: 'user-2', isActive: true })
      prisma.task.create.mockResolvedValue(created)
      prisma.task.findFirst.mockResolvedValue(created)

      await service.create(TENANT, USER, { title: 'Task', assignedTo: 'user-2' })

      expect(pubsub.publish).toHaveBeenCalledWith(
        `${PUBSUB_TASK_ASSIGNED}:${TENANT}:user-2`,
        created,
      )
    })

    it('does not publish TASK_ASSIGNED on self-assignment but publishes TASK_CHANGED (AC 14)', async () => {
      const { service, pubsub } = makeService(prisma)
      const created = makeTask({ assignedTo: USER })
      prisma.task.create.mockResolvedValue(created)
      prisma.task.findFirst.mockResolvedValue(created)

      await service.create(TENANT, USER, { title: 'Task' })

      expect(pubsub.publish).not.toHaveBeenCalledWith(
        `${PUBSUB_TASK_ASSIGNED}:${TENANT}:${USER}`,
        expect.anything(),
      )
      expect(pubsub.publish).toHaveBeenCalledWith(`TASK_CHANGED:${TENANT}`, created)
    })

    it('rejects a nonexistent assignedTo with BadRequestException', async () => {
      const { service } = makeService(prisma)
      prisma.user.findFirst.mockResolvedValue(null)

      await expect(
        service.create(TENANT, USER, { title: 'Task', assignedTo: 'invalid-uuid' }),
      ).rejects.toThrow('Assignee not found in this tenant')
      expect(prisma.task.create).not.toHaveBeenCalled()
    })

    it('accepts a valid foreign assignedTo with a real user', async () => {
      const { service } = makeService(prisma)
      prisma.user.findFirst.mockResolvedValue({ id: 'user-2', isActive: true })
      const created = makeTask({ assignedTo: 'user-2' })
      prisma.task.create.mockResolvedValue(created)
      prisma.task.findFirst.mockResolvedValue(created)

      const result = await service.create(TENANT, USER, {
        title: 'Task',
        assignedTo: 'user-2',
      })

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'user-2', tenantId: TENANT, deletedAt: null, isActive: true },
      })
      expect(result.assignedTo).toBe('user-2')
    })
  })

  describe('findOne()', () => {
    it('returns the task when found and visible', async () => {
      const { service } = makeService(prisma)
      const task = makeTask()
      prisma.task.findFirst.mockResolvedValue(task)

      const result = await service.findOne(TENANT, USER, 'task-1')

      expect(result.id).toBe('task-1')
      expect(prisma.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'task-1', tenantId: TENANT, deletedAt: null } }),
      )
    })

    it('throws the identical message for a missing task', async () => {
      const { service } = makeService(prisma)
      prisma.task.findFirst.mockResolvedValue(null)

      await expect(service.findOne(TENANT, USER, 'missing')).rejects.toThrow('Task not found')
    })

    it('throws the identical message for a cross-tenant task', async () => {
      const { service } = makeService(prisma)
      prisma.task.findFirst.mockResolvedValue(null)

      await expect(service.findOne('other-tenant', USER, 'task-1')).rejects.toThrow(
        'Task not found',
      )
    })

    it('throws the identical message for a soft-deleted task', async () => {
      const { service } = makeService(prisma)
      prisma.task.findFirst.mockResolvedValue(null)

      await expect(service.findOne(TENANT, USER, 'deleted')).rejects.toThrow('Task not found')
    })

    it('allows access when OWN filter matches the task assignee', async () => {
      const { service } = makeService(prisma)
      mockResolveVisibilityFilter.mockResolvedValue(USER)
      prisma.task.findFirst.mockResolvedValue(makeTask({ assignedTo: USER }))

      const result = await service.findOne(TENANT, USER, 'task-1')
      expect(result.id).toBe('task-1')
    })

    it('denies access when OWN filter does not match the task assignee', async () => {
      const { service } = makeService(prisma)
      mockResolveVisibilityFilter.mockResolvedValue('someone-else')
      prisma.task.findFirst.mockResolvedValue(makeTask({ assignedTo: USER }))

      await expect(service.findOne(TENANT, USER, 'task-1')).rejects.toThrow('Task not found')
    })

    it('allows access when TEAM filter includes the task assignee', async () => {
      const { service } = makeService(prisma)
      mockResolveVisibilityFilter.mockResolvedValue({ in: ['user-1', 'user-2'] })
      prisma.task.findFirst.mockResolvedValue(makeTask({ assignedTo: 'user-2' }))

      const result = await service.findOne(TENANT, USER, 'task-1')
      expect(result.id).toBe('task-1')
    })

    it('denies access when TEAM filter excludes the task assignee', async () => {
      const { service } = makeService(prisma)
      mockResolveVisibilityFilter.mockResolvedValue({ in: ['user-3'] })
      prisma.task.findFirst.mockResolvedValue(makeTask({ assignedTo: 'user-2' }))

      await expect(service.findOne(TENANT, USER, 'task-1')).rejects.toThrow('Task not found')
    })

    it('allows access for ALL/ADMIN visibility (undefined filter)', async () => {
      const { service } = makeService(prisma)
      mockResolveVisibilityFilter.mockResolvedValue(undefined)
      prisma.task.findFirst.mockResolvedValue(makeTask({ assignedTo: 'anyone' }))

      const result = await service.findOne(TENANT, USER, 'task-1')
      expect(result.id).toBe('task-1')
    })

    it('casts the visibility filter into the task where (AC 26)', async () => {
      const { service } = makeService(prisma)
      mockResolveVisibilityFilter.mockResolvedValue({ in: ['user-2'] })
      prisma.task.findMany.mockResolvedValue([makeTask()])
      prisma.task.count.mockResolvedValue(1)

      await service.findMany(TENANT, USER)

      const where = prisma.task.findMany.mock.calls[0][0].where
      expect(where.AND[0]).toEqual({ assignedTo: { in: ['user-2'] } })
    })
  })

  describe('getStats()', () => {
    it('returns the four workspace counters scoped to the tenant', async () => {
      const { service } = makeService(prisma)
      prisma.task.count
        .mockResolvedValueOnce(168)
        .mockResolvedValueOnce(6)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(42)

      const result = await service.getStats(TENANT, USER)

      expect(result).toEqual({ openTasks: 168, dueToday: 6, overdue: 3, completedThisWeek: 42 })
      expect(prisma.task.count).toHaveBeenCalledTimes(4)
      for (const call of prisma.task.count.mock.calls) {
        expect(call[0].where).toEqual(
          expect.objectContaining({ tenantId: TENANT, deletedAt: null }),
        )
      }
    })

    it('counts open tasks as TODO or IN_PROGRESS only', async () => {
      const { service } = makeService(prisma)
      prisma.task.count.mockResolvedValue(0)

      await service.getStats(TENANT, USER)

      expect(prisma.task.count.mock.calls[0][0].where.status).toEqual({
        in: ['TODO', 'IN_PROGRESS'],
      })
    })

    it('counts due-today and overdue at the UTC day boundary, excluding closed tasks', async () => {
      const { service } = makeService(prisma)
      prisma.task.count.mockResolvedValue(0)
      const now = new Date('2026-08-15T09:30:00.000Z')

      await service.getStats(TENANT, USER, now)

      const dueTodayWhere = prisma.task.count.mock.calls[1][0].where
      expect(dueTodayWhere.status).toEqual({ in: ['TODO', 'IN_PROGRESS'] })
      expect(dueTodayWhere.dueDate).toEqual({
        gte: new Date('2026-08-15T00:00:00.000Z'),
        lt: new Date('2026-08-16T00:00:00.000Z'),
      })

      const overdueWhere = prisma.task.count.mock.calls[2][0].where
      expect(overdueWhere.status).toEqual({ in: ['TODO', 'IN_PROGRESS'] })
      expect(overdueWhere.dueDate).toEqual({ lt: new Date('2026-08-15T00:00:00.000Z') })
    })

    it('counts completed-this-week as COMPLETED with completedAt in the trailing 7 days', async () => {
      const { service } = makeService(prisma)
      prisma.task.count.mockResolvedValue(0)
      const now = new Date('2026-08-15T09:30:00.000Z')

      await service.getStats(TENANT, USER, now)

      const where = prisma.task.count.mock.calls[3][0].where
      expect(where.status).toBe('COMPLETED')
      expect(where.completedAt).toEqual({ gte: new Date('2026-08-08T09:30:00.000Z') })
    })

    it('restricts every counter to the visibility scope when restricted', async () => {
      const { service } = makeService(prisma)
      mockResolveVisibilityFilter.mockResolvedValue(USER)
      prisma.task.count.mockResolvedValue(0)

      await service.getStats(TENANT, USER)

      for (const call of prisma.task.count.mock.calls) {
        expect(call[0].where.assignedTo).toBe(USER)
      }
    })
  })

  describe('findMany()', () => {
    it('returns an empty connection with default pagination', async () => {
      const { service } = makeService(prisma)
      prisma.task.findMany.mockResolvedValue([])
      prisma.task.count.mockResolvedValue(0)

      const result = await service.findMany(TENANT, USER)

      expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 20 })
    })

    it('clamps pageSize at MAX_PAGE_SIZE', async () => {
      const { service } = makeService(prisma)
      prisma.task.findMany.mockResolvedValue([])
      prisma.task.count.mockResolvedValue(0)

      await service.findMany(TENANT, USER, {}, { pageSize: 1000 })

      expect(prisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }))
    })

    it('clamps page to a minimum of 1', async () => {
      const { service } = makeService(prisma)
      prisma.task.findMany.mockResolvedValue([])
      prisma.task.count.mockResolvedValue(0)

      await service.findMany(TENANT, USER, {}, { page: 0 })

      expect(prisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0 }))
    })

    it('orders by dueDate asc nulls last then createdAt desc (SQL ordering)', async () => {
      const { service } = makeService(prisma)
      prisma.task.findMany.mockResolvedValue([])
      prisma.task.count.mockResolvedValue(0)

      await service.findMany(TENANT, USER)

      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
        }),
      )
    })

    it('runs findMany and count in parallel over the same where', async () => {
      const { service } = makeService(prisma)
      prisma.task.findMany.mockResolvedValue([])
      prisma.task.count.mockResolvedValue(0)

      await service.findMany(TENANT, USER)

      const where = prisma.task.findMany.mock.calls[0][0].where
      expect(prisma.task.count).toHaveBeenCalledWith({ where })
    })

    it('applies the visibility filter inside the where', async () => {
      const { service } = makeService(prisma)
      mockResolveVisibilityFilter.mockResolvedValue(USER)
      prisma.task.findMany.mockResolvedValue([])
      prisma.task.count.mockResolvedValue(0)

      await service.findMany(TENANT, USER)

      const where = prisma.task.findMany.mock.calls[0][0].where
      expect(where.AND).toContainEqual({ assignedTo: USER })
    })
  })

  describe('buildTaskWhere()', () => {
    it('produces only tenant + soft-delete scope with no AND for an empty filter', async () => {
      const { service } = makeService(prisma)
      const where = await service.buildTaskWhere(TENANT, USER, {})
      expect(where).toEqual({ tenantId: TENANT, deletedAt: null })
    })

    it('defaults filter to an empty object when omitted', async () => {
      const { service } = makeService(prisma)
      const where = await service.buildTaskWhere(TENANT, USER)
      expect(where).toEqual({ tenantId: TENANT, deletedAt: null })
    })

    it('adds a case-insensitive title search', async () => {
      const { service } = makeService(prisma)
      const where = await service.buildTaskWhere(TENANT, USER, { search: '  Acme  ' })
      expect(where.AND).toContainEqual({ title: { contains: 'Acme', mode: 'insensitive' } })
    })

    it('adds status, priority, assignedTo, contactId and dealId filters', async () => {
      const { service } = makeService(prisma)
      const where = await service.buildTaskWhere(TENANT, USER, {
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        assignedTo: 'user-2',
        contactId: 'contact-1',
        dealId: 'deal-1',
      })
      expect(where.AND).toContainEqual({ status: 'IN_PROGRESS' })
      expect(where.AND).toContainEqual({ priority: 'HIGH' })
      expect(where.AND).toContainEqual({ assignedTo: 'user-2' })
      expect(where.AND).toContainEqual({ contactId: 'contact-1' })
      expect(where.AND).toContainEqual({ dealId: 'deal-1' })
    })

    it('normalises dueDateTo to 23:59:59.999', async () => {
      const { service } = makeService(prisma)
      const where = await service.buildTaskWhere(TENANT, USER, {
        dueDateFrom: '2026-08-01T00:00:00.000Z',
        dueDateTo: '2026-08-05T00:00:00.000Z',
      })
      const dateFilter = (where.AND as Prisma.TaskWhereInput[])?.find(
        (c: Prisma.TaskWhereInput): c is { dueDate: { gte: Date; lte: Date } } => 'dueDate' in c,
      ) as { dueDate: { gte: Date; lte: Date } }
      expect(dateFilter.dueDate.gte.toISOString()).toBe('2026-08-01T00:00:00.000Z')
      // The To bound is normalised to 23:59:59.999 in the server's local time,
      // exactly as deals.service.ts normalises expectedCloseDateTo (AC 27).
      const expectedEnd = new Date('2026-08-05T00:00:00.000Z')
      expectedEnd.setHours(23, 59, 59, 999)
      expect(dateFilter.dueDate.lte.getTime()).toBe(expectedEnd.getTime())
    })

    it('adds overdueOnly as past dueDate with status not COMPLETED/CANCELLED', async () => {
      const { service } = makeService(prisma)
      const now = new Date('2026-08-03T12:00:00.000Z')
      const where = await service.buildTaskWhere(TENANT, USER, { overdueOnly: true }, now)
      expect(where.AND).toContainEqual({
        dueDate: { lt: new Date('2026-08-03T00:00:00.000Z') },
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      })
    })
  })

  describe('update()', () => {
    it('stamps completedAt when the update flips status to COMPLETED', async () => {
      const { service } = makeService(prisma)
      const now = new Date('2026-08-02T10:00:00.000Z')
      prisma.task.findFirst.mockResolvedValue(makeTask({ status: 'TODO', completedAt: null }))
      prisma.task.updateMany.mockResolvedValue({ count: 1 })

      await service.update(TENANT, USER, 'task-1', { status: 'COMPLETED' }, now)

      expect(prisma.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETED', completedAt: now }),
        }),
      )
    })

    it('does not re-stamp completedAt when the task is already COMPLETED', async () => {
      const { service } = makeService(prisma)
      const stampedAt = new Date('2026-08-01T00:00:00.000Z')
      prisma.task.findFirst.mockResolvedValue(
        makeTask({ status: 'COMPLETED', completedAt: stampedAt }),
      )
      prisma.task.updateMany.mockResolvedValue({ count: 1 })

      await service.update(TENANT, USER, 'task-1', { status: 'COMPLETED' })

      const data = prisma.task.updateMany.mock.calls[0][0].data as Record<string, unknown>
      expect(data).not.toHaveProperty('completedAt')
    })

    it('updates title, status and priority with tri-state semantics', async () => {
      const { service, audit } = makeService(prisma)
      const current = makeTask()
      prisma.task.findFirst.mockResolvedValue(current)
      prisma.task.updateMany.mockResolvedValue({ count: 1 })

      await service.update(TENANT, USER, 'task-1', {
        title: 'New title',
        status: 'IN_PROGRESS',
        priority: 'URGENT',
      })

      expect(prisma.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'task-1', tenantId: TENANT, deletedAt: null },
          data: expect.objectContaining({
            title: 'New title',
            status: 'IN_PROGRESS',
            priority: 'URGENT',
            updatedBy: USER,
          }),
        }),
      )
      expect(audit.log).toHaveBeenCalledWith({
        tenantId: TENANT,
        userId: USER,
        action: 'UPDATE',
        entity: 'TASK',
        entityId: 'task-1',
        details: { mutationName: 'UPDATE' },
      })
    })

    it('clears completedAt when status moves away from COMPLETED (AC 34)', async () => {
      const { service } = makeService(prisma)
      prisma.task.findFirst
        .mockResolvedValueOnce(
          makeTask({ status: 'COMPLETED', completedAt: new Date('2026-08-01T10:00:00.000Z') }),
        )
        .mockResolvedValueOnce(makeTask({ status: 'IN_PROGRESS' }))
      prisma.task.updateMany.mockResolvedValue({ count: 1 })

      await service.update(TENANT, USER, 'task-1', { status: 'IN_PROGRESS' })

      expect(prisma.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'IN_PROGRESS', completedAt: null }),
        }),
      )
    })

    it('rejects title: null with BadRequestException', async () => {
      const { service } = makeService(prisma)
      prisma.task.findFirst.mockResolvedValue(makeTask())

      await expect(service.update(TENANT, USER, 'task-1', { title: null })).rejects.toThrow(
        'title cannot be cleared',
      )
      expect(prisma.task.updateMany).not.toHaveBeenCalled()
    })

    it('clears description and dueDate when null is passed', async () => {
      const { service } = makeService(prisma)
      prisma.task.findFirst.mockResolvedValue(makeTask())
      prisma.task.updateMany.mockResolvedValue({ count: 1 })
      prisma.task.findFirst.mockResolvedValue(makeTask())

      await service.update(TENANT, USER, 'task-1', { description: null, dueDate: null })

      expect(prisma.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ description: null, dueDate: null }),
        }),
      )
    })

    it('routes a new contactId through ContactsService.findOne', async () => {
      const { service, contacts } = makeService(prisma)
      prisma.task.findFirst.mockResolvedValue(makeTask())
      contacts.findOne.mockResolvedValue({ id: 'contact-2' })
      prisma.task.updateMany.mockResolvedValue({ count: 1 })

      await service.update(TENANT, USER, 'task-1', { contactId: 'contact-2' })

      expect(contacts.findOne).toHaveBeenCalledWith(TENANT, USER, 'contact-2')
    })

    it('routes a new dealId through DealsService.findOne', async () => {
      const { service, deals } = makeService(prisma)
      prisma.task.findFirst.mockResolvedValue(makeTask())
      deals.findOne.mockResolvedValue({ id: 'deal-2' })
      prisma.task.updateMany.mockResolvedValue({ count: 1 })

      await service.update(TENANT, USER, 'task-1', { dealId: 'deal-2' })

      expect(deals.findOne).toHaveBeenCalledWith(TENANT, USER, 'deal-2')
      expect(prisma.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ dealId: 'deal-2' }),
        }),
      )
    })

    it('clears dealId without a visibility check when null is passed', async () => {
      const { service, deals } = makeService(prisma)
      prisma.task.findFirst.mockResolvedValue(makeTask())
      prisma.task.updateMany.mockResolvedValue({ count: 1 })

      await service.update(TENANT, USER, 'task-1', { dealId: null })

      expect(deals.findOne).not.toHaveBeenCalled()
      expect(prisma.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ dealId: null }),
        }),
      )
    })

    it('throws NotFoundException when the updateMany affects zero rows', async () => {
      const { service } = makeService(prisma)
      prisma.task.findFirst.mockResolvedValue(makeTask())
      prisma.task.updateMany.mockResolvedValue({ count: 0 })

      await expect(service.update(TENANT, USER, 'task-1', { title: 'New' })).rejects.toThrow(
        'Task not found',
      )
    })

    it('publishes TASK_ASSIGNED when the assignee changes', async () => {
      const { service, pubsub } = makeService(prisma)
      prisma.task.findFirst
        .mockResolvedValueOnce(makeTask({ assignedTo: USER }))
        .mockResolvedValueOnce(makeTask({ assignedTo: 'user-2' }))
      prisma.task.updateMany.mockResolvedValue({ count: 1 })

      await service.update(TENANT, USER, 'task-1', { assignedTo: 'user-2' })

      expect(pubsub.publish).toHaveBeenCalledWith(
        `${PUBSUB_TASK_ASSIGNED}:${TENANT}:user-2`,
        expect.anything(),
      )
    })

    it('does not publish TASK_ASSIGNED when the assignee is unchanged but publishes TASK_CHANGED (AC 14)', async () => {
      const { service, pubsub } = makeService(prisma)
      prisma.task.findFirst.mockResolvedValue(makeTask({ assignedTo: USER }))
      prisma.task.updateMany.mockResolvedValue({ count: 1 })

      await service.update(TENANT, USER, 'task-1', { title: 'Renamed' })

      expect(pubsub.publish).not.toHaveBeenCalledWith(
        `${PUBSUB_TASK_ASSIGNED}:${TENANT}:${USER}`,
        expect.anything(),
      )
      expect(pubsub.publish).toHaveBeenCalledWith(`TASK_CHANGED:${TENANT}`, expect.anything())
    })
  })

  describe('assign()', () => {
    it('assigns the task to an active user in the same tenant', async () => {
      const { service, pubsub, audit } = makeService(prisma)
      prisma.task.findFirst
        .mockResolvedValueOnce(makeTask({ assignedTo: USER }))
        .mockResolvedValueOnce(makeTask({ assignedTo: 'user-2' }))
      prisma.user.findFirst.mockResolvedValue({ id: 'user-2', isActive: true })
      prisma.task.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.assign(TENANT, USER, 'task-1', 'user-2')

      expect(prisma.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ assignedTo: 'user-2', updatedBy: USER }),
        }),
      )
      expect(result.assignedTo).toBe('user-2')
      expect(pubsub.publish).toHaveBeenCalledWith(
        `${PUBSUB_TASK_ASSIGNED}:${TENANT}:user-2`,
        expect.anything(),
      )
      expect(audit.log).toHaveBeenCalledWith({
        tenantId: TENANT,
        userId: USER,
        action: 'UPDATE',
        entity: 'TASK',
        entityId: 'task-1',
        details: { mutationName: 'UPDATE' },
      })
    })

    it('rejects an inactive assignee with BadRequestException', async () => {
      const { service } = makeService(prisma)
      prisma.task.findFirst.mockResolvedValue(makeTask())
      prisma.user.findFirst.mockResolvedValue(null)

      await expect(service.assign(TENANT, USER, 'task-1', 'inactive-user')).rejects.toThrow(
        'Assignee not found in this tenant',
      )
      expect(prisma.task.updateMany).not.toHaveBeenCalled()
    })

    it('rejects an assignee from another tenant with BadRequestException', async () => {
      const { service } = makeService(prisma)
      prisma.task.findFirst.mockResolvedValue(makeTask())
      prisma.user.findFirst.mockResolvedValue(null)

      await expect(service.assign(TENANT, USER, 'task-1', 'other-tenant-user')).rejects.toThrow(
        'Assignee not found in this tenant',
      )
    })

    it('does not publish TASK_ASSIGNED when reassigning to the current assignee but publishes TASK_CHANGED (AC 14)', async () => {
      const { service, pubsub } = makeService(prisma)
      prisma.task.findFirst.mockResolvedValue(makeTask({ assignedTo: 'user-2' }))
      prisma.user.findFirst.mockResolvedValue({ id: 'user-2', isActive: true })
      prisma.task.updateMany.mockResolvedValue({ count: 1 })

      await service.assign(TENANT, USER, 'task-1', 'user-2')

      expect(pubsub.publish).not.toHaveBeenCalledWith(
        `${PUBSUB_TASK_ASSIGNED}:${TENANT}:user-2`,
        expect.anything(),
      )
      expect(pubsub.publish).toHaveBeenCalledWith(`TASK_CHANGED:${TENANT}`, expect.anything())
    })

    it('throws NotFoundException when the task is gone', async () => {
      const { service } = makeService(prisma)
      prisma.task.findFirst.mockResolvedValue(makeTask())
      prisma.user.findFirst.mockResolvedValue({ id: 'user-2', isActive: true })
      prisma.task.updateMany.mockResolvedValue({ count: 0 })

      await expect(service.assign(TENANT, USER, 'task-1', 'user-2')).rejects.toThrow(
        'Task not found',
      )
    })
  })

  describe('complete()', () => {
    it('stamps status COMPLETED and completedAt', async () => {
      const { service, audit } = makeService(prisma)
      prisma.task.findFirst
        .mockResolvedValueOnce(makeTask())
        .mockResolvedValueOnce(
          makeTask({ status: 'COMPLETED', completedAt: new Date('2026-08-03T00:00:00.000Z') }),
        )
      prisma.task.updateMany.mockResolvedValue({ count: 1 })

      const now = new Date('2026-08-03T00:00:00.000Z')
      const result = await service.complete(TENANT, USER, 'task-1', now)

      expect(prisma.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETED', completedAt: now, updatedBy: USER }),
        }),
      )
      expect(result.status).toBe('COMPLETED')
      expect(audit.log).toHaveBeenCalledWith({
        tenantId: TENANT,
        userId: USER,
        action: 'UPDATE',
        entity: 'TASK',
        entityId: 'task-1',
        details: { mutationName: 'UPDATE' },
      })
    })

    it('is idempotent — an already-completed task is returned unchanged', async () => {
      const { service, audit } = makeService(prisma)
      const completed = makeTask({
        status: 'COMPLETED',
        completedAt: new Date('2026-08-01T00:00:00.000Z'),
      })
      prisma.task.findFirst.mockResolvedValue(completed)

      const result = await service.complete(TENANT, USER, 'task-1')

      expect(prisma.task.updateMany).not.toHaveBeenCalled()
      expect(audit.log).not.toHaveBeenCalled()
      expect(result.completedAt).toEqual(new Date('2026-08-01T00:00:00.000Z'))
    })

    it('throws NotFoundException when the update affects zero rows', async () => {
      const { service } = makeService(prisma)
      prisma.task.findFirst.mockResolvedValue(makeTask())
      prisma.task.updateMany.mockResolvedValue({ count: 0 })

      await expect(service.complete(TENANT, USER, 'task-1')).rejects.toThrow('Task not found')
    })

    // Story 4.6 (AC 21-22): blocking validation tests
    it('allows completion when there are no open dependencies', async () => {
      const { service } = makeService(prisma)
      prisma.task.findFirst
        .mockResolvedValueOnce(makeTask())
        .mockResolvedValueOnce(makeTask({ status: 'COMPLETED', completedAt: new Date() }))
      prisma.task.updateMany.mockResolvedValue({ count: 1 })
      prisma.taskDependency.findMany.mockResolvedValue([])

      await service.complete(TENANT, USER, 'task-1')

      expect(prisma.task.updateMany).toHaveBeenCalled()
    })

    it('blocks completion when there are open dependencies', async () => {
      const { service } = makeService(prisma)
      prisma.task.findFirst.mockResolvedValue(makeTask())
      prisma.taskDependency.findMany.mockResolvedValue([
        {
          dependsOnTask: {
            id: 'blocker-1',
            title: 'Send quote',
            assignedTo: USER,
          },
        },
      ])

      await expect(service.complete(TENANT, USER, 'task-1')).rejects.toThrow(
        'Cannot complete: blocked by "Send quote"',
      )
    })

    it('still allows completing an already-completed task even with blockers (idempotent)', async () => {
      const { service } = makeService(prisma)
      prisma.task.findFirst.mockResolvedValue(
        makeTask({ status: 'COMPLETED', completedAt: new Date() }),
      )
      // Should NOT even query dependencies for an already-completed task
      const result = await service.complete(TENANT, USER, 'task-1')

      expect(result.status).toBe('COMPLETED')
      expect(prisma.taskDependency.findMany).not.toHaveBeenCalled()
    })
  })

  describe('auto-logging TASK_COMPLETED (Story 4.2)', () => {
    it('complete() logs TASK_COMPLETED once with dedupeKey, title and metadata (AC 19)', async () => {
      const { service, activity } = makeService(prisma)
      prisma.task.findFirst
        .mockResolvedValueOnce(makeTask({ status: 'TODO', contactId: 'contact-1' }))
        .mockResolvedValueOnce(
          makeTask({
            status: 'COMPLETED',
            contactId: 'contact-1',
            completedAt: new Date('2026-08-03T00:00:00.000Z'),
          }),
        )
      prisma.task.updateMany.mockResolvedValue({ count: 1 })

      const now = new Date('2026-08-03T00:00:00.000Z')
      await service.complete(TENANT, USER, 'task-1', now)

      expect(activity.logSafe).toHaveBeenCalledTimes(1)
      expect(activity.logSafe).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT,
          contactId: 'contact-1',
          type: 'TASK_COMPLETED',
          title: 'Task completed: Follow up with Acme',
          source: 'TASK',
          sourceId: 'task-1',
          dedupeKey: 'TASK_COMPLETED:task-1',
          createdBy: USER,
          metadata: expect.objectContaining({
            taskId: 'task-1',
            priority: 'MEDIUM',
            assignedTo: USER,
          }),
        }),
      )
    })

    it('complete() on an already-COMPLETED task logs nothing (UT2)', async () => {
      const { service, activity } = makeService(prisma)
      prisma.task.findFirst.mockResolvedValue(
        makeTask({ status: 'COMPLETED', contactId: 'contact-1' }),
      )

      await service.complete(TENANT, USER, 'task-1')

      expect(activity.logSafe).not.toHaveBeenCalled()
    })

    it('update() flipping status to COMPLETED from non-COMPLETED logs exactly once (AC 20 / UT3)', async () => {
      const { service, activity } = makeService(prisma)
      prisma.task.findFirst
        .mockResolvedValueOnce(makeTask({ status: 'TODO', contactId: 'contact-1' }))
        .mockResolvedValueOnce(makeTask({ status: 'COMPLETED', contactId: 'contact-1' }))
      prisma.task.updateMany.mockResolvedValue({ count: 1 })

      await service.update(TENANT, USER, 'task-1', { status: 'COMPLETED' })

      expect(activity.logSafe).toHaveBeenCalledTimes(1)
      expect(activity.logSafe).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TASK_COMPLETED',
          dedupeKey: 'TASK_COMPLETED:task-1',
          contactId: 'contact-1',
        }),
      )
    })

    it('update() from already-COMPLETED logs nothing (UT4)', async () => {
      const { service, activity } = makeService(prisma)
      prisma.task.findFirst.mockResolvedValue(
        makeTask({ status: 'COMPLETED', contactId: 'contact-1' }),
      )
      prisma.task.updateMany.mockResolvedValue({ count: 1 })

      await service.update(TENANT, USER, 'task-1', { status: 'COMPLETED' })

      expect(activity.logSafe).not.toHaveBeenCalled()
    })

    it('update() for a non-COMPLETED field change logs nothing (UT5)', async () => {
      const { service, activity } = makeService(prisma)
      prisma.task.findFirst.mockResolvedValue(makeTask({ contactId: 'contact-1' }))
      prisma.task.updateMany.mockResolvedValue({ count: 1 })

      await service.update(TENANT, USER, 'task-1', { title: 'Renamed' })

      expect(activity.logSafe).not.toHaveBeenCalled()
    })

    it('an orphan task (contactId null and dealId null) completes but logs nothing (AC 21 / UT6)', async () => {
      const { service, activity } = makeService(prisma)
      prisma.task.findFirst
        .mockResolvedValueOnce(makeTask({ status: 'TODO', contactId: null, dealId: null }))
        .mockResolvedValueOnce(makeTask({ status: 'COMPLETED', contactId: null, dealId: null }))
      prisma.task.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.complete(TENANT, USER, 'task-1')

      expect(result.status).toBe('COMPLETED')
      expect(activity.logSafe).not.toHaveBeenCalled()
      expect(prisma.task.updateMany).toHaveBeenCalled()
    })

    it('logs on the task contact when contactId is set (UT7)', async () => {
      const { service, activity } = makeService(prisma)
      prisma.task.findFirst
        .mockResolvedValueOnce(makeTask({ status: 'TODO', contactId: 'contact-1', dealId: null }))
        .mockResolvedValueOnce(
          makeTask({ status: 'COMPLETED', contactId: 'contact-1', dealId: null }),
        )
      prisma.task.updateMany.mockResolvedValue({ count: 1 })

      await service.complete(TENANT, USER, 'task-1')

      expect(activity.logSafe).toHaveBeenCalledWith(
        expect.objectContaining({ contactId: 'contact-1' }),
      )
    })

    it('resolves the contact from the deal when task.contactId is null (AC 21 / UT8)', async () => {
      const { service, deals, activity } = makeService(prisma)
      deals.findOne.mockResolvedValue({ id: 'deal-1', contactId: 'contact-from-deal' })
      prisma.task.findFirst
        .mockResolvedValueOnce(makeTask({ status: 'TODO', contactId: null, dealId: 'deal-1' }))
        .mockResolvedValueOnce(makeTask({ status: 'COMPLETED', contactId: null, dealId: 'deal-1' }))
      prisma.task.updateMany.mockResolvedValue({ count: 1 })

      await service.complete(TENANT, USER, 'task-1')

      expect(deals.findOne).toHaveBeenCalledWith(TENANT, USER, 'deal-1')
      expect(activity.logSafe).toHaveBeenCalledWith(
        expect.objectContaining({ contactId: 'contact-from-deal' }),
      )
    })

    it('skips silently when the deal is gone — the mutation still succeeds (AC 21)', async () => {
      const { service, deals, activity } = makeService(prisma)
      deals.findOne.mockRejectedValue(new NotFoundException('Deal not found'))
      prisma.task.findFirst
        .mockResolvedValueOnce(makeTask({ status: 'TODO', contactId: null, dealId: 'deal-1' }))
        .mockResolvedValueOnce(makeTask({ status: 'COMPLETED', contactId: null, dealId: 'deal-1' }))
      prisma.task.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.complete(TENANT, USER, 'task-1')

      expect(result.status).toBe('COMPLETED')
      expect(activity.logSafe).not.toHaveBeenCalled()
    })

    it('preference logTaskCompleted=false suppresses the log but the mutation succeeds (AC 22 / UT9)', async () => {
      const { service, activity, activityLogPreference } = makeService(prisma)
      activityLogPreference.isEnabled.mockResolvedValue(false)
      prisma.task.findFirst
        .mockResolvedValueOnce(makeTask({ status: 'TODO', contactId: 'contact-1' }))
        .mockResolvedValueOnce(makeTask({ status: 'COMPLETED', contactId: 'contact-1' }))
      prisma.task.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.complete(TENANT, USER, 'task-1')

      expect(result.status).toBe('COMPLETED')
      expect(activity.logSafe).not.toHaveBeenCalled()
      expect(activityLogPreference.isEnabled).toHaveBeenCalledWith(TENANT, USER, 'logTaskCompleted')
    })

    it('preference logTaskCompleted=true allows the log (UT10)', async () => {
      const { service, activity } = makeService(prisma)
      prisma.task.findFirst
        .mockResolvedValueOnce(makeTask({ status: 'TODO', contactId: 'contact-1' }))
        .mockResolvedValueOnce(makeTask({ status: 'COMPLETED', contactId: 'contact-1' }))
      prisma.task.updateMany.mockResolvedValue({ count: 1 })

      await service.complete(TENANT, USER, 'task-1')

      expect(activity.logSafe).toHaveBeenCalledTimes(1)
    })
  })

  describe('delete()', () => {
    it('soft-deletes the task and returns true', async () => {
      const { service, audit } = makeService(prisma)
      prisma.task.findFirst.mockResolvedValue(makeTask())
      prisma.task.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.delete(TENANT, USER, 'task-1')

      expect(result).toBe(true)
      expect(prisma.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'task-1', tenantId: TENANT, deletedAt: null },
          data: expect.objectContaining({ deletedAt: expect.any(Date), updatedBy: USER }),
        }),
      )
      expect(audit.log).toHaveBeenCalledWith({
        tenantId: TENANT,
        userId: USER,
        action: 'DELETE',
        entity: 'TASK',
        entityId: 'task-1',
        details: { mutationName: 'DELETE' },
      })
    })

    it('throws NotFoundException when the row is already deleted', async () => {
      const { service } = makeService(prisma)
      prisma.task.findFirst.mockResolvedValue(makeTask())
      prisma.task.updateMany.mockResolvedValue({ count: 0 })

      await expect(service.delete(TENANT, USER, 'task-1')).rejects.toThrow('Task not found')
    })
  })

  describe('createFromTemplate()', () => {
    it('creates a task from template defaults and computes dueDate from defaultDueInDays', async () => {
      const { service, templates } = makeService(prisma)
      templates.findOneForTenant.mockResolvedValue({
        id: 'template-1',
        tenantId: TENANT,
        name: 'Discovery call',
        title: 'Discovery call follow-up',
        description: 'Call the lead',
        defaultPriority: 'HIGH',
        defaultDueInDays: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      const created = makeTask({ title: 'Discovery call follow-up', priority: 'HIGH' })
      prisma.task.create.mockResolvedValue(created)
      prisma.task.findFirst.mockResolvedValue(created)

      const now = new Date('2026-08-02T12:00:00.000Z')
      await service.createFromTemplate(TENANT, USER, 'template-1', {}, now)

      expect(templates.findOneForTenant).toHaveBeenCalledWith(TENANT, 'template-1')
      const createCall = prisma.task.create.mock.calls[0][0]
      expect(createCall.data.title).toBe('Discovery call follow-up')
      expect(createCall.data.description).toBe('Call the lead')
      expect(createCall.data.priority).toBe('HIGH')
      expect(createCall.data.dueDate.toISOString()).toBe('2026-08-05T00:00:00.000Z')
    })

    it('lets overrides win over template defaults', async () => {
      const { service, templates } = makeService(prisma)
      templates.findOneForTenant.mockResolvedValue({
        id: 'template-1',
        tenantId: TENANT,
        name: 'Discovery call',
        title: 'Discovery call follow-up',
        description: 'Call the lead',
        defaultPriority: 'HIGH',
        defaultDueInDays: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      const created = makeTask({ title: 'Custom', priority: 'HIGH', assignedTo: 'user-2' })
      prisma.user.findFirst.mockResolvedValue({ id: 'user-2', isActive: true })
      prisma.task.create.mockResolvedValue(created)
      prisma.task.findFirst.mockResolvedValue(created)

      await service.createFromTemplate(TENANT, USER, 'template-1', {
        title: 'Custom',
        assignedTo: 'user-2',
        dueDate: '2026-09-01T10:00:00.000Z',
      })

      const createCall = prisma.task.create.mock.calls[0][0]
      expect(createCall.data.title).toBe('Custom')
      expect(createCall.data.priority).toBe('HIGH')
      expect(createCall.data.assignedTo).toBe('user-2')
      expect(createCall.data.dueDate.toISOString()).toBe('2026-09-01T00:00:00.000Z')
    })

    it('throws NotFoundException for a missing template', async () => {
      const { service, templates } = makeService(prisma)
      templates.findOneForTenant.mockRejectedValue(new NotFoundException('Task template not found'))

      await expect(service.createFromTemplate(TENANT, USER, 'missing', {})).rejects.toThrow(
        'Task template not found',
      )
      expect(prisma.task.create).not.toHaveBeenCalled()
    })

    it('produces no dueDate when defaultDueInDays is null', async () => {
      const { service, templates } = makeService(prisma)
      templates.findOneForTenant.mockResolvedValue({
        id: 'template-1',
        tenantId: TENANT,
        name: 'No due',
        title: 'No due task',
        description: null,
        defaultPriority: 'MEDIUM',
        defaultDueInDays: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      const created = makeTask()
      prisma.task.create.mockResolvedValue(created)
      prisma.task.findFirst.mockResolvedValue(created)

      await service.createFromTemplate(TENANT, USER, 'template-1', {})

      expect(prisma.task.create.mock.calls[0][0].data.dueDate).toBeNull()
    })

    it('defaults overrides to an empty object when omitted', async () => {
      const { service, templates } = makeService(prisma)
      templates.findOneForTenant.mockResolvedValue({
        id: 'template-1',
        tenantId: TENANT,
        name: 'No due',
        title: 'No due task',
        description: null,
        defaultPriority: 'MEDIUM',
        defaultDueInDays: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      const created = makeTask({ title: 'No due task' })
      prisma.task.create.mockResolvedValue(created)
      prisma.task.findFirst.mockResolvedValue(created)

      await service.createFromTemplate(TENANT, USER, 'template-1')

      expect(prisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: 'No due task', priority: 'MEDIUM' }),
        }),
      )
    })
  })

  // ── Story 4.3: calendar sync hook sites (AC 22-23, 28, 35) ─────────────

  describe('calendar sync hooks (Story 4.3)', () => {
    const DUE = new Date('2026-08-05T00:00:00.000Z')

    describe('create()', () => {
      it('fires syncTaskSafe after the audit write when the task has a dueDate', async () => {
        const { service, audit, calendarSync } = makeService(prisma)
        const created = makeTask({ dueDate: DUE })
        prisma.task.create.mockResolvedValue(created)
        prisma.task.findFirst.mockResolvedValue(created)

        await service.create(TENANT, USER, { title: 'Task', dueDate: DUE.toISOString() })

        expect(calendarSync.syncTaskSafe).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'task-1', dueDate: DUE }),
        )
        // The hook fires AFTER the audit write (AC 23 ordering).
        expect(audit.log).toHaveBeenCalled()
        const auditIndex = audit.log.mock.invocationCallOrder[0] ?? 0
        const syncIndex = calendarSync.syncTaskSafe.mock.invocationCallOrder[0] ?? 0
        expect(auditIndex).toBeLessThan(syncIndex)
      })

      it('does not fire the sync hook for a task without a dueDate', async () => {
        const { service, calendarSync } = makeService(prisma)
        const created = makeTask({ dueDate: null })
        prisma.task.create.mockResolvedValue(created)
        prisma.task.findFirst.mockResolvedValue(created)

        await service.create(TENANT, USER, { title: 'Task' })

        expect(calendarSync.syncTaskSafe).not.toHaveBeenCalled()
      })

      it('a rejecting syncTaskSafe never fails the create mutation', async () => {
        const { service, calendarSync } = makeService(prisma)
        calendarSync.syncTaskSafe.mockRejectedValue(new Error('calendar down'))
        const created = makeTask({ dueDate: DUE })
        prisma.task.create.mockResolvedValue(created)
        prisma.task.findFirst.mockResolvedValue(created)

        await expect(
          service.create(TENANT, USER, { title: 'Task', dueDate: DUE.toISOString() }),
        ).resolves.toMatchObject({ id: 'task-1' })
      })
    })

    describe('update()', () => {
      it('pushes when the title changed', async () => {
        const { service, calendarSync } = makeService(prisma)
        const current = makeTask({ dueDate: DUE, title: 'Old title' })
        const updated = makeTask({ dueDate: DUE, title: 'New title' })
        prisma.task.findFirst.mockResolvedValueOnce(current).mockResolvedValueOnce(updated)
        prisma.task.updateMany.mockResolvedValue({ count: 1 })

        await service.update(TENANT, USER, 'task-1', { title: 'New title' })

        expect(calendarSync.syncTaskSafe).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'task-1', title: 'New title' }),
        )
        expect(calendarSync.removeTaskFromCalendarSafe).not.toHaveBeenCalled()
      })

      it('deletes the remote event when dueDate became null', async () => {
        const { service, calendarSync } = makeService(prisma)
        const current = makeTask({ dueDate: DUE })
        const updated = makeTask({ dueDate: null })
        prisma.task.findFirst.mockResolvedValueOnce(current).mockResolvedValueOnce(updated)
        prisma.task.updateMany.mockResolvedValue({ count: 1 })

        await service.update(TENANT, USER, 'task-1', { dueDate: null })

        expect(calendarSync.removeTaskFromCalendarSafe).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'task-1' }),
        )
        expect(calendarSync.syncTaskSafe).not.toHaveBeenCalled()
      })

      it('deletes the remote event when the status became COMPLETED', async () => {
        const { service, calendarSync } = makeService(prisma)
        const current = makeTask({ dueDate: DUE, status: 'TODO' })
        const updated = makeTask({ dueDate: DUE, status: 'COMPLETED' })
        prisma.task.findFirst.mockResolvedValueOnce(current).mockResolvedValueOnce(updated)
        prisma.task.updateMany.mockResolvedValue({ count: 1 })

        await service.update(TENANT, USER, 'task-1', { status: 'COMPLETED' })

        expect(calendarSync.removeTaskFromCalendarSafe).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'task-1' }),
        )
        expect(calendarSync.syncTaskSafe).not.toHaveBeenCalled()
      })

      it('does not fire any sync call for a priority-only update', async () => {
        const { service, calendarSync } = makeService(prisma)
        const current = makeTask({ dueDate: DUE, priority: 'MEDIUM' })
        const updated = makeTask({ dueDate: DUE, priority: 'URGENT' })
        prisma.task.findFirst.mockResolvedValueOnce(current).mockResolvedValueOnce(updated)
        prisma.task.updateMany.mockResolvedValue({ count: 1 })

        await service.update(TENANT, USER, 'task-1', { priority: 'URGENT' })

        expect(calendarSync.syncTaskSafe).not.toHaveBeenCalled()
        expect(calendarSync.removeTaskFromCalendarSafe).not.toHaveBeenCalled()
      })

      it('a rejecting syncTaskSafe never fails the update mutation', async () => {
        const { service, calendarSync } = makeService(prisma)
        calendarSync.syncTaskSafe.mockRejectedValue(new Error('calendar down'))
        const current = makeTask({ dueDate: DUE, title: 'Old' })
        const updated = makeTask({ dueDate: DUE, title: 'New' })
        prisma.task.findFirst.mockResolvedValueOnce(current).mockResolvedValueOnce(updated)
        prisma.task.updateMany.mockResolvedValue({ count: 1 })

        await expect(
          service.update(TENANT, USER, 'task-1', { title: 'New' }),
        ).resolves.toMatchObject({ id: 'task-1', title: 'New' })
      })
    })

    describe('assign()', () => {
      it('deletes from the previous assignee’s calendar and creates on the new assignee’s', async () => {
        const { service, calendarSync } = makeService(prisma)
        const current = makeTask({ dueDate: DUE, assignedTo: 'user-old' })
        const updated = makeTask({ dueDate: DUE, assignedTo: 'user-new' })
        prisma.task.findFirst.mockResolvedValueOnce(current).mockResolvedValueOnce(updated)
        prisma.task.updateMany.mockResolvedValue({ count: 1 })
        prisma.user.findFirst.mockResolvedValue({ id: 'user-new' })

        await service.assign(TENANT, USER, 'task-1', 'user-new')

        expect(calendarSync.removeTaskFromCalendarSafe).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'task-1', assignedTo: 'user-old' }),
        )
        expect(calendarSync.syncTaskSafe).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'task-1', assignedTo: 'user-new' }),
        )
      })

      it('does not fire sync calls when the assignee is unchanged', async () => {
        const { service, calendarSync } = makeService(prisma)
        const task = makeTask({ dueDate: DUE, assignedTo: 'user-old' })
        prisma.task.findFirst.mockResolvedValue(task)
        prisma.task.updateMany.mockResolvedValue({ count: 1 })
        prisma.user.findFirst.mockResolvedValue({ id: 'user-old' })

        await service.assign(TENANT, USER, 'task-1', 'user-old')

        expect(calendarSync.removeTaskFromCalendarSafe).not.toHaveBeenCalled()
        expect(calendarSync.syncTaskSafe).not.toHaveBeenCalled()
      })

      it('a rejecting syncTaskSafe never fails the reassignment', async () => {
        const { service, calendarSync } = makeService(prisma)
        calendarSync.syncTaskSafe.mockRejectedValue(new Error('calendar down'))
        const current = makeTask({ dueDate: DUE, assignedTo: 'user-old' })
        const updated = makeTask({ dueDate: DUE, assignedTo: 'user-new' })
        prisma.task.findFirst.mockResolvedValueOnce(current).mockResolvedValueOnce(updated)
        prisma.task.updateMany.mockResolvedValue({ count: 1 })
        prisma.user.findFirst.mockResolvedValue({ id: 'user-new' })

        await expect(service.assign(TENANT, USER, 'task-1', 'user-new')).resolves.toMatchObject({
          id: 'task-1',
        })
      })
    })

    describe('complete()', () => {
      it('deletes the remote event and the link row', async () => {
        const { service, calendarSync } = makeService(prisma)
        const task = makeTask({ dueDate: DUE, status: 'TODO' })
        prisma.task.findFirst.mockResolvedValue(task)
        prisma.task.updateMany.mockResolvedValue({ count: 1 })

        await service.complete(TENANT, USER, 'task-1', new Date('2026-08-02T10:00:00.000Z'))

        expect(calendarSync.removeTaskFromCalendarSafe).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'task-1' }),
        )
      })

      it('a rejecting removeTaskFromCalendarSafe never fails the completion', async () => {
        const { service, calendarSync } = makeService(prisma)
        calendarSync.removeTaskFromCalendarSafe.mockRejectedValue(new Error('calendar down'))
        prisma.task.findFirst.mockResolvedValue(makeTask({ dueDate: DUE, status: 'TODO' }))
        prisma.task.updateMany.mockResolvedValue({ count: 1 })

        await expect(
          service.complete(TENANT, USER, 'task-1', new Date('2026-08-02T10:00:00.000Z')),
        ).resolves.toMatchObject({ id: 'task-1' })
      })
    })

    describe('delete()', () => {
      it('deletes the remote event and the link row', async () => {
        const { service, calendarSync } = makeService(prisma)
        const task = makeTask({ dueDate: DUE })
        prisma.task.findFirst.mockResolvedValue(task)
        prisma.task.updateMany.mockResolvedValue({ count: 1 })

        await service.delete(TENANT, USER, 'task-1')

        expect(calendarSync.removeTaskFromCalendarSafe).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'task-1' }),
        )
      })

      it('a rejecting removeTaskFromCalendarSafe never fails the delete', async () => {
        const { service, calendarSync } = makeService(prisma)
        calendarSync.removeTaskFromCalendarSafe.mockRejectedValue(new Error('calendar down'))
        prisma.task.findFirst.mockResolvedValue(makeTask({ dueDate: DUE }))
        prisma.task.updateMany.mockResolvedValue({ count: 1 })

        await expect(service.delete(TENANT, USER, 'task-1')).resolves.toBe(true)
      })
    })

    describe('AC 35 — taskListSelect stays calendar-free', () => {
      it('never selects calendarEvents or any calendar sync field (no N+1 on task lists)', async () => {
        const { service } = makeService(prisma)
        const created = makeTask({ dueDate: DUE })
        prisma.task.create.mockResolvedValue(created)
        prisma.task.findFirst.mockResolvedValue(created)

        const result = await service.create(TENANT, USER, {
          title: 'Task',
          dueDate: DUE.toISOString(),
        })

        const select = prisma.task.create.mock.calls[0]?.[0]?.select as Record<string, unknown>
        expect(select).not.toHaveProperty('calendarEvents')
        expect(result).not.toHaveProperty('calendarEvents')
      })
    })
  })

  // ─── Story 4.4: task sorting (AC 12) ────────────────────────────────────

  describe('findMany() sort (Story 4.4, AC 12)', () => {
    async function findManyOrderBy(sort?: TaskSortInput): Promise<Record<string, unknown>[]> {
      const { service } = makeService(prisma)
      prisma.task.findMany.mockResolvedValue([])
      prisma.task.count.mockResolvedValue(0)
      await service.findMany(TENANT, USER, {}, { page: 1, pageSize: 20 }, sort)
      const call = prisma.task.findMany.mock.calls[0]![0] as { orderBy: Record<string, unknown>[] }
      return call.orderBy
    }

    it('maps DUE_DATE ASC to the documented orderBy (AC 12)', async () => {
      expect(await findManyOrderBy({ field: 'DUE_DATE', direction: 'ASC' })).toEqual([
        { dueDate: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'desc' },
      ])
    })

    it('maps DUE_DATE DESC with nulls last (AC 12)', async () => {
      expect(await findManyOrderBy({ field: 'DUE_DATE', direction: 'DESC' })).toEqual([
        { dueDate: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ])
    })

    it('maps PRIORITY to a priority orderBy', async () => {
      expect(await findManyOrderBy({ field: 'PRIORITY', direction: 'ASC' })).toEqual([
        { priority: 'asc' },
        { createdAt: 'desc' },
      ])
    })

    it('maps CREATED_AT to a createdAt orderBy', async () => {
      expect(await findManyOrderBy({ field: 'CREATED_AT', direction: 'DESC' })).toEqual([
        { createdAt: 'desc' },
      ])
    })

    it('maps TITLE to a title orderBy', async () => {
      expect(await findManyOrderBy({ field: 'TITLE', direction: 'ASC' })).toEqual([
        { title: 'asc' },
      ])
    })

    it('omitting sort preserves the current default ordering byte-for-byte (AC 12)', async () => {
      expect(await findManyOrderBy(undefined)).toEqual([
        { dueDate: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'desc' },
      ])
    })

    it('a garbage sort field is rejected and never reaches orderBy (AC 12)', async () => {
      const { service } = makeService(prisma)
      await expect(
        service.findMany(
          TENANT,
          USER,
          {},
          { page: 1, pageSize: 20 },
          { field: 'GARBAGE' as TaskSortInput['field'], direction: 'ASC' },
        ),
      ).rejects.toThrow(BadRequestException)
      expect(prisma.task.findMany).not.toHaveBeenCalled()
    })
  })

  // ─── Story 4.4: onTaskChanged publish (AC 14, 18, 19) ───────────────────

  describe('onTaskChanged publish (Story 4.4, AC 14/18/19)', () => {
    function changedCalls(pubsub: { publish: jest.Mock }): unknown[][] {
      return pubsub.publish.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].startsWith('TASK_CHANGED:'),
      )
    }

    it('publishes TASK_CHANGED on create (AC 14)', async () => {
      const { service, pubsub } = makeService(prisma)
      const created = makeTask({ id: 'task-c1' })
      prisma.task.create.mockResolvedValue(created)
      prisma.task.findFirst.mockResolvedValue(created)

      await service.create(TENANT, USER, { title: 'New task' })

      expect(changedCalls(pubsub)).toEqual([['TASK_CHANGED:tenant-1', created]])
    })

    it('publishes TASK_CHANGED on update (AC 14)', async () => {
      const { service, pubsub } = makeService(prisma)
      const updated = makeTask({ id: 'task-u1', title: 'Renamed' })
      prisma.task.findFirst.mockResolvedValue(updated)
      prisma.task.updateMany.mockResolvedValue({ count: 1 })

      await service.update(TENANT, USER, 'task-u1', { title: 'Renamed' })

      expect(changedCalls(pubsub)).toEqual([['TASK_CHANGED:tenant-1', updated]])
    })

    it('publishes TASK_CHANGED on assign (AC 14)', async () => {
      const { service, pubsub } = makeService(prisma)
      const current = makeTask({ id: 'task-a1', assignedTo: 'user-1' })
      const updated = makeTask({ id: 'task-a1', assignedTo: 'user-2' })
      prisma.task.findFirst.mockResolvedValueOnce(current).mockResolvedValueOnce(updated)
      prisma.task.updateMany.mockResolvedValue({ count: 1 })
      prisma.user.findFirst.mockResolvedValue({ id: 'user-2' })

      await service.assign(TENANT, USER, 'task-a1', 'user-2')

      expect(changedCalls(pubsub)).toEqual([['TASK_CHANGED:tenant-1', updated]])
    })

    it('publishes TASK_CHANGED on complete (AC 14)', async () => {
      const { service, pubsub } = makeService(prisma)
      const before = makeTask({ id: 'task-c1', status: 'TODO' })
      const completed = makeTask({ id: 'task-c1', status: 'COMPLETED', completedAt: new Date() })
      prisma.task.findFirst.mockResolvedValueOnce(before).mockResolvedValueOnce(completed)
      prisma.task.updateMany.mockResolvedValue({ count: 1 })

      await service.complete(TENANT, USER, 'task-c1')

      expect(changedCalls(pubsub)).toEqual([['TASK_CHANGED:tenant-1', completed]])
    })

    it('publishes TASK_CHANGED on delete with the pre-delete row (AC 14)', async () => {
      const { service, pubsub } = makeService(prisma)
      const current = makeTask({ id: 'task-d1' })
      prisma.task.findFirst.mockResolvedValue(current)
      prisma.task.updateMany.mockResolvedValue({ count: 1 })

      await service.delete(TENANT, USER, 'task-d1')

      expect(changedCalls(pubsub)).toEqual([['TASK_CHANGED:tenant-1', current]])
    })

    it('a publish failure never fails the mutation (AC 19)', async () => {
      const { service, pubsub } = makeService(prisma)
      pubsub.publish.mockImplementation(() => {
        throw new Error('emitter exploded')
      })
      const created = makeTask({ id: 'task-ok' })
      prisma.task.create.mockResolvedValue(created)
      prisma.task.findFirst.mockResolvedValue(created)

      await expect(service.create(TENANT, USER, { title: 'New task' })).resolves.toMatchObject({
        id: 'task-ok',
      })
    })

    it('onTaskAssigned stays on its own per-user channel and is untouched (AC 18)', async () => {
      const { service, pubsub } = makeService(prisma)
      const created = makeTask({ id: 'task-a2', assignedTo: 'user-2' })
      prisma.user.findFirst.mockResolvedValue({ id: 'user-2', isActive: true })
      prisma.task.create.mockResolvedValue(created)
      prisma.task.findFirst.mockResolvedValue(created)

      await service.create(TENANT, USER, { title: 'Assigned away', assignedTo: 'user-2' })

      expect(pubsub.publish).toHaveBeenCalledWith(
        `${PUBSUB_TASK_ASSIGNED}:tenant-1:user-2`,
        created,
      )
    })
  })
})
