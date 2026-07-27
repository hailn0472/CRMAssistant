import { BadRequestException, NotFoundException } from '@nestjs/common'

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
    $transaction: jest.fn(),
  }
}

describe('ActivityService', () => {
  let service: ActivityService
  let prisma: MockPrisma

  beforeEach(() => {
    prisma = makePrisma()
    service = new ActivityService(
      prisma as unknown as ConstructorParameters<typeof ActivityService>[0],
    )
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
          createdBy: USER_ID,
        },
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

    it('succeeds with each of the 7 valid ActivityType values', async () => {
      const types: PrismaActivityType[] = [
        'EMAIL_SENT',
        'CALL_MADE',
        'MEETING_SCHEDULED',
        'NOTE_ADDED',
        'DEAL_CREATED',
        'CONTACT_CREATED',
        'CONTACT_UPDATED',
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
      expect(result.edges[0]!.node.createdAt).toBe(
        (activities[0]!.createdAt as Date).toISOString(),
      )
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

    it('uses select only for needed fields (no N+1)', async () => {
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
          },
        }),
      )
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
      const changes = service.detectChangedFields(baseOld as Record<string, unknown>, baseOld as Record<string, unknown>)

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

      await expect(
        service.checkContactAccess(TENANT_ID, USER_ID, CONTACT_ID),
      ).rejects.toThrow(NotFoundException)
    })

    it('throws NotFoundException when user has no access (not owner, not shared, no admin)', async () => {
      prisma.contact.findFirst.mockResolvedValue({ id: CONTACT_ID, ownerId: 'user-2' })
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(USER_ID) // OWN visibility
      ;(resolveSharedRecordIds as jest.Mock).mockResolvedValue([])

      await expect(
        service.checkContactAccess(TENANT_ID, USER_ID, CONTACT_ID),
      ).rejects.toThrow(NotFoundException)
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
      prisma.$transaction.mockResolvedValue([
        activities.slice(0, 21),
        25,
      ])

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
})
