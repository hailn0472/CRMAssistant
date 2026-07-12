import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

import { TagsService } from './tags.service'
import type { Tag } from '@prisma/client'

type MockTagDelegate = {
  create: jest.Mock
  findFirst: jest.Mock
  findMany: jest.Mock
  delete: jest.Mock
  update: jest.Mock
}

type MockContactDelegate = {
  findFirst: jest.Mock
  updateMany: jest.Mock
}

type MockContactTagDelegate = {
  create: jest.Mock
  delete: jest.Mock
  findMany: jest.Mock
  count: jest.Mock
}

type MockPrisma = {
  tag: MockTagDelegate
  contact: MockContactDelegate
  contactTag: MockContactTagDelegate
  $transaction: jest.Mock
}

const NOW = new Date('2026-07-09T00:00:00.000Z')
const TENANT_ID = 'tenant-1'
const OTHER_TENANT_ID = 'tenant-2'
const TAG_ID = 'tag-1'
const CONTACT_ID = 'contact-1'

function makeTag(overrides: Partial<Tag> = {}): Tag {
  return {
    id: TAG_ID,
    tenantId: TENANT_ID,
    name: 'VIP',
    color: '#EF4444',
    createdAt: NOW,
    ...overrides,
  }
}

type MockTx = {
  tag: { findFirst: jest.Mock }
  contact: { findFirst: jest.Mock }
  contactTag: { create: jest.Mock; delete: jest.Mock }
}

function makeTx(): MockTx {
  return {
    tag: { findFirst: jest.fn() },
    contact: { findFirst: jest.fn() },
    contactTag: { create: jest.fn(), delete: jest.fn() },
  }
}

function makePrisma(tx: MockTx): MockPrisma {
  return {
    $transaction: jest.fn((cb: (t: MockTx) => unknown) => cb(tx)),
    tag: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    },
    contact: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    contactTag: {
      create: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  }
}

const mockAuditService = {
  log: jest.fn(),
}

describe('TagsService', () => {
  let service: TagsService
  let prisma: MockPrisma
  let tx: MockTx

  beforeEach(() => {
    tx = makeTx()
    prisma = makePrisma(tx)
    service = new TagsService(
      prisma as unknown as ConstructorParameters<typeof TagsService>[0],
      mockAuditService as never,
    )
  })

  describe('create()', () => {
    it('creates a tag scoped to authenticated tenant', async () => {
      const tag = makeTag()
      prisma.tag.create.mockResolvedValue(tag)

      const result = await service.create(TENANT_ID, 'VIP', '#EF4444')

      expect(result).toBe(tag)
      expect(prisma.tag.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT_ID,
          name: 'VIP',
          color: '#EF4444',
        },
      })
    })

    it('uses default blue color when color is omitted', async () => {
      const tag = makeTag({ color: '#3B82F6' })
      prisma.tag.create.mockResolvedValue(tag)

      const result = await service.create(TENANT_ID, 'VIP')

      expect(result?.color).toBe('#3B82F6')
      expect(prisma.tag.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ color: '#3B82F6' }) as Record<string, unknown>,
      })
    })

    it('throws ConflictException for duplicate tag name in the same tenant', async () => {
      prisma.tag.create.mockRejectedValue(
        new PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.22.0',
        }),
      )

      await expect(service.create(TENANT_ID, 'VIP')).rejects.toThrow(ConflictException)
    })

    it('normalizes tag name by trimming whitespace', async () => {
      const tag = makeTag()
      prisma.tag.create.mockResolvedValue(tag)

      await service.create(TENANT_ID, '  VIP  ')

      expect(prisma.tag.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ name: 'VIP' }) as Record<string, unknown>,
      })
    })

    it('rejects empty tag name', async () => {
      await expect(service.create(TENANT_ID, '   ')).rejects.toThrow(BadRequestException)
    })

    it('rejects overly long tag name', async () => {
      await expect(service.create(TENANT_ID, 'A'.repeat(51))).rejects.toThrow(BadRequestException)
    })

    it('rejects invalid hex color', async () => {
      await expect(service.create(TENANT_ID, 'Test', 'not-a-color')).rejects.toThrow(
        BadRequestException,
      )
    })

    it('rethrows unknown errors', async () => {
      prisma.tag.create.mockRejectedValue(new Error('database unavailable'))

      await expect(service.create(TENANT_ID, 'VIP')).rejects.toThrow('database unavailable')
    })
  })

  describe('findAll()', () => {
    it('returns all tags for the specified tenant ordered by name', async () => {
      const tags = [makeTag(), makeTag({ id: 'tag-2', name: 'Hot Lead', color: '#F59E0B' })]
      prisma.tag.findMany.mockResolvedValue(tags)

      const result = await service.findAll(TENANT_ID)

      expect(result).toEqual(tags)
      expect(prisma.tag.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID },
        orderBy: { name: 'asc' },
      })
    })

    it('returns empty array when tenant has no tags', async () => {
      prisma.tag.findMany.mockResolvedValue([])

      const result = await service.findAll(TENANT_ID)

      expect(result).toEqual([])
    })
  })

  describe('update()', () => {
    it('updates a tag name', async () => {
      prisma.tag.findFirst.mockResolvedValue(makeTag())
      prisma.tag.update.mockResolvedValue(makeTag({ name: 'Updated' }))

      const result = await service.update(TENANT_ID, TAG_ID, { name: 'Updated' })

      expect(result.name).toBe('Updated')
      expect(prisma.tag.update).toHaveBeenCalled()
    })

    it('updates a tag color', async () => {
      prisma.tag.findFirst.mockResolvedValue(makeTag())
      prisma.tag.update.mockResolvedValue(makeTag({ color: '#10B981' }))

      const result = await service.update(TENANT_ID, TAG_ID, { color: '#10B981' })

      expect(result.color).toBe('#10B981')
    })

    it('throws NotFoundException when tag does not exist', async () => {
      prisma.tag.findFirst.mockResolvedValue(null)

      await expect(service.update(TENANT_ID, TAG_ID, { name: 'X' })).rejects.toThrow(
        NotFoundException,
      )
    })

    it('throws ConflictException on duplicate name', async () => {
      prisma.tag.findFirst.mockResolvedValue(makeTag())
      prisma.tag.update.mockRejectedValue(
        new PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.22.0',
        }),
      )

      await expect(service.update(TENANT_ID, TAG_ID, { name: 'VIP' })).rejects.toThrow(
        ConflictException,
      )
    })

    it('rethrows unknown errors from update', async () => {
      prisma.tag.findFirst.mockResolvedValue(makeTag())
      prisma.tag.update.mockRejectedValue(new Error('db error'))

      await expect(service.update(TENANT_ID, TAG_ID, { name: 'Test' })).rejects.toThrow('db error')
    })
  })

  describe('delete()', () => {
    it('deletes a tag that belongs to the tenant', async () => {
      prisma.tag.findFirst.mockResolvedValue(makeTag())
      prisma.tag.delete.mockResolvedValue(makeTag())
      prisma.contactTag.count.mockResolvedValue(0)

      const result = await service.delete(TENANT_ID, TAG_ID)

      expect(result).toEqual({ success: true, affectedContacts: 0 })
      expect(prisma.tag.delete).toHaveBeenCalledWith({ where: { id: TAG_ID } })
    })

    it('throws NotFoundException when tag does not exist in tenant', async () => {
      prisma.tag.findFirst.mockResolvedValue(null)

      await expect(service.delete(TENANT_ID, TAG_ID)).rejects.toThrow(NotFoundException)
    })

    it('throws NotFoundException when tag exists in different tenant', async () => {
      prisma.tag.findFirst.mockResolvedValue(null)

      await expect(service.delete(OTHER_TENANT_ID, TAG_ID)).rejects.toThrow(NotFoundException)
    })
  })

  describe('addTagToContact()', () => {
    it('adds a tag to a contact', async () => {
      tx.tag.findFirst.mockResolvedValue(makeTag())
      tx.contact.findFirst.mockResolvedValue({
        id: CONTACT_ID,
        tenantId: TENANT_ID,
        deletedAt: null,
      })
      tx.contactTag.create.mockResolvedValue({
        contactId: CONTACT_ID,
        tagId: TAG_ID,
        createdAt: NOW,
      })

      await service.addTagToContact(TENANT_ID, CONTACT_ID, TAG_ID)

      expect(tx.contactTag.create).toHaveBeenCalledWith({
        data: { contactId: CONTACT_ID, tagId: TAG_ID },
      })
    })

    it('throws NotFoundException when tag does not exist', async () => {
      tx.tag.findFirst.mockResolvedValue(null)

      await expect(service.addTagToContact(TENANT_ID, CONTACT_ID, TAG_ID)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('throws NotFoundException when contact does not exist', async () => {
      tx.tag.findFirst.mockResolvedValue(makeTag())
      tx.contact.findFirst.mockResolvedValue(null)

      await expect(service.addTagToContact(TENANT_ID, CONTACT_ID, TAG_ID)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('is idempotent when tag is already assigned', async () => {
      tx.tag.findFirst.mockResolvedValue(makeTag())
      tx.contact.findFirst.mockResolvedValue({
        id: CONTACT_ID,
        tenantId: TENANT_ID,
        deletedAt: null,
      })
      tx.contactTag.create.mockRejectedValue(
        new PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.22.0',
        }),
      )

      await expect(service.addTagToContact(TENANT_ID, CONTACT_ID, TAG_ID)).resolves.toBeUndefined()
    })

    it('rethrows non-P2002 errors from addTagToContact', async () => {
      tx.tag.findFirst.mockResolvedValue(makeTag())
      tx.contact.findFirst.mockResolvedValue({
        id: CONTACT_ID,
        tenantId: TENANT_ID,
        deletedAt: null,
      })
      tx.contactTag.create.mockRejectedValue(new Error('unexpected error'))

      await expect(service.addTagToContact(TENANT_ID, CONTACT_ID, TAG_ID)).rejects.toThrow(
        'unexpected error',
      )
    })
  })

  describe('removeTagFromContact()', () => {
    it('removes a tag from a contact', async () => {
      tx.tag.findFirst.mockResolvedValue(makeTag())
      tx.contact.findFirst.mockResolvedValue({
        id: CONTACT_ID,
        tenantId: TENANT_ID,
        deletedAt: null,
      })
      tx.contactTag.delete.mockResolvedValue({
        contactId: CONTACT_ID,
        tagId: TAG_ID,
        createdAt: NOW,
      })

      await service.removeTagFromContact(TENANT_ID, CONTACT_ID, TAG_ID)

      expect(tx.contactTag.delete).toHaveBeenCalledWith({
        where: { contactId_tagId: { contactId: CONTACT_ID, tagId: TAG_ID } },
      })
    })

    it('throws NotFoundException when tag is not assigned to contact', async () => {
      tx.tag.findFirst.mockResolvedValue(makeTag())
      tx.contact.findFirst.mockResolvedValue({
        id: CONTACT_ID,
        tenantId: TENANT_ID,
        deletedAt: null,
      })
      tx.contactTag.delete.mockRejectedValue(
        new PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: '5.22.0',
        }),
      )

      await expect(service.removeTagFromContact(TENANT_ID, CONTACT_ID, TAG_ID)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('findByContact()', () => {
    it('returns all tags for a contact', async () => {
      const vipTag = makeTag()
      const hotLeadTag = makeTag({ id: 'tag-2', name: 'Hot Lead', color: '#F59E0B' })
      prisma.contact.findFirst.mockResolvedValue({
        id: CONTACT_ID,
        tenantId: TENANT_ID,
        deletedAt: null,
      })
      prisma.contactTag.findMany.mockResolvedValue([
        { contactId: CONTACT_ID, tagId: TAG_ID, createdAt: NOW, tag: vipTag },
        { contactId: CONTACT_ID, tagId: 'tag-2', createdAt: NOW, tag: hotLeadTag },
      ])

      const result = await service.findByContact(TENANT_ID, CONTACT_ID)

      expect(result).toEqual([vipTag, hotLeadTag])
    })

    it('throws NotFoundException when contact does not exist', async () => {
      prisma.contact.findFirst.mockResolvedValue(null)

      await expect(service.findByContact(TENANT_ID, CONTACT_ID)).rejects.toThrow(NotFoundException)
    })

    it('returns empty array when contact has no tags', async () => {
      prisma.contact.findFirst.mockResolvedValue({
        id: CONTACT_ID,
        tenantId: TENANT_ID,
        deletedAt: null,
      })
      prisma.contactTag.findMany.mockResolvedValue([])

      const result = await service.findByContact(TENANT_ID, CONTACT_ID)

      expect(result).toEqual([])
    })
  })
})
