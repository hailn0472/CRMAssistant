/**
 * Story 6.7 (Contract C21–C23): internal idempotent automation task path.
 * Exercises TasksService.createAutomatedTask — same validation/select/audit/
 * pub-sub/notification semantics as public create(), but with a deterministic
 * automationKey that makes the same trigger idempotent (P2002 → existing
 * same-tenant task) and is never exposed through public inputs.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

import { TasksService, type CreateAutomatedTaskInput } from '../tasks.service'
import { ContactsService } from '../../contacts/contacts.service'
import { DealsService } from '../../deals/deals.service'
import { TaskTemplatesService } from '../task-templates.service'
import { TaskPubSubService } from '../task-pubsub.service'
import { AuditService } from '../../audit/audit.service'
import { ActivityService } from '../../activities/activities.service'
import { ActivityLogPreferenceService } from '../../activities/activity-log-preference.service'
import { CalendarSyncService } from '../../calendar/calendar-sync.service'
import { NotificationsService } from '../../notifications/notifications.service'
import { PrismaService } from '../../prisma/prisma.service'

const TENANT = 'tenant-1'
const OWNER = 'user-owner'
const CONTACT = 'contact-1'

function makeTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'task-1',
    tenantId: TENANT,
    title: 'Follow up with Ada Lovelace — high churn risk',
    description: 'Churn risk HIGH (score 85.0) — last activity 120 days ago.',
    status: 'TODO',
    priority: 'HIGH',
    dueDate: new Date('2026-08-16T00:00:00.000Z'),
    assignedTo: OWNER,
    contactId: CONTACT,
    dealId: null,
    completedAt: null,
    createdAt: new Date('2026-08-15T02:00:00.000Z'),
    updatedAt: new Date('2026-08-15T02:00:00.000Z'),
    createdBy: 'system',
    updatedBy: 'system',
    isRecurring: false,
    recurrencePattern: null,
    recurrenceEndDate: null,
    parentTaskId: null,
    assignee: {
      id: OWNER,
      firstName: 'Test',
      lastName: 'Owner',
      email: 'owner@test.local',
      avatar: null,
    },
    contact: { id: CONTACT, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@test.local' },
    deal: null,
    ...overrides,
  }
}

type MockPrisma = {
  task: {
    create: jest.Mock
    findFirst: jest.Mock
    findMany: jest.Mock
    count: jest.Mock
    updateMany: jest.Mock
  }
  user: { findFirst: jest.Mock }
  contact: { findFirst: jest.Mock }
  $transaction: jest.Mock
}

function buildPrismaMock(): MockPrisma {
  return {
    task: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    user: { findFirst: jest.fn() },
    contact: { findFirst: jest.fn() },
    $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb({})),
  }
}

function makeService(prisma: MockPrisma): {
  service: TasksService
  pubsub: { publish: jest.Mock }
  audit: { log: jest.Mock }
  calendarSync: { syncTaskSafe: jest.Mock }
  notifications: { notifySafe: jest.Mock }
} {
  const contacts = { findOne: jest.fn() }
  const deals = { findOne: jest.fn() }
  const templates = { findOneForTenant: jest.fn() }
  const pubsub = { publish: jest.fn() }
  const audit = { log: jest.fn() }
  const activity = { logSafe: jest.fn().mockResolvedValue(null) }
  const activityLogPreference = { isEnabled: jest.fn().mockResolvedValue(true) }
  const calendarSync = { syncTaskSafe: jest.fn().mockResolvedValue(undefined) }
  const notifications = { notifySafe: jest.fn().mockResolvedValue(undefined) }

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
    notifications as unknown as NotificationsService,
  )
  return { service, pubsub, audit, calendarSync, notifications }
}

function automationInput(overrides: Record<string, unknown> = {}): CreateAutomatedTaskInput {
  return {
    title: 'Follow up with Ada Lovelace — high churn risk',
    description: 'Churn risk HIGH (score 85.0) — last activity 120 days ago.',
    priority: 'HIGH',
    assignedTo: OWNER,
    contactId: CONTACT,
    dueDate: new Date('2026-08-16T00:00:00.000Z'),
    automationSource: 'CHURN_RISK',
    automationKey: `CHURN_RISK:${CONTACT}:2026-08-15`,
    ...overrides,
  } as unknown as CreateAutomatedTaskInput
}

const p2002 = new PrismaClientKnownRequestError('Unique constraint failed', {
  code: 'P2002',
  clientVersion: 'x',
})

describe('TasksService.createAutomatedTask (Story 6.7)', () => {
  let prisma: MockPrisma

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = buildPrismaMock()
    prisma.user.findFirst.mockResolvedValue({ id: OWNER })
    prisma.contact.findFirst.mockResolvedValue({ id: CONTACT })
  })

  it('creates a task with the automation identity and exact fields (C21)', async () => {
    const { service, pubsub, audit, calendarSync, notifications } = makeService(prisma)
    const created = makeTask()
    prisma.task.create.mockResolvedValue(created)
    prisma.task.findFirst.mockResolvedValue(created)

    const result = await service.createAutomatedTask(TENANT, automationInput())

    expect(prisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT,
          title: 'Follow up with Ada Lovelace — high churn risk',
          status: 'TODO',
          priority: 'HIGH',
          assignedTo: OWNER,
          contactId: CONTACT,
          dealId: null,
          dueDate: new Date('2026-08-16T00:00:00.000Z'),
          automationSource: 'CHURN_RISK',
          automationKey: `CHURN_RISK:${CONTACT}:2026-08-15`,
          createdBy: 'system',
          updatedBy: 'system',
        }),
      }),
    )
    // TASK_ASSIGNED notification + pub/sub, audit, calendar push — the same
    // side effects as the public create path (C22).
    expect(pubsub.publish).toHaveBeenCalledWith(
      expect.stringContaining(`TASK_ASSIGNED:${TENANT}:${OWNER}`),
      expect.anything(),
    )
    expect(notifications.notifySafe).toHaveBeenCalledWith(
      TENANT,
      'system',
      expect.objectContaining({
        recipientUserId: OWNER,
        type: 'TASK_ASSIGNED',
        taskId: created.id,
      }),
    )
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        action: 'CREATE',
        entity: 'TASK',
        entityId: created.id,
      }),
    )
    expect(calendarSync.syncTaskSafe).toHaveBeenCalled()
    expect(result.id).toBe(created.id)
  })

  it('returns the existing same-tenant task on P2002 instead of duplicating (C22)', async () => {
    const { service, pubsub, notifications, audit } = makeService(prisma)
    const existing = makeTask({ id: 'task-existing' })
    prisma.task.create.mockRejectedValue(p2002)
    prisma.task.findFirst.mockResolvedValue(existing)

    const result = await service.createAutomatedTask(TENANT, automationInput())

    expect(result.id).toBe('task-existing')
    // No duplicate side effects — the create failed, so nothing was assigned
    // again.
    expect(pubsub.publish).not.toHaveBeenCalled()
    expect(notifications.notifySafe).not.toHaveBeenCalled()
    expect(audit.log).not.toHaveBeenCalled()
    // The idempotent lookup is tenant-scoped (never a cross-tenant task).
    expect(prisma.task.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT,
          automationKey: `CHURN_RISK:${CONTACT}:2026-08-15`,
        }),
      }),
    )
  })

  it('does not swallow a P2002 when no existing row is found (C22)', async () => {
    const { service } = makeService(prisma)
    prisma.task.create.mockRejectedValue(p2002)
    prisma.task.findFirst.mockResolvedValue(null)

    await expect(service.createAutomatedTask(TENANT, automationInput())).rejects.toThrow()
  })

  it('rejects an invalid priority through the shared normalizer (C22)', async () => {
    const { service } = makeService(prisma)
    await expect(
      service.createAutomatedTask(TENANT, automationInput({ priority: 'NOPE' as never })),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.task.create).not.toHaveBeenCalled()
  })

  it('verifies the assignee is an active same-tenant user (C21)', async () => {
    const { service } = makeService(prisma)
    prisma.user.findFirst.mockResolvedValue(null)

    await expect(service.createAutomatedTask(TENANT, automationInput())).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(prisma.task.create).not.toHaveBeenCalled()
  })

  it('verifies the contact is active in the same tenant (C21)', async () => {
    const { service } = makeService(prisma)
    prisma.contact.findFirst.mockResolvedValue(null)

    await expect(service.createAutomatedTask(TENANT, automationInput())).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(prisma.task.create).not.toHaveBeenCalled()
  })

  it('never assigns to a different user when the owner is inactive (C23)', async () => {
    const { service } = makeService(prisma)
    prisma.user.findFirst.mockResolvedValue(null)

    await expect(service.createAutomatedTask(TENANT, automationInput())).rejects.toBeInstanceOf(
      BadRequestException,
    )
    // No task row was created with any assignee
    expect(prisma.task.create).not.toHaveBeenCalled()
  })
})
