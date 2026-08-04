import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

import { ContactsService } from '../contacts.service'
import type { Contact } from '@prisma/client'

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

type MockActivityService = {
  log: jest.Mock
  logSafe: jest.Mock
  detectChangedFields: jest.Mock
  findByContact: jest.Mock
  countByContact: jest.Mock
}

type MockContactDelegate = {
  create: jest.Mock
  findFirst: jest.Mock
  findMany: jest.Mock
  count: jest.Mock
  updateMany: jest.Mock
  update: jest.Mock
}

type MockSharingRuleDelegate = {
  findFirst: jest.Mock
}

type MockUserRoleDelegate = {
  findMany: jest.Mock
}

type MockUserDelegate = {
  findFirst: jest.Mock
  findUnique: jest.Mock
}

type MockTeamDelegate = {
  findFirst: jest.Mock
}

type MockContactTagDelegate = {
  create: jest.Mock
  delete: jest.Mock
  findMany: jest.Mock
}

type MockTagDelegate = {
  create: jest.Mock
  findFirst: jest.Mock
  findMany: jest.Mock
  delete: jest.Mock
}

type MockPrisma = {
  contact: MockContactDelegate
  sharingRule: MockSharingRuleDelegate
  userRole: MockUserRoleDelegate
  user: MockUserDelegate
  team: MockTeamDelegate
  contactTag: MockContactTagDelegate
  tag: MockTagDelegate
  $transaction: jest.Mock
}

const NOW = new Date('2026-05-13T00:00:00.000Z')
const TENANT_ID = 'tenant-1'
const OTHER_TENANT_ID = 'tenant-2'
const USER_ID = 'user-1'
const CONTACT_ID = 'contact-1'

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: CONTACT_ID,
    tenantId: TENANT_ID,
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: null,
    company: null,
    jobTitle: null,
    linkedin: null,
    twitter: null,
    addressStreet: null,
    addressCity: null,
    addressCountry: null,
    department: null,
    timezone: null,
    language: null,
    source: null,
    notes: null,
    ownerId: USER_ID,
    teamId: null,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: USER_ID,
    updatedBy: USER_ID,
    deletedAt: null,
    ...overrides,
  }
}

function makePrisma(): MockPrisma {
  const delegates = {
    contact: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    sharingRule: {
      findFirst: jest.fn(),
    },
    userRole: {
      findMany: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    team: {
      findFirst: jest.fn(),
    },
    contactTag: {
      create: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
    },
    tag: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  }
  delegates.$transaction.mockImplementation((cb: (tx: typeof delegates) => unknown) =>
    cb(delegates),
  )
  return delegates
}

function makeActivityService(): MockActivityService {
  return {
    log: jest.fn(),
    logSafe: jest.fn(),
    detectChangedFields: jest.fn(),
    findByContact: jest.fn(),
    countByContact: jest.fn(),
  }
}

describe('ContactsService', () => {
  let service: ContactsService
  let prisma: MockPrisma
  let activityService: MockActivityService

  beforeEach(() => {
    prisma = makePrisma()
    activityService = makeActivityService()
    ;(activityService.detectChangedFields as jest.Mock).mockReturnValue([])
    service = new ContactsService(
      prisma as unknown as ConstructorParameters<typeof ContactsService>[0],
      activityService as unknown as ConstructorParameters<typeof ContactsService>[1],
    )
    ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(undefined)
    ;(resolveSharedRecordIds as jest.Mock).mockResolvedValue([])
  })

  describe('create()', () => {
    it('creates a contact scoped to authenticated tenant and user', async () => {
      const contact = makeContact()
      prisma.contact.create.mockResolvedValue(contact)

      const result = await service.create(TENANT_ID, USER_ID, {
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
      })

      expect(result).toBe(contact)
      expect(prisma.contact.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT_ID,
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          phone: undefined,
          company: undefined,
          jobTitle: undefined,
          ownerId: USER_ID,
          createdBy: USER_ID,
          updatedBy: USER_ID,
        },
      })
    })

    it('assigns an explicit owner from the same tenant', async () => {
      const contact = makeContact()
      prisma.user.findFirst.mockResolvedValue({ id: 'owner-2' })
      prisma.contact.create.mockResolvedValue(contact)

      await service.create(TENANT_ID, USER_ID, {
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        ownerId: 'owner-2',
      })

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'owner-2', tenantId: TENANT_ID, deletedAt: null },
        select: { id: true },
      })
      expect(prisma.contact.create.mock.calls[0][0].data.ownerId).toBe('owner-2')
    })

    it('rejects an owner that does not belong to the tenant', async () => {
      prisma.user.findFirst.mockResolvedValue(null)

      await expect(
        service.create(TENANT_ID, USER_ID, {
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          ownerId: 'outsider',
        }),
      ).rejects.toThrow(NotFoundException)
      expect(prisma.contact.create).not.toHaveBeenCalled()
    })

    it('skips the owner lookup when the creator owns the contact', async () => {
      prisma.contact.create.mockResolvedValue(makeContact())

      await service.create(TENANT_ID, USER_ID, {
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        ownerId: USER_ID,
      })

      expect(prisma.user.findFirst).not.toHaveBeenCalled()
      expect(prisma.contact.create.mock.calls[0][0].data.ownerId).toBe(USER_ID)
    })

    it('persists the enrichment fields', async () => {
      prisma.contact.create.mockResolvedValue(makeContact())

      await service.create(TENANT_ID, USER_ID, {
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        notes: 'Met at the summit',
        source: 'Event',
        linkedin: 'ada-lovelace',
      })

      const data = prisma.contact.create.mock.calls[0][0].data
      expect(data.notes).toBe('Met at the summit')
      expect(data.source).toBe('Event')
      expect(data.linkedin).toBe('ada-lovelace')
    })

    it('throws ConflictException for duplicate email in the same tenant', async () => {
      prisma.contact.create.mockRejectedValue(
        new PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.22.0',
        }),
      )

      await expect(
        service.create(TENANT_ID, USER_ID, {
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
        }),
      ).rejects.toThrow(ConflictException)
    })

    it('normalizes optional empty strings and trims contact fields', async () => {
      const contact = makeContact({
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        phone: null,
      })
      prisma.contact.create.mockResolvedValue(contact)

      await service.create(TENANT_ID, USER_ID, {
        email: ' Ada@Example.COM ',
        firstName: ' Ada ',
        lastName: ' Lovelace ',
        phone: '   ',
        company: ' Analytical Engines ',
        jobTitle: ' Mathematician ',
      })

      expect(prisma.contact.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          phone: undefined,
          company: 'Analytical Engines',
          jobTitle: 'Mathematician',
        }) as Record<string, unknown>,
      })
    })

    it('rejects blank required fields', async () => {
      await expect(
        service.create(TENANT_ID, USER_ID, {
          email: 'ada@example.com',
          firstName: '   ',
          lastName: 'Lovelace',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects overly long required fields', async () => {
      await expect(
        service.create(TENANT_ID, USER_ID, {
          email: 'ada@example.com',
          firstName: 'A'.repeat(101),
          lastName: 'Lovelace',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects invalid emails', async () => {
      await expect(
        service.create(TENANT_ID, USER_ID, {
          email: 'not-an-email',
          firstName: 'Ada',
          lastName: 'Lovelace',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects overly long optional fields', async () => {
      await expect(
        service.create(TENANT_ID, USER_ID, {
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          company: 'A'.repeat(201),
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('auto-logs CONTACT_CREATED activity after creating a contact (UT-B-26)', async () => {
      const contact = makeContact()
      prisma.contact.create.mockResolvedValue(contact)
      ;(activityService.logSafe as jest.Mock).mockResolvedValue(contact)

      await service.create(TENANT_ID, USER_ID, {
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
      })

      expect(activityService.logSafe).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        contactId: contact.id,
        type: 'CONTACT_CREATED',
        title: 'Contact created',
        description: 'Ada Lovelace (ada@example.com)',
        createdBy: USER_ID,
      })
    })

    it('contact creation succeeds even if auto-logging fails (non-blocking)', async () => {
      const contact = makeContact()
      prisma.contact.create.mockResolvedValue(contact)
      ;(activityService.logSafe as jest.Mock).mockResolvedValue(null)

      const result = await service.create(TENANT_ID, USER_ID, {
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
      })

      expect(result).toBe(contact)
    })
  })

  describe('findOne()', () => {
    it('returns active contact scoped to tenant and visible to user', async () => {
      const contact = makeContact()
      prisma.contact.findFirst.mockResolvedValue(contact)
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(undefined)

      await expect(service.findOne(TENANT_ID, USER_ID, CONTACT_ID)).resolves.toBe(contact)
      expect(prisma.contact.findFirst).toHaveBeenCalledWith({
        where: { id: CONTACT_ID, tenantId: TENANT_ID, deletedAt: null },
        include: {
          owner: {
            select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
          },
        },
      })
    })

    it('allows access when visibility resolves to OWN and ownerId matches', async () => {
      const contact = makeContact()
      prisma.contact.findFirst.mockResolvedValue(contact)
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(USER_ID)

      await expect(service.findOne(TENANT_ID, USER_ID, CONTACT_ID)).resolves.toBe(contact)
    })

    it('throws NotFoundException when OWN visibility rejects different owner', async () => {
      const contact = makeContact({ ownerId: 'other-user' })
      prisma.contact.findFirst.mockResolvedValue(contact)
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(USER_ID)

      await expect(service.findOne(TENANT_ID, USER_ID, CONTACT_ID)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('throws NotFoundException when TEAM visibility rejects non-member owner', async () => {
      const contact = makeContact({ ownerId: 'external-user' })
      prisma.contact.findFirst.mockResolvedValue(contact)
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue({ in: [USER_ID, 'teammate'] })

      await expect(service.findOne(TENANT_ID, USER_ID, CONTACT_ID)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('allows access when TEAM visibility includes contact owner', async () => {
      const contact = makeContact({ ownerId: 'teammate' })
      prisma.contact.findFirst.mockResolvedValue(contact)
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue({ in: [USER_ID, 'teammate'] })

      await expect(service.findOne(TENANT_ID, USER_ID, CONTACT_ID)).resolves.toBe(contact)
    })

    it('allows access when sharing grants access but OWN visibility denies', async () => {
      const contact = makeContact({ ownerId: 'other-user' })
      prisma.contact.findFirst.mockResolvedValue(contact)
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(USER_ID)
      ;(resolveSharedRecordIds as jest.Mock).mockResolvedValue([CONTACT_ID])

      await expect(service.findOne(TENANT_ID, USER_ID, CONTACT_ID)).resolves.toBe(contact)
    })

    it('throws NotFoundException when neither visibility nor sharing grants access', async () => {
      const contact = makeContact({ ownerId: 'other-user' })
      prisma.contact.findFirst.mockResolvedValue(contact)
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(USER_ID)
      ;(resolveSharedRecordIds as jest.Mock).mockResolvedValue([])

      await expect(service.findOne(TENANT_ID, USER_ID, CONTACT_ID)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('allows access via team sharing', async () => {
      const contact = makeContact({ ownerId: 'other-user' })
      prisma.contact.findFirst.mockResolvedValue(contact)
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(USER_ID)
      ;(resolveSharedRecordIds as jest.Mock).mockResolvedValue([CONTACT_ID])

      await expect(service.findOne(TENANT_ID, USER_ID, CONTACT_ID)).resolves.toBe(contact)
    })

    it('throws NotFoundException for cross-tenant or deleted contacts', async () => {
      prisma.contact.findFirst.mockResolvedValue(null)

      await expect(service.findOne(OTHER_TENANT_ID, USER_ID, CONTACT_ID)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('findMany()', () => {
    it('returns paginated active tenant contacts and total count', async () => {
      const contact = makeContact()
      prisma.contact.findMany.mockResolvedValue([contact])
      prisma.contact.count.mockResolvedValue(1)

      const result = await service.findMany(TENANT_ID, USER_ID, {}, { page: 2, pageSize: 10 })

      expect(result).toEqual({
        items: [{ ...contact, sharedWithMe: false }],
        total: 1,
        page: 2,
        pageSize: 10,
      })
      expect(prisma.contact.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip: 10,
        take: 10,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          company: true,
          jobTitle: true,
          linkedin: true,
          twitter: true,
          addressStreet: true,
          addressCity: true,
          addressCountry: true,
          department: true,
          timezone: true,
          language: true,
          source: true,
          notes: true,
          ownerId: true,
          owner: {
            select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
          },
          tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
          createdAt: true,
          updatedAt: true,
        },
      })
      expect(prisma.contact.count).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, deletedAt: null },
      })
    })

    it('returns owned + shared contacts when sharing rules exist for OWN visibility', async () => {
      const owned = makeContact()
      const shared = makeContact({ id: 'shared-contact', ownerId: 'other-user' })
      prisma.contact.findMany.mockResolvedValue([owned, shared])
      prisma.contact.count.mockResolvedValue(2)
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(USER_ID)
      ;(resolveSharedRecordIds as jest.Mock).mockResolvedValue(['shared-contact'])

      const result = await service.findMany(TENANT_ID, USER_ID)

      expect(result.items).toHaveLength(2)
      expect(result.items[0]!.sharedWithMe).toBe(false)
      expect(result.items[1]!.sharedWithMe).toBe(true)
      expect(prisma.contact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({
                OR: expect.arrayContaining([
                  { ownerId: USER_ID },
                  { id: { in: ['shared-contact'] } },
                ]),
              }),
            ]),
          }),
        }),
      )
    })

    it('returns all contacts for ALL visibility regardless of sharing rules', async () => {
      const contact = makeContact()
      prisma.contact.findMany.mockResolvedValue([contact])
      prisma.contact.count.mockResolvedValue(1)
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(undefined)
      ;(resolveSharedRecordIds as jest.Mock).mockResolvedValue(['shared-contact'])

      const result = await service.findMany(TENANT_ID, USER_ID)

      // ALL mode should not add ANY ownerConditions (no OR filter)
      expect(result.items).toHaveLength(1)
    })

    it('applies sharing OR filter for TEAM visibility', async () => {
      const teamContact = makeContact({ ownerId: 'teammate' })
      const sharedContact = makeContact({ id: 'shared-contact', ownerId: 'external-user' })
      prisma.contact.findMany.mockResolvedValue([teamContact, sharedContact])
      prisma.contact.count.mockResolvedValue(2)
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue({ in: [USER_ID, 'teammate'] })
      ;(resolveSharedRecordIds as jest.Mock).mockResolvedValue(['shared-contact'])

      const result = await service.findMany(TENANT_ID, USER_ID)

      expect(result.items).toHaveLength(2)
      expect(prisma.contact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({
                OR: expect.arrayContaining([
                  { ownerId: { in: [USER_ID, 'teammate'] } },
                  { id: { in: ['shared-contact'] } },
                ]),
              }),
            ]),
          }),
        }),
      )
    })

    it('returns sharedWithMe true for shared contacts and false for owned', async () => {
      const owned = makeContact()
      const shared = makeContact({ id: 'shared-contact', ownerId: 'other-user' })
      prisma.contact.findMany.mockResolvedValue([owned, shared])
      prisma.contact.count.mockResolvedValue(2)
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(USER_ID)
      ;(resolveSharedRecordIds as jest.Mock).mockResolvedValue(['shared-contact'])

      const result = await service.findMany(TENANT_ID, USER_ID)

      expect(result.items.find((c) => c.id === CONTACT_ID)!.sharedWithMe).toBe(false)
      expect(result.items.find((c) => c.id === 'shared-contact')!.sharedWithMe).toBe(true)
    })

    it('filters by company, jobTitle, createdAt range and tags', async () => {
      prisma.contact.findMany.mockResolvedValue([])
      prisma.contact.count.mockResolvedValue(0)

      await service.findMany(TENANT_ID, USER_ID, {
        company: 'Acme',
        jobTitle: 'CTO',
        createdAtFrom: '2026-08-01T00:00:00.000Z',
        createdAtTo: '2026-08-05T00:00:00.000Z',
        tags: ['vip', ''],
      })

      const where = prisma.contact.findMany.mock.calls[0][0].where
      expect(where.AND).toContainEqual({ company: { contains: 'Acme', mode: 'insensitive' } })
      expect(where.AND).toContainEqual({ jobTitle: { contains: 'CTO', mode: 'insensitive' } })
      expect(where.AND).toContainEqual(
        expect.objectContaining({
          createdAt: expect.objectContaining({
            gte: expect.any(Date),
            lte: expect.any(Date),
          }),
        }),
      )
      expect(where.AND).toContainEqual({
        AND: [{ tags: { some: { tag: { name: 'vip' } } } }],
      })
    })

    it('filters by search across email, names and company', async () => {
      prisma.contact.findMany.mockResolvedValue([])
      prisma.contact.count.mockResolvedValue(0)

      await service.findMany(TENANT_ID, USER_ID, { search: 'acme' })

      const where = prisma.contact.findMany.mock.calls[0][0].where
      expect(where.AND).toContainEqual(
        expect.objectContaining({
          OR: expect.arrayContaining([
            { email: { contains: 'acme', mode: 'insensitive' } },
            { firstName: { contains: 'acme', mode: 'insensitive' } },
            { lastName: { contains: 'acme', mode: 'insensitive' } },
            { company: { contains: 'acme', mode: 'insensitive' } },
          ]),
        }),
      )
    })
  })

  describe('getStats()', () => {
    it('returns the four workspace counters scoped to the tenant', async () => {
      prisma.contact.count
        .mockResolvedValueOnce(237)
        .mockResolvedValueOnce(18)
        .mockResolvedValueOnce(64)
        .mockResolvedValueOnce(9)

      const result = await service.getStats(TENANT_ID, USER_ID)

      expect(result).toEqual({
        total: 237,
        addedThisMonth: 18,
        withOpenDeals: 64,
        unassigned: 9,
      })
      expect(prisma.contact.count).toHaveBeenCalledTimes(4)
      for (const call of prisma.contact.count.mock.calls) {
        expect(call[0].where).toEqual(
          expect.objectContaining({ tenantId: TENANT_ID, deletedAt: null }),
        )
      }
    })

    it('counts additions from the first day of the current month', async () => {
      prisma.contact.count.mockResolvedValue(0)

      await service.getStats(TENANT_ID, USER_ID)

      const createdAtFilter = prisma.contact.count.mock.calls[1][0].where.createdAt as {
        gte: Date
      }
      expect(createdAtFilter.gte.getDate()).toBe(1)
      expect(createdAtFilter.gte.getHours()).toBe(0)
      expect(createdAtFilter.gte.getMonth()).toBe(new Date().getMonth())
    })

    it('counts open deals as those in neither a won nor a lost stage', async () => {
      prisma.contact.count.mockResolvedValue(0)

      await service.getStats(TENANT_ID, USER_ID)

      expect(prisma.contact.count.mock.calls[2][0].where.deals).toEqual({
        some: { deletedAt: null, stage: { isWon: false, isLost: false } },
      })
    })

    it('counts contacts owned by the system sentinel or an inactive user as unassigned', async () => {
      prisma.contact.count.mockResolvedValue(0)

      await service.getStats(TENANT_ID, USER_ID)

      expect(prisma.contact.count.mock.calls[3][0].where.OR).toEqual([
        { ownerId: 'system' },
        { owner: { OR: [{ deletedAt: { not: null } }, { isActive: false }] } },
      ])
    })

    it('restricts every counter to owned and shared records when visibility is limited', async () => {
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(USER_ID)
      ;(resolveSharedRecordIds as jest.Mock).mockResolvedValue(['shared-1'])
      prisma.contact.count.mockResolvedValue(0)

      await service.getStats(TENANT_ID, USER_ID)

      for (const call of prisma.contact.count.mock.calls) {
        expect(call[0].where.AND).toEqual([
          { OR: [{ ownerId: USER_ID }, { id: { in: ['shared-1'] } }] },
        ])
      }
    })
  })

  describe('update()', () => {
    it('updates only active contacts in the authenticated tenant', async () => {
      const updated = makeContact({ company: 'Acme' })
      // findOne (visibility check)
      prisma.contact.findFirst.mockResolvedValue(makeContact())
      prisma.contact.updateMany.mockResolvedValue({ count: 1 })
      prisma.contact.findFirst.mockResolvedValue(updated)

      const result = await service.update(TENANT_ID, USER_ID, CONTACT_ID, { company: 'Acme' })

      expect(result).toBe(updated)
      expect(prisma.contact.updateMany).toHaveBeenCalledWith({
        where: { id: CONTACT_ID, tenantId: TENANT_ID, deletedAt: null },
        data: { company: 'Acme', updatedBy: USER_ID },
      })
    })

    it('throws NotFoundException when updateMany affects zero rows', async () => {
      prisma.contact.findFirst.mockResolvedValue(makeContact()) // visibility check passes
      prisma.contact.updateMany.mockResolvedValue({ count: 0 })

      await expect(
        service.update(TENANT_ID, USER_ID, CONTACT_ID, { company: 'Acme' }),
      ).rejects.toThrow(NotFoundException)
    })

    it('allows update when user has EDIT sharing access', async () => {
      const updated = makeContact({ ownerId: 'other-user' })
      prisma.contact.findFirst.mockResolvedValue(makeContact({ ownerId: 'other-user' }))
      prisma.userRole.findMany.mockResolvedValue([]) // not ADMIN
      prisma.sharingRule.findFirst.mockResolvedValue({ accessLevel: 'EDIT' })
      prisma.contact.updateMany.mockResolvedValue({ count: 1 })
      prisma.contact.findFirst.mockResolvedValue(updated)

      const result = await service.update(TENANT_ID, USER_ID, CONTACT_ID, { company: 'Acme' })
      expect(result).toBe(updated)
    })

    it('allows update when user has FULL sharing access', async () => {
      const updated = makeContact({ ownerId: 'other-user' })
      prisma.contact.findFirst.mockResolvedValue(makeContact({ ownerId: 'other-user' }))
      prisma.userRole.findMany.mockResolvedValue([]) // not ADMIN
      prisma.sharingRule.findFirst.mockResolvedValue({ accessLevel: 'FULL' })
      prisma.contact.updateMany.mockResolvedValue({ count: 1 })
      prisma.contact.findFirst.mockResolvedValue(updated)

      const result = await service.update(TENANT_ID, USER_ID, CONTACT_ID, { company: 'Acme' })
      expect(result).toBe(updated)
    })

    it('throws ForbiddenException when user has READ sharing access and tries to update', async () => {
      prisma.contact.findFirst.mockResolvedValue(makeContact({ ownerId: 'other-user' }))
      prisma.userRole.findMany.mockResolvedValue([]) // not ADMIN
      prisma.sharingRule.findFirst.mockResolvedValue({ accessLevel: 'READ' })

      await expect(
        service.update(TENANT_ID, USER_ID, CONTACT_ID, { company: 'Acme' }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('auto-logs CONTACT_UPDATED when meaningful fields change (UT-B-27)', async () => {
      const oldContact = makeContact({ company: null, phone: null })
      const newContact = makeContact({ company: 'Acme Corp', phone: '555-0100' })
      prisma.contact.findFirst.mockResolvedValueOnce(oldContact)
      prisma.contact.updateMany.mockResolvedValue({ count: 1 })
      prisma.contact.findFirst.mockResolvedValueOnce(newContact)
      ;(activityService.detectChangedFields as jest.Mock).mockReturnValue(['company', 'phone'])
      ;(activityService.logSafe as jest.Mock).mockResolvedValue(newContact)

      const result = await service.update(TENANT_ID, USER_ID, CONTACT_ID, {
        company: 'Acme Corp',
        phone: '555-0100',
      })

      expect(result).toBe(newContact)
      expect(activityService.logSafe).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        contactId: CONTACT_ID,
        type: 'CONTACT_UPDATED',
        title: 'Contact updated',
        description: 'Updated fields: company, phone',
        createdBy: USER_ID,
      })
    })

    it('does NOT auto-log when no meaningful fields change (UT-B-28)', async () => {
      const contact = makeContact()
      prisma.contact.findFirst.mockResolvedValueOnce(contact)
      prisma.contact.updateMany.mockResolvedValue({ count: 1 })
      // Returning the same contact so detectChangedFields returns []
      prisma.contact.findFirst.mockResolvedValueOnce(contact)
      ;(activityService.detectChangedFields as jest.Mock).mockReturnValue([])

      await service.update(TENANT_ID, USER_ID, CONTACT_ID, { company: 'Acme Corp' })

      expect(activityService.logSafe).not.toHaveBeenCalled()
    })
  })

  describe('delete()', () => {
    it('soft deletes only active contacts in the authenticated tenant', async () => {
      // findOne (visibility check)
      prisma.contact.findFirst.mockResolvedValue(makeContact())
      prisma.contact.updateMany.mockResolvedValue({ count: 1 })

      await expect(service.delete(TENANT_ID, USER_ID, CONTACT_ID)).resolves.toBe(true)
      expect(prisma.contact.updateMany).toHaveBeenCalledWith({
        where: { id: CONTACT_ID, tenantId: TENANT_ID, deletedAt: null },
        data: { deletedAt: expect.any(Date) as Date, updatedBy: USER_ID },
      })
    })

    it('throws NotFoundException when no visible contact is found', async () => {
      prisma.contact.findFirst.mockResolvedValue(null)

      await expect(service.delete(TENANT_ID, USER_ID, CONTACT_ID)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('throws NotFoundException when updateMany affects zero rows on delete', async () => {
      prisma.contact.findFirst.mockResolvedValue(makeContact()) // visibility check passes
      prisma.contact.updateMany.mockResolvedValue({ count: 0 })

      await expect(service.delete(TENANT_ID, USER_ID, CONTACT_ID)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('allows delete when user has FULL sharing access', async () => {
      prisma.contact.findFirst.mockResolvedValue(makeContact({ ownerId: 'other-user' }))
      prisma.userRole.findMany.mockResolvedValue([]) // not ADMIN
      prisma.sharingRule.findFirst.mockResolvedValue({ accessLevel: 'FULL' })
      prisma.contact.updateMany.mockResolvedValue({ count: 1 })

      await expect(service.delete(TENANT_ID, USER_ID, CONTACT_ID)).resolves.toBe(true)
    })

    it('throws ForbiddenException when user has EDIT sharing access and tries to delete', async () => {
      prisma.contact.findFirst.mockResolvedValue(makeContact({ ownerId: 'other-user' }))
      prisma.userRole.findMany.mockResolvedValue([]) // not ADMIN
      prisma.sharingRule.findFirst.mockResolvedValue({ accessLevel: 'EDIT' })

      await expect(service.delete(TENANT_ID, USER_ID, CONTACT_ID)).rejects.toThrow(
        ForbiddenException,
      )
    })

    it('throws ForbiddenException when user has READ sharing access and tries to delete', async () => {
      prisma.contact.findFirst.mockResolvedValue(makeContact({ ownerId: 'other-user' }))
      prisma.userRole.findMany.mockResolvedValue([]) // not ADMIN
      prisma.sharingRule.findFirst.mockResolvedValue({ accessLevel: 'READ' })

      await expect(service.delete(TENANT_ID, USER_ID, CONTACT_ID)).rejects.toThrow(
        ForbiddenException,
      )
    })
  })

  it('uses default pagination bounds', async () => {
    prisma.contact.findMany.mockResolvedValue([])
    prisma.contact.count.mockResolvedValue(0)

    const result = await service.findMany(TENANT_ID, USER_ID)

    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 20 })
  })

  it('caps pagination bounds', async () => {
    prisma.contact.findMany.mockResolvedValue([])
    prisma.contact.count.mockResolvedValue(0)

    const result = await service.findMany(TENANT_ID, USER_ID, {}, { page: 0, pageSize: 500 })

    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 100 })
  })

  it('rethrows unknown create errors', async () => {
    prisma.contact.create.mockRejectedValue(new Error('database unavailable'))

    await expect(
      service.create(TENANT_ID, USER_ID, {
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
      }),
    ).rejects.toThrow('database unavailable')
  })

  it('converts duplicate email errors on update', async () => {
    prisma.contact.findFirst.mockResolvedValue(makeContact())
    prisma.contact.updateMany.mockRejectedValue(
      new PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
      }),
    )

    await expect(
      service.update(TENANT_ID, USER_ID, CONTACT_ID, { email: 'ada@example.com' }),
    ).rejects.toThrow(ConflictException)
  })

  it('throws NotFoundException when update finds no active tenant contact', async () => {
    prisma.contact.findFirst.mockResolvedValue(null)

    await expect(
      service.update(TENANT_ID, USER_ID, CONTACT_ID, { company: 'Acme' }),
    ).rejects.toThrow(NotFoundException)
  })

  it('rethrows unknown update errors', async () => {
    prisma.contact.findFirst.mockResolvedValue(makeContact())
    prisma.contact.updateMany.mockRejectedValue(new Error('database unavailable'))

    await expect(
      service.update(TENANT_ID, USER_ID, CONTACT_ID, { company: 'Acme' }),
    ).rejects.toThrow('database unavailable')
  })
})

describe('ContactsService — Ownership', () => {
  let service: ContactsService
  let prisma: MockPrisma
  let activityService: MockActivityService

  const NEW_OWNER_ID = 'new-owner-1'
  const TEAM_ID = 'team-1'

  const makeOwnedContact = (overrides: Partial<Contact> = {}): Contact => makeContact(overrides)

  const makeUser = (
    id: string,
    overrides: Partial<Record<string, unknown>> = {},
  ): Record<string, unknown> => ({
    id,
    tenantId: TENANT_ID,
    email: `${id}@example.com`,
    firstName: overrides.firstName ?? 'Test',
    lastName: overrides.lastName ?? 'User',
    ...overrides,
  })

  const makeTeam = (id: string): Record<string, unknown> => ({
    id,
    tenantId: TENANT_ID,
    name: 'Test Team',
    createdAt: NOW,
    updatedAt: NOW,
  })

  beforeEach(() => {
    prisma = makePrisma()
    activityService = makeActivityService()
    ;(activityService.detectChangedFields as jest.Mock).mockReturnValue([])
    service = new ContactsService(
      prisma as unknown as ConstructorParameters<typeof ContactsService>[0],
      activityService as unknown as ConstructorParameters<typeof ContactsService>[1],
    )
    ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(undefined)
    ;(resolveSharedRecordIds as jest.Mock).mockResolvedValue([])
  })

  describe('assignOwner()', () => {
    // UT-O-01: Updates contact ownerId to new userId
    it('updates contact ownerId to new userId (UT-O-01)', async () => {
      const contact = makeOwnedContact({ ownerId: USER_ID })
      const newOwner = makeUser(NEW_OWNER_ID, { firstName: 'Jane', lastName: 'Smith' })
      const updatedContact = makeOwnedContact({ ownerId: NEW_OWNER_ID })

      prisma.contact.findFirst.mockResolvedValueOnce(contact)
      prisma.user.findFirst.mockResolvedValueOnce(newOwner)
      prisma.contact.update.mockResolvedValue(updatedContact)
      ;(activityService.logSafe as jest.Mock).mockResolvedValue(updatedContact)

      const result = await service.assignOwner(TENANT_ID, USER_ID, CONTACT_ID, NEW_OWNER_ID)

      expect(result).toBe(updatedContact)
      expect(prisma.contact.update).toHaveBeenCalledWith({
        where: { id: CONTACT_ID, tenantId: TENANT_ID, deletedAt: null },
        data: { ownerId: NEW_OWNER_ID, updatedBy: USER_ID },
        include: {
          owner: {
            select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
          },
        },
      })
    })

    // UT-O-02: Validates contact exists in tenant
    it('throws NotFoundException when contact not found in tenant (UT-O-02)', async () => {
      prisma.contact.findFirst.mockResolvedValue(null)

      await expect(
        service.assignOwner(TENANT_ID, USER_ID, CONTACT_ID, NEW_OWNER_ID),
      ).rejects.toThrow(NotFoundException)
    })

    // UT-O-03: Validates target user exists in same tenant
    it('throws NotFoundException when target user not found (UT-O-03)', async () => {
      const contact = makeOwnedContact()
      prisma.contact.findFirst.mockResolvedValue(contact)
      prisma.user.findFirst.mockResolvedValue(null)

      await expect(
        service.assignOwner(TENANT_ID, USER_ID, CONTACT_ID, NEW_OWNER_ID),
      ).rejects.toThrow(NotFoundException)
    })

    // UT-O-04: Cross-tenant target user → NotFoundException
    it('throws NotFoundException for cross-tenant target user (UT-O-04)', async () => {
      const contact = makeOwnedContact()
      prisma.contact.findFirst.mockResolvedValue(contact)
      // User exists but in different tenant
      prisma.user.findFirst.mockResolvedValue(null)

      await expect(
        service.assignOwner(TENANT_ID, USER_ID, CONTACT_ID, NEW_OWNER_ID),
      ).rejects.toThrow(NotFoundException)
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: NEW_OWNER_ID, tenantId: TENANT_ID, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, email: true },
      })
    })

    // UT-O-05: Contact not found → NotFoundException
    it('throws NotFoundException for non-existent contact (UT-O-05)', async () => {
      prisma.contact.findFirst.mockResolvedValue(null)

      await expect(
        service.assignOwner(TENANT_ID, USER_ID, 'nonexistent', NEW_OWNER_ID),
      ).rejects.toThrow(NotFoundException)
    })

    // UT-O-06: Logs CONTACT_OWNER_CHANGED activity after success
    it('logs CONTACT_OWNER_CHANGED activity after successful update (UT-O-06)', async () => {
      const contact = makeOwnedContact({ ownerId: USER_ID })
      // Include owner relation in findFirst
      const contactWithOwner = {
        ...contact,
        owner: { id: USER_ID, firstName: 'Current', lastName: 'Owner' },
      }
      const newOwner = makeUser(NEW_OWNER_ID, { firstName: 'Jane', lastName: 'Smith' })
      const updatedContact = makeOwnedContact({ ownerId: NEW_OWNER_ID })

      prisma.contact.findFirst.mockResolvedValueOnce(contactWithOwner)
      prisma.user.findFirst.mockResolvedValueOnce(newOwner)
      prisma.contact.update.mockResolvedValue(updatedContact)
      ;(activityService.logSafe as jest.Mock).mockResolvedValue(updatedContact)

      await service.assignOwner(TENANT_ID, USER_ID, CONTACT_ID, NEW_OWNER_ID)

      expect(activityService.logSafe).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        contactId: CONTACT_ID,
        type: 'CONTACT_OWNER_CHANGED',
        title: 'Contact owner changed',
        description: 'Owner changed from Current Owner → Jane Smith',
        createdBy: USER_ID,
      })
    })

    // UT-O-07: Activity description includes from → to owner names
    it('activity description includes from → to owner names (UT-O-07)', async () => {
      const contact = makeOwnedContact({ ownerId: USER_ID })
      const contactWithOwner = {
        ...contact,
        owner: { id: USER_ID, firstName: 'Alice', lastName: 'Smith' },
      }
      const newOwner = makeUser(NEW_OWNER_ID, { firstName: 'Jane', lastName: 'Smith' })
      const updatedContact = makeOwnedContact({ ownerId: NEW_OWNER_ID })

      prisma.contact.findFirst.mockResolvedValueOnce(contactWithOwner)
      prisma.user.findFirst.mockResolvedValueOnce(newOwner)
      prisma.contact.update.mockResolvedValue(updatedContact)
      ;(activityService.logSafe as jest.Mock).mockResolvedValue(updatedContact)

      await service.assignOwner(TENANT_ID, USER_ID, CONTACT_ID, NEW_OWNER_ID)

      expect(activityService.logSafe).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Owner changed from Alice Smith → Jane Smith',
        }),
      )
    })

    // UT-O-08: Activity logging failure does not block ownership change
    it('activity logging failure does not block ownership change (UT-O-08)', async () => {
      const contact = makeOwnedContact()
      const contactWithOwner = {
        ...contact,
        owner: { id: USER_ID, firstName: 'Current', lastName: 'Owner' },
      }
      const newOwner = makeUser(NEW_OWNER_ID, { firstName: 'Jane', lastName: 'Smith' })
      const updatedContact = makeOwnedContact({ ownerId: NEW_OWNER_ID })

      prisma.contact.findFirst.mockResolvedValueOnce(contactWithOwner)
      prisma.user.findFirst.mockResolvedValueOnce(newOwner)
      prisma.contact.update.mockResolvedValue(updatedContact)
      // logSafe returns null on failure — does not throw
      ;(activityService.logSafe as jest.Mock).mockResolvedValue(null)

      const result = await service.assignOwner(TENANT_ID, USER_ID, CONTACT_ID, NEW_OWNER_ID)

      expect(result).toBe(updatedContact)
      expect(prisma.contact.update).toHaveBeenCalled()
    })

    // UT-O-09: Returns updated Contact
    it('returns the updated contact (UT-O-09)', async () => {
      const contact = makeOwnedContact({ ownerId: USER_ID })
      const contactWithOwner = {
        ...contact,
        owner: { id: USER_ID, firstName: 'Current', lastName: 'Owner' },
      }
      const newOwner = makeUser(NEW_OWNER_ID, { firstName: 'Jane', lastName: 'Smith' })
      const updatedContact = makeOwnedContact({ ownerId: NEW_OWNER_ID })

      prisma.contact.findFirst.mockResolvedValueOnce(contactWithOwner)
      prisma.user.findFirst.mockResolvedValueOnce(newOwner)
      prisma.contact.update.mockResolvedValue(updatedContact)

      const result = await service.assignOwner(TENANT_ID, USER_ID, CONTACT_ID, NEW_OWNER_ID)

      expect(result.ownerId).toBe(NEW_OWNER_ID)
    })
  })

  describe('assignTeam()', () => {
    // UT-T-01: Sets teamId to valid team in same tenant
    it('sets teamId to valid team in same tenant (UT-T-01)', async () => {
      const contact = makeOwnedContact()
      const updatedContact = makeOwnedContact({ teamId: TEAM_ID })

      prisma.contact.findFirst.mockResolvedValueOnce(contact)
      prisma.team.findFirst.mockResolvedValueOnce(makeTeam(TEAM_ID))
      prisma.contact.update.mockResolvedValue(updatedContact)

      const result = await service.assignTeam(TENANT_ID, USER_ID, CONTACT_ID, TEAM_ID)

      expect(result).toBe(updatedContact)
      expect(prisma.contact.update).toHaveBeenCalledWith({
        where: { id: CONTACT_ID, tenantId: TENANT_ID, deletedAt: null },
        data: { teamId: TEAM_ID, updatedBy: USER_ID },
        include: {
          owner: {
            select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
          },
        },
      })
    })

    // UT-T-02: Sets teamId to null (removes team assignment)
    it('sets teamId to null to remove team assignment (UT-T-02)', async () => {
      const contact = makeOwnedContact({ teamId: TEAM_ID })
      const updatedContact = makeOwnedContact({ teamId: null })

      prisma.contact.findFirst.mockResolvedValueOnce(contact)
      prisma.contact.update.mockResolvedValue(updatedContact)

      const result = await service.assignTeam(TENANT_ID, USER_ID, CONTACT_ID, null)

      expect(result).toBe(updatedContact)
      expect(prisma.contact.update).toHaveBeenCalledWith({
        where: { id: CONTACT_ID, tenantId: TENANT_ID, deletedAt: null },
        data: { teamId: null, updatedBy: USER_ID },
        include: {
          owner: {
            select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
          },
        },
      })
    })

    // UT-T-03: Invalid teamId → NotFoundException
    it('throws NotFoundException for invalid teamId (UT-T-03)', async () => {
      const contact = makeOwnedContact()
      prisma.contact.findFirst.mockResolvedValueOnce(contact)
      prisma.team.findFirst.mockResolvedValue(null)

      await expect(
        service.assignTeam(TENANT_ID, USER_ID, CONTACT_ID, 'nonexistent-team'),
      ).rejects.toThrow(NotFoundException)
    })

    // UT-T-04: Cross-tenant team → NotFoundException
    it('throws NotFoundException for cross-tenant team (UT-T-04)', async () => {
      const contact = makeOwnedContact()
      prisma.contact.findFirst.mockResolvedValueOnce(contact)
      prisma.team.findFirst.mockResolvedValue(null)

      await expect(
        service.assignTeam(TENANT_ID, USER_ID, CONTACT_ID, 'other-tenant-team'),
      ).rejects.toThrow(NotFoundException)
      expect(prisma.team.findFirst).toHaveBeenCalledWith({
        where: { id: 'other-tenant-team', tenantId: TENANT_ID, deletedAt: null },
      })
    })

    // UT-T-05: Non-existent contact → NotFoundException
    it('throws NotFoundException for non-existent contact (UT-T-05)', async () => {
      prisma.contact.findFirst.mockResolvedValue(null)

      await expect(service.assignTeam(TENANT_ID, USER_ID, 'nonexistent', TEAM_ID)).rejects.toThrow(
        NotFoundException,
      )
    })

    // UT-T-06: Returns updated Contact
    it('returns updated contact with teamId (UT-T-06)', async () => {
      const contact = makeOwnedContact()
      const updatedContact = makeOwnedContact({ teamId: TEAM_ID })

      prisma.contact.findFirst.mockResolvedValueOnce(contact)
      prisma.team.findFirst.mockResolvedValueOnce(makeTeam(TEAM_ID))
      prisma.contact.update.mockResolvedValue(updatedContact)

      const result = await service.assignTeam(TENANT_ID, USER_ID, CONTACT_ID, TEAM_ID)

      expect(result.teamId).toBe(TEAM_ID)
    })
  })

  describe('assignOwnerBulk()', () => {
    const CONTACT_IDS = ['contact-1', 'contact-2', 'contact-3']

    // UT-B-01: All contacts updated successfully
    it('returns all success when all contacts are valid (UT-B-01)', async () => {
      const newOwner = makeUser(NEW_OWNER_ID, { firstName: 'Jane', lastName: 'Smith' })
      prisma.user.findFirst.mockResolvedValue(newOwner)

      // Each contact succeeds
      for (const cId of CONTACT_IDS) {
        const c = makeOwnedContact({ id: cId, ownerId: USER_ID })
        const cWithOwner = { ...c, owner: { id: USER_ID, firstName: 'Current', lastName: 'O' } }
        prisma.contact.findFirst.mockResolvedValueOnce(cWithOwner)
        prisma.contact.update.mockResolvedValue(
          makeOwnedContact({ id: cId, ownerId: NEW_OWNER_ID }),
        )
        prisma.user.findUnique.mockResolvedValue({ firstName: 'Jane', lastName: 'Smith' })
      }
      ;(activityService.logSafe as jest.Mock).mockResolvedValue(null)

      const result = await service.assignOwnerBulk(TENANT_ID, USER_ID, CONTACT_IDS, NEW_OWNER_ID)

      expect(result.successCount).toBe(3)
      expect(result.failedCount).toBe(0)
      expect(result.errors).toHaveLength(0)
    })

    // UT-B-02: Partial failure — one contact invalid
    it('handles partial failure — one invalid contact (UT-B-02)', async () => {
      const newOwner = makeUser(NEW_OWNER_ID, { firstName: 'Jane', lastName: 'Smith' })
      prisma.user.findFirst.mockResolvedValue(newOwner)

      // First contact fails (not found)
      prisma.contact.findFirst.mockResolvedValueOnce(null)

      // Second contact succeeds
      const c2 = makeOwnedContact({ id: 'contact-2', ownerId: USER_ID })
      const c2WithOwner = { ...c2, owner: { id: USER_ID, firstName: 'Current', lastName: 'O' } }
      prisma.contact.findFirst.mockResolvedValueOnce(c2WithOwner)
      prisma.contact.update.mockResolvedValue(
        makeOwnedContact({ id: 'contact-2', ownerId: NEW_OWNER_ID }),
      )

      // Third contact succeeds
      const c3 = makeOwnedContact({ id: 'contact-3', ownerId: USER_ID })
      const c3WithOwner = { ...c3, owner: { id: USER_ID, firstName: 'Current', lastName: 'O' } }
      prisma.contact.findFirst.mockResolvedValueOnce(c3WithOwner)
      prisma.contact.update.mockResolvedValue(
        makeOwnedContact({ id: 'contact-3', ownerId: NEW_OWNER_ID }),
      )
      prisma.user.findUnique.mockResolvedValue({ firstName: 'Jane', lastName: 'Smith' })
      ;(activityService.logSafe as jest.Mock).mockResolvedValue(null)

      const result = await service.assignOwnerBulk(TENANT_ID, USER_ID, CONTACT_IDS, NEW_OWNER_ID)

      expect(result.successCount).toBe(2)
      expect(result.failedCount).toBe(1)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]!.contactId).toBe('contact-1')
    })

    // UT-B-03: All contacts invalid
    it('returns all failures when all contacts are invalid (UT-B-03)', async () => {
      const newOwner = makeUser(NEW_OWNER_ID, { firstName: 'Jane', lastName: 'Smith' })
      prisma.user.findFirst.mockResolvedValue(newOwner)

      for (let idx = 0; idx < CONTACT_IDS.length; idx++) {
        prisma.contact.findFirst.mockResolvedValueOnce(null)
      }

      const result = await service.assignOwnerBulk(TENANT_ID, USER_ID, CONTACT_IDS, NEW_OWNER_ID)

      expect(result.successCount).toBe(0)
      expect(result.failedCount).toBe(3)
      expect(result.errors).toHaveLength(3)
    })

    // UT-B-04: Returns correct BulkAssignResult shape
    it('returns correct BulkAssignResult shape (UT-B-04)', async () => {
      const newOwner = makeUser(NEW_OWNER_ID, { firstName: 'Jane', lastName: 'Smith' })
      prisma.user.findFirst.mockResolvedValue(newOwner)
      prisma.contact.findFirst.mockResolvedValueOnce(null)

      const result = await service.assignOwnerBulk(TENANT_ID, USER_ID, ['contact-1'], NEW_OWNER_ID)

      expect(result).toMatchObject({
        successCount: expect.any(Number),
        failedCount: expect.any(Number),
        errors: expect.any(Array),
      })
    })

    // UT-B-05: Activity logged for each successfully updated contact
    it('logs activity for each successfully updated contact (UT-B-05)', async () => {
      const newOwner = makeUser(NEW_OWNER_ID, { firstName: 'Jane', lastName: 'Smith' })
      prisma.user.findFirst.mockResolvedValue(newOwner)

      for (let i = 0; i < 2; i++) {
        const c = makeOwnedContact({ id: `contact-${i + 1}`, ownerId: USER_ID })
        const cWithOwner = { ...c, owner: { id: USER_ID, firstName: 'Current', lastName: 'O' } }
        prisma.contact.findFirst.mockResolvedValueOnce(cWithOwner)
        prisma.contact.update.mockResolvedValue(
          makeOwnedContact({ id: `contact-${i + 1}`, ownerId: NEW_OWNER_ID }),
        )
        prisma.user.findUnique.mockResolvedValue({ firstName: 'Jane', lastName: 'Smith' })
      }
      ;(activityService.logSafe as jest.Mock).mockResolvedValue(null)

      await service.assignOwnerBulk(TENANT_ID, USER_ID, ['contact-1', 'contact-2'], NEW_OWNER_ID)

      expect(activityService.logSafe).toHaveBeenCalledTimes(2)
    })

    // UT-B-06: Permission checked once before loop (tested via resolver, not service)
    // This is enforced in the GraphQL resolver with requirePermission

    // UT-B-07: User validation done once upfront
    it('validates user once upfront, not per contact (UT-B-07)', async () => {
      const newOwner = makeUser(NEW_OWNER_ID, { firstName: 'Jane', lastName: 'Smith' })
      prisma.user.findFirst.mockResolvedValue(newOwner)

      // Both contacts succeed
      for (let i = 0; i < 2; i++) {
        const c = makeOwnedContact({ id: `contact-${i + 1}`, ownerId: USER_ID })
        const cWithOwner = { ...c, owner: { id: USER_ID, firstName: 'Current', lastName: 'O' } }
        prisma.contact.findFirst.mockResolvedValueOnce(cWithOwner)
        prisma.contact.update.mockResolvedValue(
          makeOwnedContact({ id: `contact-${i + 1}`, ownerId: NEW_OWNER_ID }),
        )
      }
      ;(activityService.logSafe as jest.Mock).mockResolvedValue(null)

      await service.assignOwnerBulk(TENANT_ID, USER_ID, ['contact-1', 'contact-2'], NEW_OWNER_ID)

      // Called 1 time upfront in assignOwnerBulk (assignOwnerUnsafe skips per-contact user validation)
      expect(prisma.user.findFirst).toHaveBeenCalledTimes(1)
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(2)
    })

    // UT-B-08: Processed sequentially
    it('processes contacts in sequence (UT-B-08)', async () => {
      const newOwner = makeUser(NEW_OWNER_ID, { firstName: 'Jane', lastName: 'Smith' })
      prisma.user.findFirst.mockResolvedValue(newOwner)

      const c1 = makeOwnedContact({ id: 'contact-1', ownerId: USER_ID })
      const c1WithOwner = { ...c1, owner: { id: USER_ID, firstName: 'Current', lastName: 'O' } }
      prisma.contact.findFirst.mockResolvedValueOnce(c1WithOwner)
      prisma.contact.update.mockResolvedValueOnce(
        makeOwnedContact({ id: 'contact-1', ownerId: NEW_OWNER_ID }),
      )

      const c2 = makeOwnedContact({ id: 'contact-2', ownerId: USER_ID })
      const c2WithOwner = { ...c2, owner: { id: USER_ID, firstName: 'Current', lastName: 'O' } }
      prisma.contact.findFirst.mockResolvedValueOnce(c2WithOwner)
      prisma.contact.update.mockResolvedValueOnce(
        makeOwnedContact({ id: 'contact-2', ownerId: NEW_OWNER_ID }),
      )
      prisma.user.findUnique.mockResolvedValue({ firstName: 'Jane', lastName: 'Smith' })
      ;(activityService.logSafe as jest.Mock).mockResolvedValue(null)

      const result = await service.assignOwnerBulk(
        TENANT_ID,
        USER_ID,
        ['contact-1', 'contact-2'],
        NEW_OWNER_ID,
      )

      expect(result.successCount).toBe(2)
      // Verify first call was for contact-1 then contact-2
      expect(prisma.contact.findFirst).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: expect.objectContaining({ id: 'contact-1' }),
        }),
      )
      expect(prisma.contact.findFirst).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({ id: 'contact-2' }),
        }),
      )
    })
  })
})
