import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'

import { NotesService, NOTE_SELECT } from '../notes.service'

interface MockPrismaNote {
  create: jest.Mock
  findFirst: jest.Mock
  findMany: jest.Mock
  count: jest.Mock
  updateMany: jest.Mock
}

interface MockAuditService {
  log: jest.Mock
}

interface MockDealsService {
  findOne: jest.Mock
}

interface MockActivityService {
  checkContactAccess: jest.Mock
  logSafe: jest.Mock
}

interface MockServiceBundle {
  prisma: { note: MockPrismaNote }
  audit: MockAuditService
  deals: MockDealsService
  activities: MockActivityService
}

function makeMocks(): MockServiceBundle {
  return {
    prisma: {
      note: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        updateMany: jest.fn(),
      },
    },
    audit: { log: jest.fn().mockResolvedValue(undefined) },
    deals: { findOne: jest.fn() },
    activities: { checkContactAccess: jest.fn(), logSafe: jest.fn() },
  }
}

function makeService(mocks: MockServiceBundle): NotesService {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return new NotesService(
    mocks.prisma as any,
    mocks.audit as any,
    mocks.deals as any,
    mocks.activities as any,
  )
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

const TENANT = 't1'
const USER = 'u1'
const NOW = new Date('2026-08-08T12:00:00Z')
const LATER = new Date('2026-08-08T13:00:00Z')

function noteRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'note-1',
    tenantId: TENANT,
    contactId: 'contact-1',
    dealId: null,
    userId: USER,
    body: 'Hello world',
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: USER,
    updatedBy: USER,
    deletedAt: null,
    author: { id: USER, firstName: 'Test', lastName: 'User' },
    ...overrides,
  }
}

describe('NotesService', () => {
  let mocks: MockServiceBundle
  let service: NotesService

  beforeEach(() => {
    mocks = makeMocks()
    service = makeService(mocks)
  })

  describe('NOTE_SELECT', () => {
    it('includes author with id, firstName, lastName', () => {
      expect(NOTE_SELECT).toHaveProperty('author')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const authorSelect = (NOTE_SELECT as any).author.select
      expect(authorSelect.id).toBe(true)
      expect(authorSelect.firstName).toBe(true)
      expect(authorSelect.lastName).toBe(true)
    })
  })

  describe('create', () => {
    it('creates a note on a contact', async () => {
      const row = noteRow({ contactId: 'contact-1', dealId: null })
      mocks.prisma.note.create.mockResolvedValue(row)

      const result = await service.create(TENANT, USER, {
        contactId: 'contact-1',
        body: 'Hello world',
      })

      expect(mocks.activities.checkContactAccess).toHaveBeenCalledWith(TENANT, USER, 'contact-1')
      expect(mocks.prisma.note.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenant: { connect: { id: TENANT } },
            contact: { connect: { id: 'contact-1' } },
            author: { connect: { id: USER } },
            body: 'Hello world',
            createdBy: USER,
            updatedBy: USER,
          }),
          select: NOTE_SELECT,
        }),
      )
      expect(mocks.activities.logSafe).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'NOTE_ADDED',
          source: 'NOTE',
          sourceId: 'note-1',
          dedupeKey: 'NOTE:note-1',
        }),
      )
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          entity: 'NOTE',
          entityId: 'note-1',
        }),
      )
      expect(result).toEqual(row)
    })

    it('creates a note on a deal', async () => {
      const row = noteRow({ contactId: null, dealId: 'deal-1' })
      mocks.deals.findOne.mockResolvedValue({ id: 'deal-1' })
      mocks.prisma.note.create.mockResolvedValue(row)

      const result = await service.create(TENANT, USER, {
        dealId: 'deal-1',
        body: 'Deal note',
      })

      expect(mocks.deals.findOne).toHaveBeenCalledWith(TENANT, USER, 'deal-1')
      // No Activity marker for deal notes
      expect(mocks.activities.logSafe).not.toHaveBeenCalled()
      expect(result).toEqual(row)
    })

    it('normalizes body before saving', async () => {
      const row = noteRow({ body: 'Hello world' })
      mocks.prisma.note.create.mockResolvedValue(row)

      await service.create(TENANT, USER, {
        contactId: 'contact-1',
        body: '  Hello world  ',
      })

      expect(mocks.prisma.note.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ body: 'Hello world' }),
        }),
      )
    })

    it('throws BadRequestException when neither contactId nor dealId', async () => {
      await expect(
        service.create(TENANT, USER, { body: 'test' } as unknown as Parameters<
          NotesService['create']
        >[2]),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException when both contactId and dealId', async () => {
      await expect(
        service.create(TENANT, USER, {
          contactId: 'c1',
          dealId: 'd1',
          body: 'test',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException for empty body', async () => {
      await expect(
        service.create(TENANT, USER, {
          contactId: 'contact-1',
          body: '',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws NotFoundException when user has no access to contact', async () => {
      mocks.activities.checkContactAccess.mockRejectedValue(
        new NotFoundException('Contact not found'),
      )

      await expect(
        service.create(TENANT, USER, {
          contactId: 'contact-1',
          body: 'test',
        }),
      ).rejects.toThrow(NotFoundException)
    })

    it('throws NotFoundException when user has no access to deal', async () => {
      mocks.deals.findOne.mockRejectedValue(new NotFoundException('Deal not found'))

      await expect(
        service.create(TENANT, USER, {
          dealId: 'deal-1',
          body: 'test',
        }),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('update', () => {
    it('updates own note and re-reads', async () => {
      const row = noteRow()
      const updatedRow = noteRow({ body: 'Updated', updatedAt: LATER })
      mocks.prisma.note.findFirst.mockResolvedValue(row)
      mocks.prisma.note.updateMany.mockResolvedValue({ count: 1 })
      mocks.prisma.note.findFirst
        .mockResolvedValueOnce(row) // first find: load
        .mockResolvedValueOnce(updatedRow) // second find: re-read

      const result = await service.update(TENANT, USER, 'note-1', {
        body: 'Updated',
      })

      expect(mocks.prisma.note.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'note-1', tenantId: TENANT, deletedAt: null },
          data: { body: 'Updated', updatedBy: USER },
        }),
      )
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          entity: 'NOTE',
          entityId: 'note-1',
        }),
      )
      expect(result).toEqual(updatedRow)
    })

    it('throws NotFoundException when note is not found', async () => {
      mocks.prisma.note.findFirst.mockResolvedValue(null)

      await expect(service.update(TENANT, USER, 'note-1', { body: 'test' })).rejects.toThrow(
        NotFoundException,
      )
      expect(mocks.prisma.note.findFirst).toHaveBeenCalledWith({
        where: { id: 'note-1', tenantId: TENANT, deletedAt: null },
        select: NOTE_SELECT,
      })
    })

    it('throws ForbiddenException when non-author tries to edit', async () => {
      const row = noteRow({ userId: 'other-user' })
      mocks.prisma.note.findFirst.mockResolvedValue(row)

      await expect(service.update(TENANT, USER, 'note-1', { body: 'test' })).rejects.toThrow(
        ForbiddenException,
      )
      expect(() => {
        throw new ForbiddenException('You can only edit your own notes')
      }).toThrow(ForbiddenException)
    })

    it('re-derives parent from the loaded row, not client input', async () => {
      const row = noteRow({ contactId: 'contact-1', dealId: null })
      mocks.prisma.note.findFirst.mockResolvedValue(row)
      mocks.prisma.note.updateMany.mockResolvedValue({ count: 1 })
      const updated = noteRow({ body: 'Updated' })
      // reload after update
      mocks.prisma.note.findFirst.mockResolvedValueOnce(row).mockResolvedValueOnce(updated)

      await service.update(TENANT, USER, 'note-1', { body: 'Updated' })

      // Assert parent access was checked with the loaded row's contactId
      expect(mocks.activities.checkContactAccess).toHaveBeenCalledWith(TENANT, USER, 'contact-1')
    })

    it('throws NotFoundException for cross-tenant note', async () => {
      mocks.prisma.note.findFirst.mockResolvedValue(null)

      await expect(
        service.update('wrong-tenant', USER, 'note-1', { body: 'test' }),
      ).rejects.toThrow(NotFoundException)
    })

    it('throws NotFoundException when updateMany count is 0', async () => {
      const row = noteRow()
      mocks.prisma.note.findFirst.mockResolvedValue(row)
      mocks.prisma.note.updateMany.mockResolvedValue({ count: 0 })

      await expect(service.update(TENANT, USER, 'note-1', { body: 'test' })).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('delete', () => {
    it('deletes own note (soft-delete)', async () => {
      const row = noteRow()
      mocks.prisma.note.findFirst.mockResolvedValue(row)
      mocks.prisma.note.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.delete(TENANT, USER, 'note-1', [])

      expect(result).toBe(true)
      expect(mocks.prisma.note.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'note-1', tenantId: TENANT, deletedAt: null },
          data: expect.objectContaining({
            deletedAt: expect.any(Date),
            updatedBy: USER,
          }),
        }),
      )
      expect(mocks.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DELETE',
          entity: 'NOTE',
          entityId: 'note-1',
        }),
      )
    })

    it('allows ADMIN to delete non-own note', async () => {
      const row = noteRow({ userId: 'other-user' })
      mocks.prisma.note.findFirst.mockResolvedValue(row)
      mocks.prisma.note.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.delete(TENANT, USER, 'note-1', ['ADMIN'])

      expect(result).toBe(true)
      expect(mocks.audit.log).toHaveBeenCalled()
    })

    it('throws ForbiddenException when non-author non-ADMIN tries to delete', async () => {
      const row = noteRow({ userId: 'other-user' })
      mocks.prisma.note.findFirst.mockResolvedValue(row)

      await expect(service.delete(TENANT, USER, 'note-1', ['SALES_REP'])).rejects.toThrow(
        ForbiddenException,
      )
    })

    it('throws NotFoundException when note is not found', async () => {
      mocks.prisma.note.findFirst.mockResolvedValue(null)

      await expect(service.delete(TENANT, USER, 'note-1', [])).rejects.toThrow(NotFoundException)
    })

    it('throws NotFoundException when updateMany count is 0', async () => {
      const row = noteRow()
      mocks.prisma.note.findFirst.mockResolvedValue(row)
      mocks.prisma.note.updateMany.mockResolvedValue({ count: 0 })

      await expect(service.delete(TENANT, USER, 'note-1', [])).rejects.toThrow(NotFoundException)
    })

    it('throws NotFoundException for cross-tenant note (same message as soft-deleted)', async () => {
      mocks.prisma.note.findFirst.mockResolvedValue(null)

      await expect(service.delete('wrong-tenant', USER, 'note-1', [])).rejects.toThrow(
        'Note not found',
      )
    })
  })

  describe('findManyForParent', () => {
    it('returns paginated notes for a contact with default pagination', async () => {
      const rows = [noteRow(), noteRow({ id: 'note-2', body: 'Second' })]
      mocks.prisma.note.findMany.mockResolvedValue(rows)
      mocks.prisma.note.count.mockResolvedValue(2)

      const result = await service.findManyForParent(TENANT, USER, {
        contactId: 'contact-1',
      })

      expect(result).toEqual({
        items: rows,
        total: 2,
        page: 1,
        pageSize: 20,
      })
      expect(mocks.prisma.note.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT, contactId: 'contact-1', dealId: null, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          skip: 0,
          take: 20,
          select: NOTE_SELECT,
        }),
      )
    })

    it('returns paginated notes for a deal', async () => {
      mocks.deals.findOne.mockResolvedValue({ id: 'deal-1' })
      mocks.prisma.note.findMany.mockResolvedValue([])
      mocks.prisma.note.count.mockResolvedValue(0)

      const result = await service.findManyForParent(TENANT, USER, {
        dealId: 'deal-1',
      })

      expect(mocks.deals.findOne).toHaveBeenCalledWith(TENANT, USER, 'deal-1')
      expect(result.items).toEqual([])
    })

    it('clamps pageSize to MAX_PAGE_SIZE (100)', async () => {
      mocks.prisma.note.findMany.mockResolvedValue([])
      mocks.prisma.note.count.mockResolvedValue(0)

      await service.findManyForParent(
        TENANT,
        USER,
        { contactId: 'contact-1' },
        { page: 1, pageSize: 200 },
      )

      expect(mocks.prisma.note.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      )
    })

    it('applies pagination offset', async () => {
      mocks.prisma.note.findMany.mockResolvedValue([])
      mocks.prisma.note.count.mockResolvedValue(50)

      await service.findManyForParent(
        TENANT,
        USER,
        { contactId: 'contact-1' },
        { page: 3, pageSize: 10 },
      )

      expect(mocks.prisma.note.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      )
    })

    it('throws NotFoundException for inaccessible contact', async () => {
      mocks.activities.checkContactAccess.mockRejectedValue(
        new NotFoundException('Contact not found'),
      )

      await expect(
        service.findManyForParent(TENANT, USER, { contactId: 'contact-1' }),
      ).rejects.toThrow(NotFoundException)
    })
  })
})
