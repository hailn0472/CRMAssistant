import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

import { ContactsService } from './contacts.service'
import type { Contact } from '@prisma/client'

jest.mock('../common/guards/visibility-check', () => ({
  resolveVisibilityFilter: jest.fn(),
  registerVisibilityService: jest.fn(),
}))

import { resolveVisibilityFilter } from '../common/guards/visibility-check'

type MockContactDelegate = {
  create: jest.Mock
  findFirst: jest.Mock
  findMany: jest.Mock
  count: jest.Mock
  updateMany: jest.Mock
}

type MockPrisma = {
  contact: MockContactDelegate
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
    ownerId: USER_ID,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: USER_ID,
    updatedBy: USER_ID,
    deletedAt: null,
    ...overrides,
  }
}

function makePrisma(): MockPrisma {
  return {
    contact: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
  }
}

describe('ContactsService', () => {
  let service: ContactsService
  let prisma: MockPrisma

  beforeEach(() => {
    prisma = makePrisma()
    service = new ContactsService(
      prisma as unknown as ConstructorParameters<typeof ContactsService>[0],
    )
    ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(undefined)
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
  })

  describe('findOne()', () => {
    it('returns active contact scoped to tenant and visible to user', async () => {
      const contact = makeContact()
      prisma.contact.findFirst.mockResolvedValue(contact)
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(undefined)

      await expect(service.findOne(TENANT_ID, USER_ID, CONTACT_ID)).resolves.toBe(contact)
      expect(prisma.contact.findFirst).toHaveBeenCalledWith({
        where: { id: CONTACT_ID, tenantId: TENANT_ID, deletedAt: null },
        include: { owner: { select: { id: true, firstName: true, lastName: true, email: true } } },
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

      expect(result).toEqual({ items: [contact], total: 1, page: 2, pageSize: 10 })
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
          ownerId: true,
          owner: { select: { id: true, firstName: true, lastName: true, email: true } },
          createdAt: true,
          updatedAt: true,
        },
      })
      expect(prisma.contact.count).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, deletedAt: null },
      })
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
