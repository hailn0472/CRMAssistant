import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'

import { CompetitorsService } from '../competitors.service'

type MockCompetitorDelegate = {
  findFirst: jest.Mock
  findMany: jest.Mock
  count: jest.Mock
  create: jest.Mock
  updateMany: jest.Mock
}

type MockPrisma = {
  competitor: MockCompetitorDelegate
}

function makePrisma(): MockPrisma {
  return {
    competitor: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
  }
}

const TENANT_ID = 'tenant-1'
const OTHER_TENANT_ID = 'tenant-2'
const USER_ID = 'user-1'
const NOW = new Date()

function makeCompetitor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'competitor-1',
    tenantId: TENANT_ID,
    name: 'Acme Corp',
    website: null,
    strengths: null,
    weaknesses: null,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: USER_ID,
    updatedBy: USER_ID,
    deletedAt: null,
    ...overrides,
  }
}

describe('CompetitorsService', () => {
  let service: CompetitorsService
  let prisma: MockPrisma

  beforeEach(() => {
    prisma = makePrisma()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new CompetitorsService(prisma as any)
  })

  describe('create', () => {
    it('trims name and rejects empty name', async () => {
      await expect(service.create(TENANT_ID, USER_ID, { name: '   ' })).rejects.toThrow(
        BadRequestException,
      )
      await expect(service.create(TENANT_ID, USER_ID, { name: '   ' })).rejects.toThrow(
        'Competitor name is required',
      )
    })

    it('rejects name > 200 chars', async () => {
      await expect(service.create(TENANT_ID, USER_ID, { name: 'a'.repeat(201) })).rejects.toThrow(
        BadRequestException,
      )
    })

    it('rejects case-insensitive duplicate active name (AC #15)', async () => {
      prisma.competitor.findFirst.mockResolvedValue(makeCompetitor())
      await expect(service.create(TENANT_ID, USER_ID, { name: 'acme corp' })).rejects.toThrow(
        ConflictException,
      )
      await expect(service.create(TENANT_ID, USER_ID, { name: 'acme corp' })).rejects.toThrow(
        'Competitor name already exists',
      )
    })

    it('checks duplicates over active rows only — soft-deleted name is reusable', async () => {
      prisma.competitor.findFirst.mockResolvedValue(null)
      prisma.competitor.create.mockResolvedValue(makeCompetitor())
      await service.create(TENANT_ID, USER_ID, { name: 'Acme Corp' })
      expect(prisma.competitor.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: TENANT_ID,
            deletedAt: null,
            name: { equals: 'Acme Corp', mode: 'insensitive' },
          }),
        }),
      )
    })

    it('allows the same name in a different tenant (no cross-tenant uniqueness)', async () => {
      prisma.competitor.findFirst.mockResolvedValue(null)
      prisma.competitor.create.mockResolvedValue(makeCompetitor())
      await expect(
        service.create(OTHER_TENANT_ID, USER_ID, { name: 'Acme Corp' }),
      ).resolves.toEqual(makeCompetitor())
      expect(prisma.competitor.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenantId: OTHER_TENANT_ID }) }),
      )
    })

    it('sets tenantId, createdBy and updatedBy from args', async () => {
      prisma.competitor.findFirst.mockResolvedValue(null)
      prisma.competitor.create.mockResolvedValue(makeCompetitor())
      await service.create(TENANT_ID, USER_ID, { name: 'Acme Corp', website: 'https://acme.test' })
      expect(prisma.competitor.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_ID,
            createdBy: USER_ID,
            updatedBy: USER_ID,
            website: 'https://acme.test',
            isActive: true,
          }),
        }),
      )
    })
  })

  describe('findOne', () => {
    it('filters by id + tenantId + deletedAt: null (AC #14)', async () => {
      prisma.competitor.findFirst.mockResolvedValue(makeCompetitor())
      const result = await service.findOne(TENANT_ID, 'competitor-1')
      expect(prisma.competitor.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'competitor-1', tenantId: TENANT_ID, deletedAt: null },
        }),
      )
      expect(result).toEqual(makeCompetitor())
    })

    it('throws NotFoundException for non-existent id', async () => {
      prisma.competitor.findFirst.mockResolvedValue(null)
      await expect(service.findOne(TENANT_ID, 'missing')).rejects.toThrow(NotFoundException)
      await expect(service.findOne(TENANT_ID, 'missing')).rejects.toThrow('Competitor not found')
    })

    it('treats a cross-tenant row as not found (never discloses existence)', async () => {
      prisma.competitor.findFirst.mockResolvedValue(null)
      await expect(service.findOne(OTHER_TENANT_ID, 'competitor-1')).rejects.toThrow(
        'Competitor not found',
      )
    })
  })

  describe('findMany', () => {
    it('defaults to page 1 / pageSize 20 and clamps at 100 (AC #15)', async () => {
      prisma.competitor.findMany.mockResolvedValue([])
      prisma.competitor.count.mockResolvedValue(0)
      await service.findMany(TENANT_ID)
      expect(prisma.competitor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      )
      await service.findMany(TENANT_ID, {}, { pageSize: 500 })
      expect(prisma.competitor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      )
    })

    it('filters active rows by default with tenantId + deletedAt: null', async () => {
      prisma.competitor.findMany.mockResolvedValue([])
      prisma.competitor.count.mockResolvedValue(0)
      await service.findMany(TENANT_ID)
      expect(prisma.competitor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT_ID, deletedAt: null, isActive: true },
        }),
      )
    })

    it('includes inactive rows when includeInactive is true', async () => {
      prisma.competitor.findMany.mockResolvedValue([])
      prisma.competitor.count.mockResolvedValue(0)
      await service.findMany(TENANT_ID, { includeInactive: true })
      expect(prisma.competitor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: TENANT_ID, deletedAt: null } }),
      )
    })

    it('applies a case-insensitive search filter', async () => {
      prisma.competitor.findMany.mockResolvedValue([])
      prisma.competitor.count.mockResolvedValue(0)
      await service.findMany(TENANT_ID, { search: '  acme  ' })
      expect(prisma.competitor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ name: { contains: 'acme', mode: 'insensitive' } }),
        }),
      )
    })

    it('returns the connection shape with total/page/pageSize', async () => {
      const items = [makeCompetitor()]
      prisma.competitor.findMany.mockResolvedValue(items)
      prisma.competitor.count.mockResolvedValue(1)
      const result = await service.findMany(TENANT_ID, {}, { page: 2, pageSize: 10 })
      expect(result).toEqual({ items, total: 1, page: 2, pageSize: 10 })
    })
  })

  describe('update', () => {
    it('rejects duplicate name excluding self', async () => {
      // call 1 = findOne (the row being updated), call 2 = duplicate check
      prisma.competitor.findFirst
        .mockResolvedValueOnce(makeCompetitor())
        .mockResolvedValueOnce(makeCompetitor({ id: 'other' }))
      await expect(
        service.update(TENANT_ID, USER_ID, 'competitor-1', { name: 'ACME CORP' }),
      ).rejects.toThrow(ConflictException)
      expect(prisma.competitor.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: 'competitor-1' } }),
        }),
      )
    })

    it('updates with updatedBy from userId and re-reads the row', async () => {
      prisma.competitor.findFirst.mockResolvedValue(makeCompetitor())
      prisma.competitor.updateMany.mockResolvedValue({ count: 1 })
      await service.update(TENANT_ID, USER_ID, 'competitor-1', {
        website: 'https://new.test',
        isActive: false,
      })
      expect(prisma.competitor.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'competitor-1', tenantId: TENANT_ID, deletedAt: null },
          data: expect.objectContaining({ updatedBy: USER_ID, website: 'https://new.test' }),
        }),
      )
      // re-read happens after update
      expect(prisma.competitor.findFirst).toHaveBeenCalledTimes(2)
    })

    it('throws NotFoundException when updateMany affects zero rows', async () => {
      prisma.competitor.findFirst.mockRejectedValueOnce(
        new NotFoundException('Competitor not found'),
      )
      await expect(service.update(TENANT_ID, USER_ID, 'missing', { website: 'x' })).rejects.toThrow(
        'Competitor not found',
      )
    })
  })

  describe('delete', () => {
    it('soft-deletes via updateMany with deletedAt and updatedBy', async () => {
      prisma.competitor.updateMany.mockResolvedValue({ count: 1 })
      const result = await service.delete(TENANT_ID, USER_ID, 'competitor-1')
      expect(result).toBe(true)
      expect(prisma.competitor.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'competitor-1', tenantId: TENANT_ID, deletedAt: null },
          data: expect.objectContaining({
            deletedAt: expect.any(Date),
            updatedBy: USER_ID,
          }),
        }),
      )
    })

    it('throws NotFoundException when nothing was soft-deleted', async () => {
      prisma.competitor.updateMany.mockResolvedValue({ count: 0 })
      await expect(service.delete(TENANT_ID, USER_ID, 'missing')).rejects.toThrow(NotFoundException)
      await expect(service.delete(TENANT_ID, USER_ID, 'missing')).rejects.toThrow(
        'Competitor not found',
      )
    })
  })
})
