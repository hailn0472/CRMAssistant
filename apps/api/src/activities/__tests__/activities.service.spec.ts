import { BadRequestException, Logger, NotFoundException } from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

import { ActivityService } from '../activities.service'
import type { ActivityType as PrismaActivityType } from '@prisma/client'

jest.mock('../../common/guards/visibility-check', () => ({
  resolveVisibilityFilter: jest.fn(),
  registerVisibilityService: jest.fn(),
}))

jest.mock('../../common/guards/sharing-check', () => ({
  resolveSharedRecordIds: jest.fn(),
  registerSharingCheck: jest.fn(),
}))

import { resolveVisibilityFilter } from '../../common/guards/visibility-check'
import { resolveSharedRecordIds } from '../../common/guards/sharing-check'

type MockActivityDelegate = {
  create: jest.Mock
  findMany: jest.Mock
  count: jest.Mock
}

type MockPrisma = {
  activity: MockActivityDelegate
  contact: {
    findFirst: jest.Mock
  }
  auditLog: {
    create: jest.Mock
  }
  $transaction: jest.Mock
}

const NOW = new Date('2026-07-27T00:00:00.000Z')
const TENANT_ID = 'tenant-1'
const OTHER_TENANT_ID = 'tenant-2'
const USER_ID = 'user-1'
const CONTACT_ID = 'contact-1'

function makeActivity(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'activity-1',
    tenantId: TENANT_ID,
    contactId: CONTACT_ID,
    type: 'NOTE_ADDED',
    title: 'Test activity',
    description: null,
    source: null,
    sourceId: null,
    dedupeKey: null,
    createdAt: NOW,
    createdBy: USER_ID,
    ...overrides,
  }
}

function makePrisma(): MockPrisma {
  return {
    activity: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    contact: {
      findFirst: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  }
}

function makeAudit(): { log: jest.Mock } {
  return { log: jest.fn().mockResolvedValue(undefined) }
}

describe('ActivityService', () => {
  let service: ActivityService
  let prisma: MockPrisma
  let audit: { log: jest.Mock }
  let pubsub: { publish: jest.Mock }

  beforeEach(() => {
    prisma = makePrisma()
    audit = makeAudit()
    pubsub = { publish: jest.fn() }
    service = new ActivityService(
      prisma as unknown as ConstructorParameters<typeof ActivityService>[0],
      audit as never,
      pubsub as never,
    )
    jest.restoreAllMocks()
  })

  describe('log()', () => {
    it('creates an activity with all required fields', async () => {
      const activity = makeActivity()
      prisma.activity.create.mockResolvedValue(activity)

      const result = await service.log({
        tenantId: TENANT_ID,
        contactId: CONTACT_ID,
        type: 'NOTE_ADDED' as PrismaActivityType,
        title: 'Test activity',
        description: null,
        createdBy: USER_ID,
      })

      expect(result).toBe(activity)
      expect(prisma.activity.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT_ID,
          contactId: CONTACT_ID,
          type: 'NOTE_ADDED',
          title: 'Test activity',
          description: null,
          source: null,
          sourceId: null,
          dedupeKey: null,
          metadata: undefined,
          createdBy: USER_ID,
        },
        // Story 4.4 (AC 16): the parent contact's ownerId is fetched in the
        // same insert round-trip so onActivityLogged can filter in memory.
        select: expect.objectContaining({
          id: true,
          contactId: true,
          contact: { select: { ownerId: true } },
        }),
      })
    })

    it('auto-generates id and createdAt', async () => {
      const activity = makeActivity()
      prisma.activity.create.mockResolvedValue(activity)

      const result = await service.log({
        tenantId: TENANT_ID,
        contactId: CONTACT_ID,
        type: 'NOTE_ADDED' as PrismaActivityType,
        title: 'Test activity',
        createdBy: USER_ID,
      })

      expect(result).toBe(activity)
    })

    it('throws when tenantId is missing', async () => {
      await expect(
        service.log({
          tenantId: '',
          contactId: CONTACT_ID,
          type: 'NOTE_ADDED' as PrismaActivityType,
          title: 'Test',
          createdBy: USER_ID,
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws when contactId is missing', async () => {
      await expect(
        service.log({
          tenantId: TENANT_ID,
          contactId: '',
          type: 'NOTE_ADDED' as PrismaActivityType,
          title: 'Test',
          createdBy: USER_ID,
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws when type is missing', async () => {
      await expect(
        service.log({
          tenantId: TENANT_ID,
          contactId: CONTACT_ID,
          type: '' as PrismaActivityType,
          title: 'Test',
          createdBy: USER_ID,
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws when title is missing', async () => {
      await expect(
        service.log({
          tenantId: TENANT_ID,
          contactId: CONTACT_ID,
          type: 'NOTE_ADDED' as PrismaActivityType,
          title: '',
          createdBy: USER_ID,
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('succeeds with each of the 12 valid ActivityType values', async () => {
      const types: PrismaActivityType[] = [
        'EMAIL_SENT',
        'CALL_MADE',
        'MEETING_SCHEDULED',
        'NOTE_ADDED',
        'DEAL_CREATED',
        'CONTACT_CREATED',
        'CONTACT_UPDATED',
        'CONTACT_OWNER_CHANGED',
        'TASK_COMPLETED',
        'DEAL_STAGE_CHANGED',
        'MESSAGE_RECEIVED',
        'MESSAGE_SENT',
      ]

      for (const type of types) {
        const activity = makeActivity({ type })
        prisma.activity.create.mockResolvedValue(activity)

        const result = await service.log({
          tenantId: TENANT_ID,
          contactId: CONTACT_ID,
          type,
          title: `Test ${type}`,
          createdBy: USER_ID,
        })

        expect(result.type).toBe(type)
      }
    })

    it('passes source, sourceId, dedupeKey and metadata through to prisma.activity.create (AC 12)', async () => {
      const activity = makeActivity({
        source: 'TASK',
        sourceId: 'task-1',
        dedupeKey: 'TASK_COMPLETED:task-1',
      })
      prisma.activity.create.mockResolvedValue(activity)

      await service.log({
        tenantId: TENANT_ID,
        contactId: CONTACT_ID,
        type: 'TASK_COMPLETED' as PrismaActivityType,
        title: 'Task completed: Call Acme',
        createdBy: USER_ID,
        source: 'TASK',
        sourceId: 'task-1',
        dedupeKey: 'TASK_COMPLETED:task-1',
        metadata: { taskId: 'task-1', priority: 'HIGH' },
      })

      expect(prisma.activity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          contactId: CONTACT_ID,
          type: 'TASK_COMPLETED',
          title: 'Task completed: Call Acme',
          source: 'TASK',
          sourceId: 'task-1',
          dedupeKey: 'TASK_COMPLETED:task-1',
          metadata: { taskId: 'task-1', priority: 'HIGH' },
        }),
        select: expect.objectContaining({ contact: { select: { ownerId: true } } }),
      })
    })
  })

  describe('findByContact()', () => {
    const activityObjects = Array.from({ length: 25 }, (_, i) =>
      makeActivity({
        id: `activity-${i + 1}`,
        createdAt: new Date(NOW.getTime() - i * 60000),
      }),
    )
    const activities = activityObjects as Array<Record<string, unknown>>

    it('returns activities sorted by createdAt DESC', async () => {
      prisma.activity.findMany.mockResolvedValue(activities.slice(0, 20))

      const result = await service.findByContact(TENANT_ID, CONTACT_ID, { first: 20 })

      expect(result.edges).toHaveLength(20)
      expect(result.edges[0]!.node.createdAt).toBe((activities[0]!.createdAt as Date).toISOString())
    })

    it('respects tenantId filter — tenant B cannot see tenant A activities', async () => {
      prisma.activity.findMany.mockResolvedValue([])

      const result = await service.findByContact(OTHER_TENANT_ID, CONTACT_ID, { first: 20 })

      expect(result.edges).toHaveLength(0)
      expect(prisma.activity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: OTHER_TENANT_ID }),
        }),
      )
    })

    it('returns first page (first=20) when 25 activities exist', async () => {
      prisma.activity.findMany.mockResolvedValue(activities.slice(0, 21))

      const result = await service.findByContact(TENANT_ID, CONTACT_ID, { first: 20 })

      expect(result.edges).toHaveLength(20)
    })

    it('second page via cursor returns next 5 activities', async () => {
      // First call: page 1
      prisma.activity.findMany.mockResolvedValueOnce(activities.slice(0, 21))
      const page1 = await service.findByContact(TENANT_ID, CONTACT_ID, { first: 20 })

      // Second call: page 2 with cursor = last id of page 1
      prisma.activity.findMany.mockResolvedValueOnce(activities.slice(20, 25))
      const page2 = await service.findByContact(TENANT_ID, CONTACT_ID, {
        first: 20,
        after: page1.pageInfo.endCursor ?? undefined,
      })

      expect(page2.edges).toHaveLength(5)
    })

    it('hasNextPage is true when more records exist', async () => {
      prisma.activity.findMany.mockResolvedValue(activities.slice(0, 21))

      const result = await service.findByContact(TENANT_ID, CONTACT_ID, { first: 20 })

      expect(result.pageInfo.hasNextPage).toBe(true)
    })

    it('hasNextPage is false on last page', async () => {
      prisma.activity.findMany.mockResolvedValue(activities.slice(0, 6))

      const result = await service.findByContact(TENANT_ID, CONTACT_ID, { first: 20 })

      expect(result.pageInfo.hasNextPage).toBe(false)
    })

    it('returns empty edges for contact with no activities', async () => {
      prisma.activity.findMany.mockResolvedValue([])

      const result = await service.findByContact(TENANT_ID, CONTACT_ID, { first: 20 })

      expect(result.edges).toHaveLength(0)
      expect(result.pageInfo.hasNextPage).toBe(false)
    })

    it('uses select only for needed fields (no N+1) — including source (AC 14)', async () => {
      prisma.activity.findMany.mockResolvedValue(activities.slice(0, 2))

      await service.findByContact(TENANT_ID, CONTACT_ID, { first: 20 })

      expect(prisma.activity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: {
            id: true,
            type: true,
            title: true,
            description: true,
            createdAt: true,
            createdBy: true,
            source: true,
          },
        }),
      )
    })

    it('exposes source on the timeline edges (null for manual notes)', async () => {
      prisma.activity.findMany.mockResolvedValue([
        makeActivity({ id: 'a1', source: 'TASK' }),
        makeActivity({ id: 'a2', source: null }),
      ])

      const result = await service.findByContact(TENANT_ID, CONTACT_ID, { first: 20 })

      expect(result.edges[0]!.node.source).toBe('TASK')
      expect(result.edges[1]!.node.source).toBeNull()
    })

    it('clamps first to max 50', async () => {
      prisma.activity.findMany.mockResolvedValue([])

      await service.findByContact(TENANT_ID, CONTACT_ID, { first: 100 })

      expect(prisma.activity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 51, // first + 1, clamped to 50, so 50 + 1 = 51... wait
        }),
      )
    })
  })

  describe('countByContact()', () => {
    it('returns count of activities for a contact', async () => {
      prisma.activity.count.mockResolvedValue(42)

      const result = await service.countByContact(TENANT_ID, CONTACT_ID)

      expect(result).toBe(42)
      expect(prisma.activity.count).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, contactId: CONTACT_ID },
      })
    })
  })

  describe('detectChangedFields()', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseOld: Record<string, any> = {
      email: 'old@example.com',
      firstName: 'Old',
      lastName: 'Name',
      phone: '123',
      company: 'OldCo',
      jobTitle: 'Engineer',
      updatedAt: NOW,
      updatedBy: USER_ID,
      deletedAt: null,
    }

    it('returns changed fields between old and new contact', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const changes = service.detectChangedFields(
        baseOld as Record<string, unknown>,
        { ...baseOld, email: 'new@example.com', company: 'NewCo' } as Record<string, unknown>,
      )

      expect(changes).toContain('email')
      expect(changes).toContain('company')
      expect(changes).not.toContain('updatedAt')
      expect(changes).not.toContain('updatedBy')
      expect(changes).not.toContain('deletedAt')
    })

    it('returns empty array when no meaningful fields changed', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const changes = service.detectChangedFields(
        baseOld as Record<string, unknown>,
        baseOld as Record<string, unknown>,
      )

      expect(changes).toHaveLength(0)
    })

    it('excludes updatedAt, updatedBy, deletedAt from comparison', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const changes = service.detectChangedFields(
        baseOld as Record<string, unknown>,
        {
          ...baseOld,
          updatedAt: new Date(),
          updatedBy: 'other-user',
          deletedAt: new Date(),
        } as Record<string, unknown>,
      )

      expect(changes).toHaveLength(0)
    })

    it('detects null vs string changes', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const changes = service.detectChangedFields(
        { ...baseOld, phone: null } as Record<string, unknown>,
        { ...baseOld, phone: '555-0100' } as Record<string, unknown>,
      )

      expect(changes).toContain('phone')
    })
  })

  describe('logSafe()', () => {
    it('does not throw when activity creation fails', async () => {
      prisma.activity.create.mockRejectedValue(new Error('DB error'))

      // Should not throw
      await expect(
        service.logSafe({
          tenantId: TENANT_ID,
          contactId: CONTACT_ID,
          type: 'NOTE_ADDED' as PrismaActivityType,
          title: 'Test',
          createdBy: USER_ID,
        }),
      ).resolves.not.toThrow()
    })

    it('returns null when activity creation fails', async () => {
      prisma.activity.create.mockRejectedValue(new Error('DB error'))

      const result = await service.logSafe({
        tenantId: TENANT_ID,
        contactId: CONTACT_ID,
        type: 'NOTE_ADDED' as PrismaActivityType,
        title: 'Test',
        createdBy: USER_ID,
      })

      expect(result).toBeNull()
    })

    it('returns the created activity on success', async () => {
      const activity = makeActivity()
      prisma.activity.create.mockResolvedValue(activity)

      const result = await service.logSafe({
        tenantId: TENANT_ID,
        contactId: CONTACT_ID,
        type: 'NOTE_ADDED' as PrismaActivityType,
        title: 'Test',
        createdBy: USER_ID,
      })

      expect(result).toBe(activity)
    })

    it('returns null and logs at debug level on a Prisma P2002 dedupe hit (AC 13)', async () => {
      const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
      prisma.activity.create.mockRejectedValue(
        new PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.22.0',
        }),
      )

      const result = await service.logSafe({
        tenantId: TENANT_ID,
        contactId: CONTACT_ID,
        type: 'TASK_COMPLETED' as PrismaActivityType,
        title: 'Task completed: Call Acme',
        createdBy: USER_ID,
        source: 'TASK',
        sourceId: 'task-1',
        dedupeKey: 'TASK_COMPLETED:task-1',
      })

      expect(result).toBeNull()
      expect(debugSpy).toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('returns null and logs at warn level on a generic Error (AC 13)', async () => {
      const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
      prisma.activity.create.mockRejectedValue(new Error('connection refused'))

      const result = await service.logSafe({
        tenantId: TENANT_ID,
        contactId: CONTACT_ID,
        type: 'NOTE_ADDED' as PrismaActivityType,
        title: 'Test',
        createdBy: USER_ID,
      })

      expect(result).toBeNull()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('connection refused'))
      expect(debugSpy).not.toHaveBeenCalled()
    })

    it('returns null and logs at warn level on a non-Error throw via String(error) (AC 13 / finding 3.7-F6)', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
      prisma.activity.create.mockRejectedValue('panic')

      const result = await service.logSafe({
        tenantId: TENANT_ID,
        contactId: CONTACT_ID,
        type: 'NOTE_ADDED' as PrismaActivityType,
        title: 'Test',
        createdBy: USER_ID,
      })

      expect(result).toBeNull()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('panic'))
    })

    it('never audits auto-logged activities (AC 44)', async () => {
      prisma.activity.create.mockResolvedValue(makeActivity())

      await service.logSafe({
        tenantId: TENANT_ID,
        contactId: CONTACT_ID,
        type: 'TASK_COMPLETED' as PrismaActivityType,
        title: 'Task completed: Call Acme',
        createdBy: USER_ID,
        source: 'TASK',
        sourceId: 'task-1',
        dedupeKey: 'TASK_COMPLETED:task-1',
      })

      expect(audit.log).not.toHaveBeenCalled()
    })
  })

  describe('addContactNote()', () => {
    it('creates the NOTE_ADDED activity and writes an audit row (AC 43)', async () => {
      const activity = makeActivity({ id: 'note-1', type: 'NOTE_ADDED' })
      prisma.activity.create.mockResolvedValue(activity)

      const result = await service.addContactNote({
        tenantId: TENANT_ID,
        contactId: CONTACT_ID,
        title: 'Follow up call',
        description: 'Customer asked for a quote',
        userId: USER_ID,
      })

      expect(result.id).toBe('note-1')
      expect(prisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_ID,
            contactId: CONTACT_ID,
            type: 'NOTE_ADDED',
            title: 'Follow up call',
            description: 'Customer asked for a quote',
            createdBy: USER_ID,
          }),
        }),
      )
      expect(audit.log).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        userId: USER_ID,
        action: 'CREATE',
        entity: 'ACTIVITY',
        entityId: 'note-1',
        details: { mutationName: 'CREATE' },
      })
    })

    it('defaults a missing description to null', async () => {
      const activity = makeActivity()
      prisma.activity.create.mockResolvedValue(activity)

      await service.addContactNote({
        tenantId: TENANT_ID,
        contactId: CONTACT_ID,
        title: 'Note',
        userId: USER_ID,
      })
      expect(prisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ description: null }),
        }),
      )
    })
  })

  describe('checkContactAccess()', () => {
    beforeEach(() => {
      jest.clearAllMocks()
    })

    it('passes when contact exists and user is admin (visibilityFilter = undefined)', async () => {
      prisma.contact.findFirst.mockResolvedValue({ id: CONTACT_ID, ownerId: 'user-2' })
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(undefined)

      await expect(
        service.checkContactAccess(TENANT_ID, USER_ID, CONTACT_ID),
      ).resolves.not.toThrow()
    })

    it('passes when contact exists and user is the owner', async () => {
      prisma.contact.findFirst.mockResolvedValue({ id: CONTACT_ID, ownerId: USER_ID })
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(USER_ID)
      ;(resolveSharedRecordIds as jest.Mock).mockResolvedValue([])

      await expect(
        service.checkContactAccess(TENANT_ID, USER_ID, CONTACT_ID),
      ).resolves.not.toThrow()
    })

    it('passes when contact is shared with the user', async () => {
      prisma.contact.findFirst.mockResolvedValue({ id: CONTACT_ID, ownerId: 'user-2' })
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue('user-2')
      ;(resolveSharedRecordIds as jest.Mock).mockResolvedValue([CONTACT_ID])

      await expect(
        service.checkContactAccess(TENANT_ID, USER_ID, CONTACT_ID),
      ).resolves.not.toThrow()
    })

    it('throws NotFoundException when contact does not exist', async () => {
      prisma.contact.findFirst.mockResolvedValue(null)

      await expect(service.checkContactAccess(TENANT_ID, USER_ID, CONTACT_ID)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('throws NotFoundException when user has no access (not owner, not shared, no admin)', async () => {
      prisma.contact.findFirst.mockResolvedValue({ id: CONTACT_ID, ownerId: 'user-2' })
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(USER_ID) // OWN visibility
      ;(resolveSharedRecordIds as jest.Mock).mockResolvedValue([])

      await expect(service.checkContactAccess(TENANT_ID, USER_ID, CONTACT_ID)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('throws NotFoundException for contact from different tenant', async () => {
      prisma.contact.findFirst.mockResolvedValue(null)

      await expect(
        service.checkContactAccess(OTHER_TENANT_ID, USER_ID, CONTACT_ID),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('findByContact() with includeTotalCount', () => {
    const activityObjects = Array.from({ length: 25 }, (_, i) =>
      makeActivity({
        id: `activity-${i + 1}`,
        createdAt: new Date(NOW.getTime() - i * 60000),
      }),
    )
    const activities = activityObjects as Array<Record<string, unknown>>

    it('returns totalCount when includeTotalCount is true', async () => {
      prisma.activity.findMany.mockResolvedValue(activities.slice(0, 21))
      prisma.$transaction.mockResolvedValue([
        activities.slice(0, 21),
        42, // count result
      ])

      const result = await service.findByContact(TENANT_ID, CONTACT_ID, {
        first: 20,
        includeTotalCount: true,
      })

      expect(result.totalCount).toBe(42)
      expect(result.edges).toHaveLength(20)
      expect(result.pageInfo.hasNextPage).toBe(true)
    })

    it('runs findMany and count in a single $transaction when includeTotalCount is true', async () => {
      prisma.activity.findMany.mockResolvedValue(activities.slice(0, 21))
      prisma.$transaction.mockResolvedValue([activities.slice(0, 21), 25])

      await service.findByContact(TENANT_ID, CONTACT_ID, {
        first: 20,
        includeTotalCount: true,
      })

      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    })

    it('returns totalCount of 0 when includeTotalCount is not set (no extra query)', async () => {
      prisma.activity.findMany.mockResolvedValue(activities.slice(0, 21))

      const result = await service.findByContact(TENANT_ID, CONTACT_ID, { first: 20 })

      expect(result.totalCount).toBe(0)
      // Should NOT have called $transaction
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })
  })

  // ─── Story 4.4: tenant-wide activity feed (AC 4-11) ─────────────────────

  function makeFeedActivity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      ...makeActivity({ sourceId: null }),
      contact: { id: CONTACT_ID, firstName: 'Ada', lastName: 'Lovelace' },
      ...overrides,
    }
  }

  describe('findFeed()', () => {
    beforeEach(() => {
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(USER_ID)
      ;(resolveSharedRecordIds as jest.Mock).mockResolvedValue([])
    })

    function mockFeedRows(rows: Array<Record<string, unknown>>): void {
      prisma.activity.findMany.mockResolvedValue(rows as never)
      prisma.activity.count.mockResolvedValue(rows.length)
    }

    it('returns the house connection shape with page=1/pageSize=20 defaults (AC 4)', async () => {
      mockFeedRows([makeFeedActivity()])

      const result = await service.findFeed(TENANT_ID, USER_ID, {})

      expect(result.items).toHaveLength(1)
      expect(result.total).toBe(1)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(20)
      expect(prisma.activity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      )
    })

    it('clamps pageSize at 100 (AC 4)', async () => {
      mockFeedRows([])

      await service.findFeed(TENANT_ID, USER_ID, {}, { page: 1, pageSize: 500 })

      expect(prisma.activity.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }))
    })

    it('case 1: ADMIN/ALL visibility (undefined) applies NO owner predicate (AC 5)', async () => {
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(undefined)
      mockFeedRows([makeFeedActivity()])

      await service.findFeed(TENANT_ID, USER_ID, {})

      const where = (
        prisma.activity.findMany.mock.calls[0]![0] as { where: Record<string, unknown> }
      ).where
      expect(where.tenantId).toBe(TENANT_ID)
      expect(where.contact).toEqual({ deletedAt: null })
      expect(where.OR).toBeUndefined()
    })

    it('case 2: OWN visibility (string) adds contact.ownerId predicate (AC 5)', async () => {
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(USER_ID)
      mockFeedRows([makeFeedActivity()])

      await service.findFeed(TENANT_ID, USER_ID, {})

      const where = (prisma.activity.findMany.mock.calls[0]![0] as { where: { OR: unknown[] } })
        .where
      expect(where.OR).toContainEqual({ contact: { ownerId: USER_ID } })
    })

    it('case 3: TEAM visibility ({ in }) adds contact.ownerId { in } predicate (AC 5)', async () => {
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue({ in: ['user-1', 'user-2'] })
      mockFeedRows([makeFeedActivity()])

      await service.findFeed(TENANT_ID, USER_ID, {})

      const where = (prisma.activity.findMany.mock.calls[0]![0] as { where: { OR: unknown[] } })
        .where
      expect(where.OR).toContainEqual({ contact: { ownerId: { in: ['user-1', 'user-2'] } } })
    })

    it('case 4: sharing rules add a contactId { in } OR branch (AC 5)', async () => {
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(USER_ID)
      ;(resolveSharedRecordIds as jest.Mock).mockResolvedValue(['contact-shared'])
      mockFeedRows([makeFeedActivity()])

      await service.findFeed(TENANT_ID, USER_ID, {})

      const where = (prisma.activity.findMany.mock.calls[0]![0] as { where: { OR: unknown[] } })
        .where
      expect(where.OR).toContainEqual({ contact: { ownerId: USER_ID } })
      expect(where.OR).toContainEqual({ contactId: { in: ['contact-shared'] } })
    })

    it('shared-only: no visibility predicate, shared ids still surface via OR (AC 5)', async () => {
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(undefined)
      ;(resolveSharedRecordIds as jest.Mock).mockResolvedValue(['contact-shared'])
      mockFeedRows([makeFeedActivity()])

      await service.findFeed(TENANT_ID, USER_ID, {})

      const where = (prisma.activity.findMany.mock.calls[0]![0] as { where: { OR: unknown[] } })
        .where
      expect(where.OR).toEqual([{ contactId: { in: ['contact-shared'] } }])
    })

    it('always scopes to tenantId and excludes soft-deleted contacts (AC 5)', async () => {
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(USER_ID)
      mockFeedRows([makeFeedActivity()])

      await service.findFeed(TENANT_ID, USER_ID, {})

      const where = (
        prisma.activity.findMany.mock.calls[0]![0] as { where: Record<string, unknown> }
      ).where
      expect(where.tenantId).toBe(TENANT_ID)
      expect(where.contact).toEqual({ deletedAt: null })
    })

    it('cross-tenant (non-ADMIN OWN scope): feed query is scoped to the caller tenant (AC 6)', async () => {
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(USER_ID) // SALES_REP OWN — not ADMIN
      mockFeedRows([])

      await service.findFeed(OTHER_TENANT_ID, USER_ID, {})

      const where = (
        prisma.activity.findMany.mock.calls[0]![0] as { where: Record<string, unknown> }
      ).where
      expect(where.tenantId).toBe(OTHER_TENANT_ID)
      expect(where.OR).toContainEqual({ contact: { ownerId: USER_ID } })
    })

    it('ADMIN bypass: no owner predicate is applied (AC 6 / T9)', async () => {
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(undefined)
      mockFeedRows([makeFeedActivity()])

      await service.findFeed(TENANT_ID, USER_ID, {})

      const where = (
        prisma.activity.findMany.mock.calls[0]![0] as { where: Record<string, unknown> }
      ).where
      expect(where.OR).toBeUndefined()
    })

    it('createdTo is inclusive of the whole final day (AC 8)', async () => {
      mockFeedRows([])

      await service.findFeed(TENANT_ID, USER_ID, { createdTo: '2026-08-05' })

      const where = (
        prisma.activity.findMany.mock.calls[0]![0] as {
          where: { AND: unknown[] }
        }
      ).where
      // The house day-closing rule (buildTaskWhere) is `setHours(23,59,59,999)`
      // in local time — compute the expectation the same way so the test is
      // timezone-independent.
      const endDate = new Date('2026-08-05')
      endDate.setHours(23, 59, 59, 999)
      expect(where.AND).toContainEqual({ createdAt: { lte: endDate } })
    })

    it('orders by createdAt DESC then id DESC — the stable tiebreaker (AC 9)', async () => {
      mockFeedRows([makeFeedActivity()])

      await service.findFeed(TENANT_ID, USER_ID, {})

      expect(prisma.activity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      )
    })

    it('each filter field narrows the where clause (AC 7)', async () => {
      mockFeedRows([])

      await service.findFeed(TENANT_ID, USER_ID, {
        type: 'CALL_MADE',
        source: 'TASK',
        contactId: CONTACT_ID,
        createdBy: 'user-9',
        createdFrom: '2026-08-01',
        search: 'acme',
      })

      const where = (prisma.activity.findMany.mock.calls[0]![0] as { where: { AND: unknown[] } })
        .where
      expect(where.AND).toContainEqual({ type: 'CALL_MADE' })
      expect(where.AND).toContainEqual({ source: 'TASK' })
      expect(where.AND).toContainEqual({ contactId: CONTACT_ID })
      expect(where.AND).toContainEqual({ createdBy: 'user-9' })
      expect(where.AND).toContainEqual({ createdAt: { gte: new Date('2026-08-01') } })
      expect(where.AND).toContainEqual({
        title: { contains: 'acme', mode: 'insensitive' },
      })
    })

    it('unknown/empty filter values are ignored, never rejected (AC 7)', async () => {
      mockFeedRows([])

      await service.findFeed(TENANT_ID, USER_ID, {
        type: '',
        source: '',
        contactId: '',
        createdBy: '',
        search: '   ',
      })

      const where = (
        prisma.activity.findMany.mock.calls[0]![0] as { where: Record<string, unknown> }
      ).where
      expect(where.AND).toBeUndefined()
    })

    it('selects sourceId and the parent contact identity via ACTIVITY_FEED_SELECT (AC 10)', async () => {
      mockFeedRows([
        makeFeedActivity({
          id: 'a1',
          sourceId: 'task-9',
          contact: { id: 'c1', firstName: 'Ada', lastName: 'L' },
        }),
      ])

      const result = await service.findFeed(TENANT_ID, USER_ID, {})

      expect(prisma.activity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            sourceId: true,
            contact: { select: { id: true, firstName: true, lastName: true } },
          }),
        }),
      )
      expect(result.items[0]).toMatchObject({ sourceId: 'task-9' })
    })

    it('does not widen ACTIVITY_SELECT — findByContact keeps its 7-field select (AC 10)', async () => {
      prisma.activity.findMany.mockResolvedValue([makeActivity()])

      await service.findByContact(TENANT_ID, CONTACT_ID, { first: 20 })

      expect(prisma.activity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: {
            id: true,
            type: true,
            title: true,
            description: true,
            createdAt: true,
            createdBy: true,
            source: true,
          },
        }),
      )
    })
  })

  describe('getFeedStats()', () => {
    beforeEach(() => {
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(USER_ID)
      ;(resolveSharedRecordIds as jest.Mock).mockResolvedValue([])
    })

    it('returns todayCount/weekCount from activity counts scoped to visibility (AC 11)', async () => {
      prisma.activity.count.mockResolvedValueOnce(3).mockResolvedValueOnce(9)

      const result = await service.getFeedStats(TENANT_ID, USER_ID, NOW)

      expect(result).toEqual({ todayCount: 3, weekCount: 9 })
      expect(prisma.activity.count).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: NOW, lt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000) },
          }),
        }),
      )
      expect(prisma.activity.count).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000) },
          }),
        }),
      )
    })

    it('never counts tasks itself — TasksService is NOT injected (AC 11 / T8b)', async () => {
      prisma.activity.count.mockResolvedValue(1)

      const result = await service.getFeedStats(TENANT_ID, USER_ID, NOW)

      expect(result).toEqual({ todayCount: 1, weekCount: 1 })
      expect(prisma).not.toHaveProperty('task')
      expect(Object.keys(result)).not.toContain('tasksDueToday')
      expect(Object.keys(result)).not.toContain('overdueTasks')
    })

    it('applies the same visibility + sharing OR predicate as findFeed (AC 11)', async () => {
      ;(resolveSharedRecordIds as jest.Mock).mockResolvedValue(['contact-shared'])
      prisma.activity.count.mockResolvedValue(0)

      await service.getFeedStats(TENANT_ID, USER_ID, NOW)

      expect(prisma.activity.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ contact: { ownerId: USER_ID } }, { contactId: { in: ['contact-shared'] } }],
          }),
        }),
      )
    })
  })

  describe('log() — Story 4.4 contact-owner select + onActivityLogged publish (AC 14-19)', () => {
    beforeEach(() => {
      jest.clearAllMocks()
    })

    it('fetches the parent contact ownerId in the same insert round-trip (AC 16)', async () => {
      prisma.activity.create.mockResolvedValue({
        ...makeActivity(),
        contact: { ownerId: 'owner-1' },
      })

      await service.log({
        tenantId: TENANT_ID,
        contactId: CONTACT_ID,
        type: 'NOTE_ADDED' as PrismaActivityType,
        title: 'Test',
        createdBy: USER_ID,
      })

      expect(prisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({ contact: { select: { ownerId: true } } }),
        }),
      )
    })

    it('publishes onActivityLogged with contactOwnerId on the ACTIVITY_LOGGED channel (AC 14, 16)', async () => {
      const created = {
        ...makeActivity({ id: 'a-42' }),
        contact: { ownerId: 'owner-1' },
      }
      prisma.activity.create.mockResolvedValue(created)

      const result = await service.log({
        tenantId: TENANT_ID,
        contactId: CONTACT_ID,
        type: 'CALL_MADE' as PrismaActivityType,
        title: 'Call Acme',
        createdBy: USER_ID,
      })

      expect(result.id).toBe('a-42')
      expect(pubsub.publish).toHaveBeenCalledWith(
        `ACTIVITY_LOGGED:${TENANT_ID}`,
        expect.objectContaining({ contactOwnerId: 'owner-1' }),
      )
    })

    it('a publish failure never fails the mutation (AC 19)', async () => {
      pubsub.publish.mockImplementation(() => {
        throw new Error('emitter exploded')
      })
      prisma.activity.create.mockResolvedValue({
        ...makeActivity({ id: 'a-43' }),
        contact: { ownerId: 'owner-1' },
      })

      await expect(
        service.log({
          tenantId: TENANT_ID,
          contactId: CONTACT_ID,
          type: 'NOTE_ADDED' as PrismaActivityType,
          title: 'Test',
          createdBy: USER_ID,
        }),
      ).resolves.toMatchObject({ id: 'a-43' })
    })
  })
})
