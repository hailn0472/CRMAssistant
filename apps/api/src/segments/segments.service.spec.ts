import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

import { SegmentsService } from './segments.service'
import type { SavedSegment } from '@prisma/client'

type MockSavedSegmentDelegate = {
  create: jest.Mock
  findFirst: jest.Mock
  findMany: jest.Mock
  update: jest.Mock
}

type MockPrisma = {
  savedSegment: MockSavedSegmentDelegate
}

const NOW = new Date('2026-07-09T00:00:00.000Z')
const TENANT_ID = 'tenant-1'
const USER_ID = 'user-1'
const SEGMENT_ID = 'segment-1'

function makeSegment(overrides: Partial<SavedSegment> = {}): SavedSegment {
  return {
    id: SEGMENT_ID,
    tenantId: TENANT_ID,
    name: 'VIP Customers',
    filters: { tags: ['VIP'] },
    createdBy: USER_ID,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  }
}

function makePrisma(): MockPrisma {
  return {
    savedSegment: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  }
}

describe('SegmentsService', () => {
  let service: SegmentsService
  let prisma: MockPrisma

  beforeEach(() => {
    prisma = makePrisma()
    service = new SegmentsService(
      prisma as unknown as ConstructorParameters<typeof SegmentsService>[0],
    )
  })

  describe('create()', () => {
    it('creates a saved segment for the tenant', async () => {
      const segment = makeSegment()
      prisma.savedSegment.create.mockResolvedValue(segment)

      const result = await service.create(TENANT_ID, USER_ID, {
        name: 'VIP Customers',
        filters: { tags: ['VIP'] },
      })

      expect(result).toBe(segment)
      expect(prisma.savedSegment.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT_ID,
          name: 'VIP Customers',
          filters: { tags: ['VIP'] },
          createdBy: USER_ID,
        },
      })
    })

    it('normalizes segment name', async () => {
      prisma.savedSegment.create.mockResolvedValue(makeSegment())

      await service.create(TENANT_ID, USER_ID, {
        name: '  VIP Customers  ',
        filters: {},
      })

      expect(prisma.savedSegment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ name: 'VIP Customers' }) as Record<string, unknown>,
      })
    })

    it('throws ConflictException for duplicate segment name', async () => {
      prisma.savedSegment.create.mockRejectedValue(
        new PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.22.0',
        }),
      )

      await expect(
        service.create(TENANT_ID, USER_ID, { name: 'VIP Customers', filters: {} }),
      ).rejects.toThrow(ConflictException)
    })

    it('rejects empty name', async () => {
      await expect(
        service.create(TENANT_ID, USER_ID, { name: '   ', filters: {} }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects overly long name', async () => {
      await expect(
        service.create(TENANT_ID, USER_ID, { name: 'A'.repeat(101), filters: {} }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('findAll()', () => {
    it('returns non-deleted segments for tenant ordered by creation date', async () => {
      const segments = [makeSegment(), makeSegment({ id: 'segment-2', name: 'Hot Leads' })]
      prisma.savedSegment.findMany.mockResolvedValue(segments)

      const result = await service.findAll(TENANT_ID)

      expect(result).toEqual(segments)
      expect(prisma.savedSegment.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      })
    })
  })

  describe('update()', () => {
    it('updates a segment name', async () => {
      const updated = makeSegment({ name: 'Updated Name' })
      prisma.savedSegment.findFirst.mockResolvedValue(makeSegment())
      prisma.savedSegment.update.mockResolvedValue(updated)

      const result = await service.update(TENANT_ID, SEGMENT_ID, { name: 'Updated Name' })

      expect(result).toBe(updated)
      expect(prisma.savedSegment.update).toHaveBeenCalledWith({
        where: { id: SEGMENT_ID },
        data: { name: 'Updated Name' },
      })
    })

    it('throws NotFoundException when segment does not exist', async () => {
      prisma.savedSegment.findFirst.mockResolvedValue(null)

      await expect(service.update(TENANT_ID, SEGMENT_ID, { name: 'New Name' })).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('delete()', () => {
    it('soft deletes a segment', async () => {
      prisma.savedSegment.findFirst.mockResolvedValue(makeSegment())
      prisma.savedSegment.update.mockResolvedValue(makeSegment({ deletedAt: NOW }))

      const result = await service.delete(TENANT_ID, SEGMENT_ID)

      expect(result).toBe(true)
      expect(prisma.savedSegment.update).toHaveBeenCalledWith({
        where: { id: SEGMENT_ID },
        data: { deletedAt: expect.any(Date) as Date },
      })
    })

    it('throws NotFoundException when segment does not exist', async () => {
      prisma.savedSegment.findFirst.mockResolvedValue(null)

      await expect(service.delete(TENANT_ID, SEGMENT_ID)).rejects.toThrow(NotFoundException)
    })
  })
})
