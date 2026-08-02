import { CalendarSyncService } from '../calendar-sync.service'
import type { CalendarTaskInput } from '../calendar-sync.service'
import { OutlookCalendarClient } from '../outlook-calendar.client'
import { CalendarHttp } from '../calendar-http'
import { isCalendarSyncOnStartupEnabled } from '../calendar-config'
import type { CalendarProviderRegistry } from '../calendar-providers.token'
import type { CalendarProviderPort } from '../calendar-provider.types'
import type { PrismaService } from '../../prisma/prisma.service'
import type { AuditService } from '../../audit/audit.service'
import type { ActivityService } from '../../activities/activities.service'
import type { ActivityLogPreferenceService } from '../../activities/activity-log-preference.service'

// AC 22-28: push eligibility + create-then-update, the durable retry ladder,
// the pull loop (410 resync, page cap, link matching, cancelled handling,
// remoteUpdatedAt guard), per-connection isolation, the lazy sweep throttle,
// conflict detection and the MEETING_SCHEDULED producer.

const TENANT = 'tenant-a'
const USER_A = 'user-a'

function fakeProvider(overrides: Partial<CalendarProviderPort> = {}): CalendarProviderPort {
  return {
    buildAuthorizeUrl: jest.fn(() => 'https://fake/authorize'),
    exchangeCode: jest.fn(),
    refreshAccessToken: jest.fn(),
    fetchAccountIdentity: jest.fn(),
    createEvent: jest.fn(async () => ({
      externalEventId: 'evt-1',
      remoteUpdatedAt: new Date('2026-08-05T10:00:00.000Z'),
    })),
    updateEvent: jest.fn(async () => ({ remoteUpdatedAt: new Date('2026-08-05T11:00:00.000Z') })),
    deleteEvent: jest.fn(async () => undefined),
    listBusy: jest.fn(async () => []),
    listChanges: jest.fn(async () => ({
      changes: [],
      nextSyncToken: 'tok-new',
      requiresFullResync: false,
    })),
    ...overrides,
  }
}

function makeTask(overrides: Partial<CalendarTaskInput> = {}): CalendarTaskInput {
  return {
    id: 'task-1',
    tenantId: TENANT,
    title: 'Follow up with Acme',
    description: 'Call them back',
    status: 'TODO',
    dueDate: new Date('2026-08-05T09:00:00.000Z'),
    assignedTo: USER_A,
    contactId: 'contact-1',
    dealId: null,
    ...overrides,
  }
}

type LinkRow = {
  id: string
  tenantId: string
  taskId: string
  calendarConnectionId: string
  externalEventId: string | null
  syncStatus: string
  lastError: string | null
  attemptCount: number
  nextAttemptAt: Date | null
  remoteUpdatedAt: Date | null
  localSyncedAt: Date | null
  conflictDetectedAt: Date | null
  conflictSummary: string | null
  createdAt: Date
  updatedAt: Date
  createdBy: string
  updatedBy: string
}

function makeLink(overrides: Partial<LinkRow> = {}): LinkRow {
  return {
    id: 'link-1',
    tenantId: TENANT,
    taskId: 'task-1',
    calendarConnectionId: 'conn-1',
    externalEventId: null,
    syncStatus: 'PENDING',
    lastError: null,
    attemptCount: 0,
    nextAttemptAt: null,
    remoteUpdatedAt: null,
    localSyncedAt: null,
    conflictDetectedAt: null,
    conflictSummary: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    createdBy: 'system',
    updatedBy: 'system',
    ...overrides,
  }
}

function makeConnection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'conn-1',
    tenantId: TENANT,
    userId: USER_A,
    provider: 'GOOGLE',
    externalAccountId: 'ext-1',
    externalAccountEmail: 'a@b.c',
    accessTokenEncrypted: 'enc(at)',
    refreshTokenEncrypted: 'enc(rt)',
    accessTokenExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
    scope: 'calendar',
    calendarId: 'primary',
    status: 'ACTIVE',
    syncToken: null,
    lastSyncedAt: null,
    lastSyncError: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    createdBy: 'system',
    updatedBy: 'system',
    deletedAt: null,
    ...overrides,
  }
}

type MockPrisma = {
  calendarConnection: {
    findMany: jest.Mock
    findUnique: jest.Mock
    findFirst: jest.Mock
    update: jest.Mock
  }
  taskCalendarEvent: {
    upsert: jest.Mock
    update: jest.Mock
    findUnique: jest.Mock
    findFirst: jest.Mock
    findMany: jest.Mock
    delete: jest.Mock
    deleteMany: jest.Mock
  }
  deal: { findFirst: jest.Mock }
  task: { findFirst: jest.Mock; updateMany: jest.Mock }
}

function buildPrismaMock(): MockPrisma {
  return {
    calendarConnection: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    taskCalendarEvent: {
      upsert: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    deal: { findFirst: jest.fn() },
    task: { findFirst: jest.fn(), updateMany: jest.fn() },
  }
}

function makeService(
  prisma: MockPrisma,
  overrides: {
    providers?: CalendarProviderRegistry
    oauth?: { getValidAccessToken: jest.Mock }
    activityLogPreference?: { isEnabled: jest.Mock }
  } = {},
): {
  service: CalendarSyncService
  audit: { log: jest.Mock }
  activity: { logSafe: jest.Mock }
  activityLogPreference: { isEnabled: jest.Mock }
  oauth: { getValidAccessToken: jest.Mock }
  providers: CalendarProviderRegistry
} {
  const audit = { log: jest.fn().mockResolvedValue(undefined) }
  const activity = { logSafe: jest.fn().mockResolvedValue(null) }
  const activityLogPreference = overrides.activityLogPreference ?? {
    isEnabled: jest.fn().mockResolvedValue(true),
  }
  const oauth = overrides.oauth ?? { getValidAccessToken: jest.fn(async () => 'access-token') }
  const providers = overrides.providers ?? { GOOGLE: fakeProvider(), OUTLOOK: fakeProvider() }
  const service = new CalendarSyncService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    activity as unknown as ActivityService,
    activityLogPreference as unknown as ActivityLogPreferenceService,
    oauth as unknown as never,
    providers,
  )
  return { service, audit, activity, activityLogPreference, oauth, providers }
}

describe('CalendarSyncService', () => {
  describe('AC 22 — push eligibility and payload', () => {
    it('does nothing when the task has no dueDate', async () => {
      const prisma = buildPrismaMock()
      const { service } = makeService(prisma)

      await service.syncTaskSafe(makeTask({ dueDate: null }))

      expect(prisma.calendarConnection.findMany).not.toHaveBeenCalled()
      expect(prisma.taskCalendarEvent.upsert).not.toHaveBeenCalled()
    })

    it('does nothing when the task is COMPLETED or CANCELLED', async () => {
      const prisma = buildPrismaMock()
      const { service } = makeService(prisma)

      await service.syncTaskSafe(makeTask({ status: 'COMPLETED' }))
      await service.syncTaskSafe(makeTask({ status: 'CANCELLED' }))

      expect(prisma.taskCalendarEvent.upsert).not.toHaveBeenCalled()
    })

    it('does nothing when the assignee has no ACTIVE connection', async () => {
      const prisma = buildPrismaMock()
      prisma.calendarConnection.findMany.mockResolvedValue([])
      const { service, providers } = makeService(prisma)

      await service.syncTaskSafe(makeTask())

      expect(prisma.taskCalendarEvent.upsert).not.toHaveBeenCalled()
      expect(providers['GOOGLE'].createEvent).not.toHaveBeenCalled()
    })

    it('pushes to the assignee’s calendar (not the actor’s) with the 30-min UTC window and no location', async () => {
      const prisma = buildPrismaMock()
      prisma.calendarConnection.findMany.mockResolvedValue([makeConnection()])
      prisma.taskCalendarEvent.upsert.mockResolvedValue(makeLink())
      const { service, providers } = makeService(prisma)

      await service.syncTaskSafe(makeTask())

      expect(prisma.calendarConnection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT, userId: USER_A, status: 'ACTIVE', deletedAt: null },
        }),
      )
      const event = (providers['GOOGLE'].createEvent as jest.Mock).mock.calls[0]?.[1]
      expect(event.summary).toBe('Follow up with Acme')
      expect(event.description).toBe('Call them back')
      expect(event.start.toISOString()).toBe('2026-08-05T09:00:00.000Z')
      expect(event.end.toISOString()).toBe('2026-08-05T09:30:00.000Z') // 30-min duration
      expect('location' in event).toBe(false)
    })
  })

  describe('AC 23 — push create-then-update and the retry ladder', () => {
    it('creates on first push, updates on subsequent pushes (no double-create)', async () => {
      const prisma = buildPrismaMock()
      prisma.calendarConnection.findMany.mockResolvedValue([makeConnection()])
      const link = makeLink()
      prisma.taskCalendarEvent.upsert.mockImplementation(async () => link)
      const { service, providers, activity } = makeService(prisma)

      await service.syncTaskSafe(makeTask())
      // Simulate the persisted state after the first push.
      link.externalEventId = 'evt-1'
      await service.syncTaskSafe(makeTask())

      expect(providers['GOOGLE'].createEvent).toHaveBeenCalledTimes(1)
      expect(providers['GOOGLE'].updateEvent).toHaveBeenCalledTimes(1)
      expect(providers['GOOGLE'].updateEvent).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: 'access-token', calendarId: 'primary' }),
        'evt-1',
        expect.anything(),
      )
      // The link row is marked SYNCED with the externalEventId.
      const updates = prisma.taskCalendarEvent.update.mock.calls.map((c) => c[0]?.data)
      expect(updates[0]?.syncStatus).toBe('SYNCED')
      expect(updates[0]?.externalEventId).toBe('evt-1')
      expect(updates[0]?.attemptCount).toBe(0)
      // MEETING_SCHEDULED fires once — only on the FIRST successful push.
      expect(activity.logSafe).toHaveBeenCalledTimes(1)
    })

    it('a failed push records FAILED + lastError + attemptCount+1 + later nextAttemptAt', async () => {
      const prisma = buildPrismaMock()
      prisma.calendarConnection.findMany.mockResolvedValue([makeConnection()])
      const link = makeLink()
      prisma.taskCalendarEvent.upsert.mockResolvedValue(link)
      prisma.taskCalendarEvent.findUnique.mockResolvedValue(link)
      const { service, providers } = makeService(prisma)
      ;(providers['GOOGLE'].createEvent as jest.Mock).mockRejectedValue(
        new Error('provider exploded'),
      )

      const now = new Date('2026-08-05T08:00:00.000Z')
      // syncTaskSafe never throws — the mutation must survive (AC 23).
      await expect(service.syncTaskSafe(makeTask(), now)).resolves.toBeUndefined()

      const failure = prisma.taskCalendarEvent.update.mock.calls[0]?.[0]?.data
      expect(failure.syncStatus).toBe('FAILED')
      expect(failure.lastError).toBe('provider exploded')
      expect(failure.attemptCount).toBe(1)
      // nextAttemptAt = now + min(2^0, 60) minutes = +1 minute.
      expect(failure.nextAttemptAt.getTime()).toBe(now.getTime() + 60 * 1000)
    })

    it('backoff doubles with attemptCount: attempt 1 → +2 minutes', async () => {
      const prisma = buildPrismaMock()
      prisma.calendarConnection.findMany.mockResolvedValue([makeConnection()])
      const link = makeLink({ attemptCount: 1 })
      prisma.taskCalendarEvent.upsert.mockResolvedValue(link)
      prisma.taskCalendarEvent.findUnique.mockResolvedValue(link)
      const { service, providers } = makeService(prisma)
      ;(providers['GOOGLE'].createEvent as jest.Mock).mockRejectedValue(new Error('boom'))

      const now = new Date('2026-08-05T08:00:00.000Z')
      await service.syncTaskSafe(makeTask(), now)

      const failure = prisma.taskCalendarEvent.update.mock.calls[0]?.[0]?.data
      expect(failure.attemptCount).toBe(2)
      expect(failure.nextAttemptAt.getTime()).toBe(now.getTime() + 2 * 60 * 1000)
    })

    it('removeTaskFromCalendarSafe deletes remote events and hard-deletes link rows (never throws)', async () => {
      const prisma = buildPrismaMock()
      prisma.taskCalendarEvent.findMany.mockResolvedValue([
        { id: 'link-1', externalEventId: 'evt-1', calendarConnectionId: 'conn-1' },
      ])
      prisma.calendarConnection.findMany.mockResolvedValue([makeConnection()])
      prisma.taskCalendarEvent.deleteMany.mockResolvedValue({ count: 1 })
      const { service, providers } = makeService(prisma)

      await expect(service.removeTaskFromCalendarSafe(makeTask())).resolves.toBeUndefined()

      expect(providers['GOOGLE'].deleteEvent).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: 'access-token', calendarId: 'primary' }),
        'evt-1',
      )
      expect(prisma.taskCalendarEvent.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT, taskId: 'task-1' },
      })
    })

    it('a rejecting remote delete still clears the link rows', async () => {
      const prisma = buildPrismaMock()
      prisma.taskCalendarEvent.findMany.mockResolvedValue([
        { id: 'link-1', externalEventId: 'evt-1', calendarConnectionId: 'conn-1' },
      ])
      prisma.calendarConnection.findMany.mockResolvedValue([makeConnection()])
      const { service, providers } = makeService(prisma)
      ;(providers['GOOGLE'].deleteEvent as jest.Mock).mockRejectedValue(new Error('gone'))

      await expect(service.removeTaskFromCalendarSafe(makeTask())).resolves.toBeUndefined()
      expect(prisma.taskCalendarEvent.deleteMany).toHaveBeenCalled()
    })
  })

  describe('AC 27 — conflict detection', () => {
    it('records conflictDetectedAt + conflictSummary and the sync still proceeds', async () => {
      const prisma = buildPrismaMock()
      prisma.calendarConnection.findMany.mockResolvedValue([makeConnection()])
      prisma.taskCalendarEvent.upsert.mockResolvedValue(makeLink())
      const { service, providers } = makeService(prisma)
      ;(providers['GOOGLE'].listBusy as jest.Mock).mockResolvedValue([
        {
          start: new Date('2026-08-05T09:10:00.000Z'),
          end: new Date('2026-08-05T09:40:00.000Z'),
          title: 'Standup',
        },
      ])

      await service.syncTaskSafe(makeTask())

      const data = prisma.taskCalendarEvent.update.mock.calls[0]?.[0]?.data
      expect(data.conflictDetectedAt).toBeInstanceOf(Date)
      expect(data.conflictSummary).toMatch(/Overlaps "Standup"/)
      // The event was still created — a conflict is information, not a block.
      expect(providers['GOOGLE'].createEvent).toHaveBeenCalledTimes(1)
    })

    it('clears the conflict when the window is free again', async () => {
      const prisma = buildPrismaMock()
      prisma.calendarConnection.findMany.mockResolvedValue([makeConnection()])
      prisma.taskCalendarEvent.upsert.mockResolvedValue(makeLink({ externalEventId: 'evt-1' }))
      const { service } = makeService(prisma)

      await service.syncTaskSafe(makeTask())

      const data = prisma.taskCalendarEvent.update.mock.calls[0]?.[0]?.data
      expect(data.conflictDetectedAt).toBeNull()
      expect(data.conflictSummary).toBeNull()
    })
  })

  describe('AC 28 — MEETING_SCHEDULED producer', () => {
    function setup(): {
      prisma: MockPrisma
      service: CalendarSyncService
      activity: { logSafe: jest.Mock }
      activityLogPreference: { isEnabled: jest.Mock }
      providers: CalendarProviderRegistry
    } {
      const prisma = buildPrismaMock()
      prisma.calendarConnection.findMany.mockResolvedValue([makeConnection()])
      prisma.taskCalendarEvent.upsert.mockResolvedValue(makeLink())
      const { service, activity, activityLogPreference, providers } = makeService(prisma)
      return { prisma, service, activity, activityLogPreference, providers }
    }

    it('logs one MEETING_SCHEDULED activity on the first successful push with the right dedupeKey', async () => {
      const { service, activity, prisma } = setup()

      await service.syncTaskSafe(makeTask())

      expect(activity.logSafe).toHaveBeenCalledTimes(1)
      const call = activity.logSafe.mock.calls[0]?.[0]
      expect(call.type).toBe('MEETING_SCHEDULED')
      expect(call.source).toBe('CALENDAR')
      expect(call.sourceId).toBe('task-1')
      expect(call.dedupeKey).toBe('MEETING:task-1:conn-1')
      expect(call.title).toBe('Meeting scheduled: Follow up with Acme')
      expect(call.contactId).toBe('contact-1')
      expect(call.metadata).toEqual({
        taskId: 'task-1',
        provider: 'GOOGLE',
        externalEventId: 'evt-1',
        dueDate: '2026-08-05T09:00:00.000Z',
      })
      void prisma
    })

    it('resolves the contact through the deal when the task has no direct contact', async () => {
      const { service, activity, prisma } = setup()
      const task = makeTask({ contactId: null, dealId: 'deal-1' })
      prisma.deal.findFirst.mockResolvedValue({ contactId: 'deal-contact-1' })

      await service.syncTaskSafe(task)

      expect(activity.logSafe).toHaveBeenCalledWith(
        expect.objectContaining({ contactId: 'deal-contact-1' }),
      )
    })

    it('is suppressed when the logMeetingScheduled preference is off (sync still succeeds)', async () => {
      const { service, activity, activityLogPreference } = setup()
      activityLogPreference.isEnabled.mockResolvedValue(false)

      await service.syncTaskSafe(makeTask())

      expect(activity.logSafe).not.toHaveBeenCalled()
    })

    it('skips silently when no contact resolves (orphan) — sync still succeeds', async () => {
      const { service, activity } = setup()

      await service.syncTaskSafe(makeTask({ contactId: null, dealId: null }))

      expect(activity.logSafe).not.toHaveBeenCalled()
    })

    it('never fails the sync when the activity log throws', async () => {
      const { service, activity } = setup()
      activity.logSafe.mockRejectedValue(new Error('activity db down'))

      await expect(service.syncTaskSafe(makeTask())).resolves.toBeUndefined()
    })
  })

  describe('AC 25 — pull', () => {
    it('Google 410 (requiresFullResync) clears syncToken and re-runs a full pass', async () => {
      const prisma = buildPrismaMock()
      prisma.calendarConnection.findUnique.mockResolvedValue(
        makeConnection({ syncToken: 'stale-token' }),
      )
      const { service, providers } = makeService(prisma)
      const listChanges = providers['GOOGLE'].listChanges as jest.Mock
      listChanges
        .mockResolvedValueOnce({ changes: [], nextSyncToken: null, requiresFullResync: true })
        .mockResolvedValueOnce({
          changes: [],
          nextSyncToken: 'brand-new-token',
          requiresFullResync: false,
        })

      await service.syncConnection('conn-1')

      // Token cleared first, then the final nextSyncToken persisted.
      const updates = prisma.calendarConnection.update.mock.calls.map((c) => c[0]?.data)
      expect(updates[0]?.syncToken).toBeNull()
      expect(updates[1]?.syncToken).toBe('brand-new-token')
      expect(listChanges).toHaveBeenCalledTimes(2)
      expect(listChanges.mock.calls[0]?.[1]).toBe('stale-token')
      expect(listChanges.mock.calls[1]?.[1]).toBeNull()
    })

    it('an inbound event with no matching link row is ignored (never creates CRM tasks)', async () => {
      const prisma = buildPrismaMock()
      prisma.calendarConnection.findUnique.mockResolvedValue(makeConnection())
      prisma.taskCalendarEvent.findFirst.mockResolvedValue(null)
      const { service, audit } = makeService(prisma)

      await service.syncConnection('conn-1')

      expect(prisma.task.updateMany).not.toHaveBeenCalled()
      expect(audit.log).not.toHaveBeenCalled()
    })

    it('a cancelled inbound event hard-deletes the link row and leaves the task alone', async () => {
      const prisma = buildPrismaMock()
      prisma.calendarConnection.findUnique.mockResolvedValue(makeConnection())
      prisma.taskCalendarEvent.findFirst.mockResolvedValue(
        makeLink({ id: 'link-1', externalEventId: 'evt-1' }),
      )
      const { service, audit } = makeService(prisma, {
        providers: {
          GOOGLE: fakeProvider({
            listChanges: jest.fn().mockResolvedValue({
              changes: [
                {
                  externalEventId: 'evt-1',
                  title: null,
                  description: null,
                  start: null,
                  end: null,
                  remoteUpdatedAt: new Date('2026-08-02T00:00:00.000Z'),
                  cancelled: true,
                },
              ],
              nextSyncToken: 'tok',
              requiresFullResync: false,
            }),
          }),
          OUTLOOK: fakeProvider(),
        },
      })

      await service.syncConnection('conn-1')

      expect(prisma.taskCalendarEvent.delete).toHaveBeenCalledWith({ where: { id: 'link-1' } })
      expect(prisma.task.updateMany).not.toHaveBeenCalled()
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DELETE',
          entity: 'TASK',
          entityId: 'task-1',
          userId: USER_A,
        }),
      )
    })

    it('skips an inbound change whose remoteUpdatedAt is not newer than the stored value (loop guard)', async () => {
      const prisma = buildPrismaMock()
      prisma.calendarConnection.findUnique.mockResolvedValue(makeConnection())
      prisma.taskCalendarEvent.findFirst.mockResolvedValue(
        makeLink({
          id: 'link-1',
          externalEventId: 'evt-1',
          remoteUpdatedAt: new Date('2026-08-05T00:00:00.000Z'),
        }),
      )
      const { service, audit } = makeService(prisma, {
        providers: {
          GOOGLE: fakeProvider({
            listChanges: jest.fn().mockResolvedValue({
              changes: [
                {
                  externalEventId: 'evt-1',
                  title: 'Newer?',
                  description: null,
                  start: new Date('2026-08-06T09:00:00.000Z'),
                  end: null,
                  remoteUpdatedAt: new Date('2026-08-04T00:00:00.000Z'),
                  cancelled: false,
                },
              ],
              nextSyncToken: 'tok',
              requiresFullResync: false,
            }),
          }),
          OUTLOOK: fakeProvider(),
        },
      })

      await service.syncConnection('conn-1')

      expect(prisma.task.updateMany).not.toHaveBeenCalled()
      expect(audit.log).not.toHaveBeenCalled()
    })

    it('applies a moved start to Task.dueDate with an audit row owned by the connection owner — and does NOT push back out', async () => {
      const prisma = buildPrismaMock()
      prisma.calendarConnection.findUnique.mockResolvedValue(makeConnection())
      prisma.taskCalendarEvent.findFirst.mockResolvedValue(
        makeLink({
          id: 'link-1',
          externalEventId: 'evt-1',
          remoteUpdatedAt: new Date('2026-08-01T00:00:00.000Z'),
        }),
      )
      prisma.task.findFirst.mockResolvedValue({
        id: 'task-1',
        title: 'Follow up with Acme',
        dueDate: new Date('2026-08-05T09:00:00.000Z'),
      })
      const { service, audit, providers } = makeService(prisma, {
        providers: {
          GOOGLE: fakeProvider({
            listChanges: jest.fn().mockResolvedValue({
              changes: [
                {
                  externalEventId: 'evt-1',
                  title: 'Follow up with Acme',
                  description: null,
                  start: new Date('2026-08-06T14:00:00.000Z'),
                  end: null,
                  remoteUpdatedAt: new Date('2026-08-02T00:00:00.000Z'),
                  cancelled: false,
                },
              ],
              nextSyncToken: 'tok',
              requiresFullResync: false,
            }),
          }),
          OUTLOOK: fakeProvider(),
        },
      })

      await service.syncConnection('conn-1')

      expect(prisma.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'task-1', tenantId: TENANT, deletedAt: null },
          data: expect.objectContaining({
            dueDate: new Date('2026-08-06T14:00:00.000Z'),
            updatedBy: USER_A,
          }),
        }),
      )
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_A,
          action: 'UPDATE',
          entity: 'TASK',
          entityId: 'task-1',
        }),
      )
      // The pull path must never push back out (AC 24) — no provider writes.
      expect(providers['GOOGLE'].createEvent).not.toHaveBeenCalled()
      expect(providers['GOOGLE'].updateEvent).not.toHaveBeenCalled()
      expect(providers['GOOGLE'].deleteEvent).not.toHaveBeenCalled()
    })

    it('audit rows for pull-applied changes never contain tokens or credentials', async () => {
      const prisma = buildPrismaMock()
      prisma.calendarConnection.findUnique.mockResolvedValue(makeConnection())
      prisma.taskCalendarEvent.findFirst.mockResolvedValue(
        makeLink({
          id: 'link-1',
          externalEventId: 'evt-1',
          remoteUpdatedAt: new Date('2026-08-01T00:00:00.000Z'),
        }),
      )
      prisma.task.findFirst.mockResolvedValue({ id: 'task-1', title: 'Old title', dueDate: null })
      const { service, audit } = makeService(prisma, {
        providers: {
          GOOGLE: fakeProvider({
            listChanges: jest.fn().mockResolvedValue({
              changes: [
                {
                  externalEventId: 'evt-1',
                  title: 'New title',
                  description: null,
                  start: null,
                  end: null,
                  remoteUpdatedAt: new Date('2026-08-02T00:00:00.000Z'),
                  cancelled: false,
                },
              ],
              nextSyncToken: 'tok',
              requiresFullResync: false,
            }),
          }),
          OUTLOOK: fakeProvider(),
        },
      })

      await service.syncConnection('conn-1')

      expect(audit.log).toHaveBeenCalled()
      for (const call of audit.log.mock.calls) {
        expect(JSON.stringify(call[0])).not.toContain('enc(')
      }
    })
  })

  describe('AC 26 — sweeps', () => {
    it('syncAllConnections continues after one connection throws (per-connection isolation)', async () => {
      const prisma = buildPrismaMock()
      prisma.calendarConnection.findMany.mockResolvedValue([
        makeConnection({ id: 'conn-bad' }),
        makeConnection({ id: 'conn-good' }),
      ])
      prisma.calendarConnection.findUnique.mockResolvedValue(makeConnection())
      const { service, oauth } = makeService(prisma)
      oauth.getValidAccessToken
        .mockRejectedValueOnce(new Error('bad connection'))
        .mockResolvedValueOnce('access-token')

      await expect(service.syncAllConnections()).resolves.toBeUndefined()

      expect(oauth.getValidAccessToken).toHaveBeenCalledTimes(2)
    })

    it('syncMine skips connections synced within the last 15 minutes (throttle)', async () => {
      const prisma = buildPrismaMock()
      const now = new Date('2026-08-05T12:00:00.000Z')
      prisma.calendarConnection.findMany.mockResolvedValue([
        makeConnection({ id: 'conn-fresh', lastSyncedAt: new Date(now.getTime() - 5 * 60 * 1000) }),
        makeConnection({
          id: 'conn-stale',
          lastSyncedAt: new Date(now.getTime() - 20 * 60 * 1000),
        }),
      ])
      prisma.calendarConnection.findUnique.mockResolvedValue(makeConnection({ id: 'conn-stale' }))
      const { service, oauth } = makeService(prisma)

      await service.syncMine(TENANT, USER_A, now)

      expect(oauth.getValidAccessToken).toHaveBeenCalledTimes(1)
    })

    it('syncProvider syncs only the caller’s connection for the named provider', async () => {
      const prisma = buildPrismaMock()
      prisma.calendarConnection.findFirst.mockResolvedValue(makeConnection())
      prisma.calendarConnection.findUnique.mockResolvedValue(makeConnection())
      const { service, oauth } = makeService(prisma)

      await service.syncProvider(TENANT, USER_A, 'GOOGLE')

      expect(prisma.calendarConnection.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: TENANT,
            userId: USER_A,
            provider: 'GOOGLE',
            status: 'ACTIVE',
            deletedAt: null,
          },
        }),
      )
      expect(oauth.getValidAccessToken).toHaveBeenCalled()
    })

    it('CALENDAR_SYNC_ON_STARTUP=false disables the bootstrap sweep', () => {
      process.env['CALENDAR_SYNC_ON_STARTUP'] = 'false'
      expect(isCalendarSyncOnStartupEnabled()).toBe(false)
      process.env['CALENDAR_SYNC_ON_STARTUP'] = 'true'
      expect(isCalendarSyncOnStartupEnabled()).toBe(true)
      delete process.env['CALENDAR_SYNC_ON_STARTUP']
      expect(isCalendarSyncOnStartupEnabled()).toBe(true)
    })
  })

  describe('AC 25 — Outlook delta page cap', () => {
    it('terminates at MAX_SYNC_PAGES instead of spinning forever', async () => {
      const http = new CalendarHttp()
      const requestMock = jest.fn().mockResolvedValue({
        value: [],
        '@odata.nextLink': 'https://graph.example/next?$skipToken=1',
      })
      ;(http as unknown as { request: jest.Mock }).request = requestMock
      const client = new OutlookCalendarClient(http)
      const now = new Date('2026-08-05T00:00:00.000Z')

      const result = await client.listChanges(
        { accessToken: 'tok', calendarId: 'primary', now },
        null,
      )

      // The loop bounded at the hard cap; no infinite rotation.
      expect(requestMock.mock.calls.length).toBeLessThanOrEqual(1002)
      expect(result.nextSyncToken).toBeNull()
      expect(result.requiresFullResync).toBe(false)
    })

    it('stores the final @odata.deltaLink as the next sync token', async () => {
      const http = new CalendarHttp()
      const requestMock = jest
        .fn()
        .mockResolvedValueOnce({ value: [], '@odata.nextLink': 'https://graph.example/next' })
        .mockResolvedValueOnce({
          value: [],
          '@odata.deltaLink': 'https://graph.example/delta?token=abc',
        })
      ;(http as unknown as { request: jest.Mock }).request = requestMock
      const client = new OutlookCalendarClient(http)
      const now = new Date('2026-08-05T00:00:00.000Z')

      const result = await client.listChanges(
        { accessToken: 'tok', calendarId: 'primary', now },
        null,
      )

      expect(result.nextSyncToken).toBe('https://graph.example/delta?token=abc')
      expect(requestMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('reads', () => {
    it('taskCalendarSync returns null when no link row exists', async () => {
      const prisma = buildPrismaMock()
      prisma.taskCalendarEvent.findFirst.mockResolvedValue(null)
      const { service } = makeService(prisma)

      await expect(service.taskCalendarSync(TENANT, 'task-1')).resolves.toBeNull()
    })

    it('taskCalendarSync maps the newest link row into the TaskCalendarSync shape', async () => {
      const prisma = buildPrismaMock()
      prisma.taskCalendarEvent.findFirst.mockResolvedValue({
        ...makeLink({
          externalEventId: 'evt-1',
          syncStatus: 'SYNCED',
          localSyncedAt: new Date('2026-08-05T10:00:00.000Z'),
        }),
        calendarConnection: { provider: 'GOOGLE' },
      })
      const { service } = makeService(prisma)

      const result = await service.taskCalendarSync(TENANT, 'task-1')

      expect(result).toMatchObject({
        taskId: 'task-1',
        syncStatus: 'SYNCED',
        externalEventId: 'evt-1',
        provider: 'GOOGLE',
        lastSyncedAt: '2026-08-05T10:00:00.000Z',
      })
    })

    it('syncTaskToCalendar returns the link state after a best-effort push', async () => {
      const prisma = buildPrismaMock()
      prisma.calendarConnection.findMany.mockResolvedValue([makeConnection()])
      prisma.taskCalendarEvent.upsert.mockResolvedValue(makeLink())
      prisma.taskCalendarEvent.findFirst.mockResolvedValue({
        ...makeLink({ syncStatus: 'SYNCED' }),
        calendarConnection: { provider: 'GOOGLE' },
      })
      const { service } = makeService(prisma)

      const result = await service.syncTaskToCalendar(makeTask())

      expect(result.syncStatus).toBe('SYNCED')
    })
  })
})
