import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'

import { Prisma } from '@prisma/client'
import { DealStageService } from '../deal-stages.service'

type MockDealStageDelegate = {
  findMany: jest.Mock
  findFirst: jest.Mock
  create: jest.Mock
  update: jest.Mock
  updateMany: jest.Mock
}

type MockDealDelegate = {
  count: jest.Mock
}

type MockPrisma = {
  dealStage: MockDealStageDelegate
  deal: MockDealDelegate
  $transaction: jest.Mock
}

const TENANT_ID = 'tenant-1'
const OTHER_TENANT_ID = 'tenant-2'
const STAGE_ID = 'stage-1'

function makePrisma(): MockPrisma {
  return {
    dealStage: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    deal: {
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  }
}

describe('DealStageService', () => {
  let service: DealStageService
  let prisma: MockPrisma

  beforeEach(() => {
    prisma = makePrisma()
    service = new DealStageService(
      prisma as unknown as ConstructorParameters<typeof DealStageService>[0],
    )
  })

  describe('findMany()', () => {
    it('returns all active stages for tenant ordered by order', async () => {
      const stages = [
        { id: 's1', name: 'Lead', order: 0 },
        { id: 's2', name: 'Qualified', order: 1 },
      ]
      prisma.dealStage.findMany.mockResolvedValue(stages)

      const result = await service.findMany(TENANT_ID)

      expect(result).toEqual(stages)
      expect(prisma.dealStage.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, deletedAt: null },
        orderBy: { order: 'asc' },
      })
    })

    it('returns empty array when no stages exist', async () => {
      prisma.dealStage.findMany.mockResolvedValue([])

      const result = await service.findMany(TENANT_ID)
      expect(result).toEqual([])
    })
  })

  describe('create()', () => {
    it('creates stage with provided name and color', async () => {
      prisma.dealStage.findFirst.mockResolvedValue(null) // no existing stages
      prisma.dealStage.create.mockResolvedValue({ id: 'new-stage', name: 'New Stage', order: 0 })

      await service.create(TENANT_ID, { name: 'New Stage' })

      expect(prisma.dealStage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          name: 'New Stage',
          order: 0,
          color: '#3B82F6',
          probability: 0,
          isWon: false,
          isLost: false,
        }),
      })
    })

    it('assigns order as max existing order + 1', async () => {
      prisma.dealStage.findFirst.mockResolvedValue({ order: 5 })
      prisma.dealStage.create.mockResolvedValue({ id: 'new-stage', order: 6 })

      await service.create(TENANT_ID, { name: 'New Stage' })

      expect(prisma.dealStage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ order: 6 }),
      })
    })

    it('throws BadRequestException when name is empty', async () => {
      await expect(service.create(TENANT_ID, { name: '   ' })).rejects.toThrow(BadRequestException)
    })

    it('rejects duplicate stage name with P2002 error', async () => {
      prisma.dealStage.findFirst.mockResolvedValue(null) // no existing stages
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`tenantId`,`name`)',
        { code: 'P2002', clientVersion: '5.22.0' },
      )
      prisma.dealStage.create.mockRejectedValue(p2002Error)

      await expect(service.create(TENANT_ID, { name: 'Duplicate' })).rejects.toThrow(
        new BadRequestException('Stage name already exists'),
      )
    })
  })

  describe('update()', () => {
    it('updates stage fields', async () => {
      prisma.dealStage.findFirst.mockResolvedValueOnce({ id: STAGE_ID, tenantId: TENANT_ID })
      prisma.dealStage.updateMany.mockResolvedValue({ count: 1 })
      prisma.dealStage.findFirst.mockResolvedValueOnce({
        id: STAGE_ID,
        name: 'Updated',
        color: '#000',
        tenantId: TENANT_ID,
        deletedAt: null,
      })

      await service.update(TENANT_ID, STAGE_ID, { name: 'Updated', color: '#000' })

      expect(prisma.dealStage.updateMany).toHaveBeenCalledWith({
        where: { id: STAGE_ID, tenantId: TENANT_ID },
        data: expect.objectContaining({ name: 'Updated', color: '#000' }),
      })
    })

    it('rejects duplicate stage name update with P2002 error', async () => {
      prisma.dealStage.findFirst.mockResolvedValueOnce({ id: STAGE_ID, tenantId: TENANT_ID })
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`tenantId`,`name`)',
        { code: 'P2002', clientVersion: '5.22.0' },
      )
      prisma.dealStage.updateMany.mockRejectedValue(p2002Error)

      await expect(service.update(TENANT_ID, STAGE_ID, { name: 'Duplicate' })).rejects.toThrow(
        new BadRequestException('Stage name already exists'),
      )
    })

    it('throws NotFoundException when stage not found', async () => {
      prisma.dealStage.findFirst.mockResolvedValue(null)

      await expect(service.update(TENANT_ID, 'missing', { name: 'Test' })).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('reorder()', () => {
    it('reorders stages to match provided ID list', async () => {
      const stages = [{ id: 's1' }, { id: 's2' }, { id: 's3' }]
      prisma.dealStage.findMany.mockResolvedValue(stages)
      prisma.dealStage.updateMany.mockResolvedValue({ count: 1 })
      prisma.$transaction.mockImplementation((updates: Promise<unknown>[]) => Promise.all(updates))
      prisma.dealStage.findMany.mockResolvedValue(stages)

      await service.reorder(TENANT_ID, ['s3', 's1', 's2'])

      // Should call $transaction (may be update calls in array)
      expect(prisma.$transaction).toHaveBeenCalled()
    })

    it('validates input set matches existing stage IDs exactly', async () => {
      prisma.dealStage.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }])

      await expect(
        service.reorder(TENANT_ID, ['s1']), // s2 missing
      ).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException for empty input', async () => {
      await expect(service.reorder(TENANT_ID, [])).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException for duplicate IDs', async () => {
      prisma.dealStage.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }])

      await expect(service.reorder(TENANT_ID, ['s1', 's1'])).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException for cross-tenant stage ID', async () => {
      prisma.dealStage.findMany.mockResolvedValue([{ id: 's1' }])

      await expect(
        service.reorder(TENANT_ID, ['s1', 's2']), // s2 not in tenant
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('delete()', () => {
    it('soft deletes stage with no active deals', async () => {
      prisma.dealStage.findFirst.mockResolvedValueOnce({
        id: STAGE_ID,
        tenantId: TENANT_ID,
        name: 'Lead',
      })
      prisma.deal.count.mockResolvedValue(0)
      prisma.dealStage.updateMany.mockResolvedValue({ count: 1 })
      prisma.dealStage.findFirst.mockResolvedValueOnce({
        id: STAGE_ID,
        tenantId: TENANT_ID,
        deletedAt: expect.any(Date),
      })

      await service.delete(TENANT_ID, STAGE_ID)

      expect(prisma.dealStage.updateMany).toHaveBeenCalledWith({
        where: { id: STAGE_ID, tenantId: TENANT_ID },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      })
    })

    it('blocks deletion when active deals reference stage', async () => {
      prisma.dealStage.findFirst.mockResolvedValue({
        id: STAGE_ID,
        tenantId: TENANT_ID,
        name: 'Lead',
      })
      prisma.deal.count.mockResolvedValue(3) // 3 active deals

      await expect(service.delete(TENANT_ID, STAGE_ID)).rejects.toThrow(ConflictException)

      expect(prisma.dealStage.updateMany).not.toHaveBeenCalled()
    })

    it('throws NotFoundException when stage not found', async () => {
      prisma.dealStage.findFirst.mockResolvedValue(null)

      await expect(service.delete(TENANT_ID, 'missing')).rejects.toThrow(NotFoundException)
    })

    it('blocks cross-tenant stage deletion', async () => {
      prisma.dealStage.findFirst.mockResolvedValue(null) // different tenant

      await expect(service.delete(OTHER_TENANT_ID, STAGE_ID)).rejects.toThrow(NotFoundException)
    })
  })
})
