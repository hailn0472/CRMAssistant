import { BadRequestException, NotFoundException } from '@nestjs/common'

import { DealsService } from '../deals.service'
import type { Deal } from '@prisma/client'

jest.mock('../../common/guards/visibility-check', () => ({
  resolveVisibilityFilter: jest.fn(),
  registerVisibilityService: jest.fn(),
}))

import { resolveVisibilityFilter } from '../../common/guards/visibility-check'

type MockDealDelegate = {
  create: jest.Mock
  findFirst: jest.Mock
  findMany: jest.Mock
  count: jest.Mock
  updateMany: jest.Mock
  update: jest.Mock
}

type MockDealStageDelegate = {
  findFirst: jest.Mock
  findMany: jest.Mock
  count: jest.Mock
}

type MockContactDelegate = {
  findFirst: jest.Mock
}

type MockPrisma = {
  deal: MockDealDelegate
  dealStage: MockDealStageDelegate
  contact: MockContactDelegate
  $transaction: jest.Mock
}

const NOW = new Date('2026-07-29T00:00:00.000Z')
const TENANT_ID = 'tenant-1'
const OTHER_TENANT_ID = 'tenant-2'
const USER_ID = 'user-1'
const CONTACT_ID = 'contact-1'
const STAGE_ID = 'stage-1'
const DEAL_ID = 'deal-1'

function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: DEAL_ID,
    tenantId: TENANT_ID,
    title: 'Big Deal',
    value: 50000,
    currency: 'USD',
    probability: 10,
    stageId: STAGE_ID,
    contactId: CONTACT_ID,
    ownerId: USER_ID,
    expectedCloseDate: null,
    actualCloseDate: null,
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
    deal: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    dealStage: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    contact: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  }
}

describe('DealsService', () => {
  let service: DealsService
  let prisma: MockPrisma

  beforeEach(() => {
    prisma = makePrisma()
    service = new DealsService(prisma as unknown as ConstructorParameters<typeof DealsService>[0])
    ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(undefined)
  })

  describe('create()', () => {
    it('creates a deal scoped to authenticated tenant with all required fields', async () => {
      const deal = makeDeal()
      prisma.contact.findFirst.mockResolvedValue({ id: CONTACT_ID })
      prisma.dealStage.findFirst.mockResolvedValue({ id: STAGE_ID, probability: 10 })
      prisma.deal.create.mockResolvedValue(deal)

      const result = await service.create(TENANT_ID, USER_ID, {
        title: 'Big Deal',
        value: 50000,
        currency: 'USD',
        stageId: STAGE_ID,
        contactId: CONTACT_ID,
      })

      expect(result).toBe(deal)
      expect(prisma.deal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          title: 'Big Deal',
          value: 50000,
          currency: 'USD',
          probability: 10,
          stageId: STAGE_ID,
          contactId: CONTACT_ID,
          ownerId: USER_ID,
          createdBy: USER_ID,
          updatedBy: USER_ID,
        }),
      })
    })

    it('throws BadRequestException when title is empty', async () => {
      await expect(
        service.create(TENANT_ID, USER_ID, {
          title: '   ',
          stageId: STAGE_ID,
          contactId: CONTACT_ID,
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException when title exceeds max length', async () => {
      await expect(
        service.create(TENANT_ID, USER_ID, {
          title: 'x'.repeat(201),
          stageId: STAGE_ID,
          contactId: CONTACT_ID,
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException when value is negative', async () => {
      prisma.contact.findFirst.mockResolvedValue({ id: CONTACT_ID })
      prisma.dealStage.findFirst.mockResolvedValue({ id: STAGE_ID, probability: 10 })

      await expect(
        service.create(TENANT_ID, USER_ID, {
          title: 'Test Deal',
          value: -100,
          stageId: STAGE_ID,
          contactId: CONTACT_ID,
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws NotFoundException when contactId not found in tenant', async () => {
      prisma.contact.findFirst.mockResolvedValue(null)
      prisma.dealStage.findFirst.mockResolvedValue({ id: STAGE_ID, probability: 10 })

      await expect(
        service.create(TENANT_ID, USER_ID, {
          title: 'Test Deal',
          stageId: STAGE_ID,
          contactId: 'missing-contact',
        }),
      ).rejects.toThrow(NotFoundException)
    })

    it('throws NotFoundException when stageId not found in tenant', async () => {
      prisma.contact.findFirst.mockResolvedValue({ id: CONTACT_ID })
      prisma.dealStage.findFirst.mockResolvedValue(null)

      await expect(
        service.create(TENANT_ID, USER_ID, {
          title: 'Test Deal',
          stageId: 'missing-stage',
          contactId: CONTACT_ID,
        }),
      ).rejects.toThrow(NotFoundException)
    })

    it('defaults ownerId to creating user when not provided', async () => {
      prisma.contact.findFirst.mockResolvedValue({ id: CONTACT_ID })
      prisma.dealStage.findFirst.mockResolvedValue({ id: STAGE_ID, probability: 10 })
      prisma.deal.create.mockResolvedValue(makeDeal())

      await service.create(TENANT_ID, USER_ID, {
        title: 'Test Deal',
        stageId: STAGE_ID,
        contactId: CONTACT_ID,
      })

      expect(prisma.deal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ ownerId: USER_ID }),
      })
    })

    it('defaults probability to stage probability at creation', async () => {
      prisma.contact.findFirst.mockResolvedValue({ id: CONTACT_ID })
      prisma.dealStage.findFirst.mockResolvedValue({ id: STAGE_ID, probability: 25 })
      prisma.deal.create.mockResolvedValue(makeDeal({ probability: 25 }))

      const result = await service.create(TENANT_ID, USER_ID, {
        title: 'Test Deal',
        stageId: STAGE_ID,
        contactId: CONTACT_ID,
      })

      expect(result.probability).toBe(25)
    })

    it('normalizes whitespace in title', async () => {
      prisma.contact.findFirst.mockResolvedValue({ id: CONTACT_ID })
      prisma.dealStage.findFirst.mockResolvedValue({ id: STAGE_ID, probability: 10 })
      prisma.deal.create.mockResolvedValue(makeDeal({ title: 'Big Deal' }))

      await service.create(TENANT_ID, USER_ID, {
        title: '  Big Deal  ',
        stageId: STAGE_ID,
        contactId: CONTACT_ID,
      })

      expect(prisma.deal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ title: 'Big Deal' }),
      })
    })

    it('normalizes currency to uppercase', async () => {
      prisma.contact.findFirst.mockResolvedValue({ id: CONTACT_ID })
      prisma.dealStage.findFirst.mockResolvedValue({ id: STAGE_ID, probability: 10 })
      prisma.deal.create.mockResolvedValue(makeDeal({ currency: 'USD' }))

      await service.create(TENANT_ID, USER_ID, {
        title: 'Test Deal',
        currency: '  usd  ',
        stageId: STAGE_ID,
        contactId: CONTACT_ID,
      })

      expect(prisma.deal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ currency: 'USD' }),
      })
    })
  })

  describe('findOne()', () => {
    it('returns deal scoped to tenant and visible to user', async () => {
      const deal = makeDeal()
      prisma.deal.findFirst.mockResolvedValue(deal)

      const result = await service.findOne(TENANT_ID, USER_ID, DEAL_ID)

      expect(result).toBe(deal)
      expect(prisma.deal.findFirst).toHaveBeenCalledWith({
        where: { id: DEAL_ID, tenantId: TENANT_ID, deletedAt: null },
        include: expect.any(Object),
      })
    })

    it('throws NotFoundException when deal not found', async () => {
      prisma.deal.findFirst.mockResolvedValue(null)

      await expect(service.findOne(TENANT_ID, USER_ID, 'missing')).rejects.toThrow(
        NotFoundException,
      )
    })

    it('throws NotFoundException for cross-tenant deal', async () => {
      prisma.deal.findFirst.mockResolvedValue(null)

      await expect(service.findOne(OTHER_TENANT_ID, USER_ID, DEAL_ID)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('throws NotFoundException for soft-deleted deal', async () => {
      prisma.deal.findFirst.mockResolvedValue(null) // deletedAt filter returns null

      await expect(service.findOne(TENANT_ID, USER_ID, DEAL_ID)).rejects.toThrow(NotFoundException)
    })

    it('applies OWN visibility: ownerId matches', async () => {
      const deal = makeDeal({ ownerId: USER_ID })
      prisma.deal.findFirst.mockResolvedValue(deal)
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(USER_ID)

      const result = await service.findOne(TENANT_ID, USER_ID, DEAL_ID)
      expect(result).toBe(deal)
    })

    it('applies OWN visibility: ownerId differs → NotFoundException', async () => {
      const deal = makeDeal({ ownerId: 'other-user' })
      prisma.deal.findFirst.mockResolvedValue(deal)
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(USER_ID)

      await expect(service.findOne(TENANT_ID, USER_ID, DEAL_ID)).rejects.toThrow(NotFoundException)
    })

    it('applies TEAM visibility: owner in team → access granted', async () => {
      const deal = makeDeal({ ownerId: 'teammate' })
      prisma.deal.findFirst.mockResolvedValue(deal)
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue({ in: [USER_ID, 'teammate'] })

      const result = await service.findOne(TENANT_ID, USER_ID, DEAL_ID)
      expect(result).toBe(deal)
    })

    it('applies TEAM visibility: owner not in team → NotFoundException', async () => {
      const deal = makeDeal({ ownerId: 'external' })
      prisma.deal.findFirst.mockResolvedValue(deal)
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue({ in: [USER_ID, 'teammate'] })

      await expect(service.findOne(TENANT_ID, USER_ID, DEAL_ID)).rejects.toThrow(NotFoundException)
    })

    it('applies ALL visibility (ADMIN) → access always granted', async () => {
      const deal = makeDeal({ ownerId: 'other-user' })
      prisma.deal.findFirst.mockResolvedValue(deal)
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(undefined)

      const result = await service.findOne(TENANT_ID, USER_ID, DEAL_ID)
      expect(result).toBe(deal)
    })
  })

  describe('findMany()', () => {
    it('returns paginated active tenant deals with total count', async () => {
      const deals = [makeDeal()]
      prisma.deal.findMany.mockResolvedValue(deals)
      prisma.deal.count.mockResolvedValue(1)

      const result = await service.findMany(TENANT_ID, USER_ID, {}, { page: 1, pageSize: 20 })

      expect(result.items).toEqual(deals)
      expect(result.total).toBe(1)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(20)
    })

    it('applies default pagination when not specified', async () => {
      prisma.deal.findMany.mockResolvedValue([])
      prisma.deal.count.mockResolvedValue(0)

      await service.findMany(TENANT_ID, USER_ID)

      expect(prisma.deal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      )
    })

    it('clamps pageSize to max 100', async () => {
      prisma.deal.findMany.mockResolvedValue([])
      prisma.deal.count.mockResolvedValue(0)

      await service.findMany(TENANT_ID, USER_ID, {}, { page: 1, pageSize: 200 })

      expect(prisma.deal.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }))
    })

    it('filters by search (title contains)', async () => {
      prisma.deal.findMany.mockResolvedValue([])
      prisma.deal.count.mockResolvedValue(0)

      await service.findMany(TENANT_ID, USER_ID, { search: 'Big' })

      expect(prisma.deal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({ title: { contains: 'Big', mode: 'insensitive' } }),
            ]),
          }),
        }),
      )
    })

    it('filters by stageId', async () => {
      prisma.deal.findMany.mockResolvedValue([])
      prisma.deal.count.mockResolvedValue(0)

      await service.findMany(TENANT_ID, USER_ID, { stageId: STAGE_ID })

      expect(prisma.deal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([expect.objectContaining({ stageId: STAGE_ID })]),
          }),
        }),
      )
    })

    it('filters by expectedCloseDateFrom/To', async () => {
      prisma.deal.findMany.mockResolvedValue([])
      prisma.deal.count.mockResolvedValue(0)

      await service.findMany(TENANT_ID, USER_ID, {
        expectedCloseDateFrom: '2026-01-01',
        expectedCloseDateTo: '2026-12-31',
      })

      expect(prisma.deal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({
                expectedCloseDate: expect.objectContaining({
                  gte: expect.any(Date),
                  lte: expect.any(Date),
                }),
              }),
            ]),
          }),
        }),
      )
    })

    it('applies visibility filter in where clause', async () => {
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(USER_ID)
      prisma.deal.findMany.mockResolvedValue([])
      prisma.deal.count.mockResolvedValue(0)

      await service.findMany(TENANT_ID, USER_ID)

      expect(prisma.deal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([expect.objectContaining({ ownerId: USER_ID })]),
          }),
        }),
      )
    })

    it('orders by createdAt desc by default', async () => {
      prisma.deal.findMany.mockResolvedValue([])
      prisma.deal.count.mockResolvedValue(0)

      await service.findMany(TENANT_ID, USER_ID)

      expect(prisma.deal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      )
    })

    it('returns empty result for tenant with no deals', async () => {
      prisma.deal.findMany.mockResolvedValue([])
      prisma.deal.count.mockResolvedValue(0)

      const result = await service.findMany(TENANT_ID, USER_ID)
      expect(result.items).toEqual([])
      expect(result.total).toBe(0)
    })
  })

  describe('update()', () => {
    it('updates deal with provided fields', async () => {
      const deal = makeDeal()
      prisma.deal.findFirst.mockResolvedValue(deal)
      prisma.deal.updateMany.mockResolvedValue({ count: 1 })
      prisma.deal.findFirst.mockResolvedValue(deal) // for findOne after update

      await service.update(TENANT_ID, USER_ID, DEAL_ID, {
        title: 'Updated Deal',
        value: 75000,
      })

      expect(prisma.deal.updateMany).toHaveBeenCalledWith({
        where: { id: DEAL_ID, tenantId: TENANT_ID, deletedAt: null },
        data: expect.objectContaining({
          title: 'Updated Deal',
          value: 75000,
          updatedBy: USER_ID,
        }),
      })
    })

    it('throws NotFoundException when deal not found', async () => {
      prisma.deal.findFirst.mockResolvedValue(null)

      await expect(
        service.update(TENANT_ID, USER_ID, 'missing', { title: 'Test' }),
      ).rejects.toThrow(NotFoundException)
    })

    it('does not sync probability when stage changes', async () => {
      const deal = makeDeal()
      prisma.deal.findFirst.mockResolvedValue(deal)
      prisma.dealStage.findFirst.mockResolvedValue({ id: 'new-stage', probability: 50 })
      prisma.deal.updateMany.mockResolvedValue({ count: 1 })
      prisma.deal.findFirst.mockResolvedValue(deal)

      await service.update(TENANT_ID, USER_ID, DEAL_ID, { stageId: 'new-stage' })

      expect(prisma.deal.updateMany).toHaveBeenCalledWith({
        where: { id: DEAL_ID, tenantId: TENANT_ID, deletedAt: null },
        data: expect.not.objectContaining({ probability: expect.any(Number) }),
      })
    })
  })

  describe('delete()', () => {
    it('soft deletes deal', async () => {
      const deal = makeDeal()
      prisma.deal.findFirst.mockResolvedValue(deal)
      prisma.deal.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.delete(TENANT_ID, USER_ID, DEAL_ID)

      expect(result).toBe(true)
      expect(prisma.deal.updateMany).toHaveBeenCalledWith({
        where: { id: DEAL_ID, tenantId: TENANT_ID, deletedAt: null },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          updatedBy: USER_ID,
        }),
      })
    })

    it('throws NotFoundException for already-deleted deal', async () => {
      prisma.deal.findFirst.mockResolvedValue(null)

      await expect(service.delete(TENANT_ID, USER_ID, DEAL_ID)).rejects.toThrow(NotFoundException)
    })
  })

  describe('moveToStage()', () => {
    it('moves deal to valid stage in same tenant', async () => {
      const deal = makeDeal()
      prisma.deal.findFirst.mockResolvedValue(deal)
      prisma.dealStage.findFirst.mockResolvedValue({ id: STAGE_ID })
      prisma.deal.updateMany.mockResolvedValue({ count: 1 })
      prisma.deal.findFirst.mockResolvedValue(deal)

      await service.moveToStage(TENANT_ID, USER_ID, DEAL_ID, STAGE_ID)

      expect(prisma.deal.updateMany).toHaveBeenCalledWith({
        where: { id: DEAL_ID, tenantId: TENANT_ID, deletedAt: null },
        data: expect.objectContaining({
          stageId: STAGE_ID,
          updatedBy: USER_ID,
        }),
      })
    })

    it('throws NotFoundException when target stage not found', async () => {
      prisma.deal.findFirst.mockResolvedValue(makeDeal())
      prisma.dealStage.findFirst.mockResolvedValue(null)

      await expect(
        service.moveToStage(TENANT_ID, USER_ID, DEAL_ID, 'missing-stage'),
      ).rejects.toThrow(NotFoundException)
    })

    it('throws NotFoundException when deal not found', async () => {
      prisma.deal.findFirst.mockResolvedValue(null)

      await expect(
        service.moveToStage(TENANT_ID, USER_ID, 'missing-deal', STAGE_ID),
      ).rejects.toThrow(NotFoundException)
    })

    it('does NOT auto-sync probability from stage (Story 3.3 scope)', async () => {
      const deal = makeDeal({ probability: 10 })
      prisma.deal.findFirst.mockResolvedValue(deal)
      prisma.dealStage.findFirst.mockResolvedValue({ id: 'new-stage', probability: 50 })
      prisma.deal.updateMany.mockResolvedValue({ count: 1 })
      prisma.deal.findFirst.mockResolvedValue(deal)

      await service.moveToStage(TENANT_ID, USER_ID, DEAL_ID, 'new-stage')

      expect(prisma.deal.updateMany).toHaveBeenCalledWith({
        where: { id: DEAL_ID, tenantId: TENANT_ID, deletedAt: null },
        data: expect.not.objectContaining({ probability: expect.any(Number) }),
      })
    })
  })
})
