import { BadRequestException, NotFoundException } from '@nestjs/common'

import { DealsService } from '../deals.service'
import type { ActivityService } from '../../activities/activities.service'
import type { ActivityLogPreferenceService } from '../../activities/activity-log-preference.service'
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
  groupBy: jest.Mock
}

type MockDealStageDelegate = {
  findFirst: jest.Mock
  findMany: jest.Mock
  count: jest.Mock
}

type MockContactDelegate = {
  findFirst: jest.Mock
}

type MockDealLineItemDelegate = {
  count: jest.Mock
}

type MockPrisma = {
  deal: MockDealDelegate
  dealStage: MockDealStageDelegate
  contact: MockContactDelegate
  dealLineItem: MockDealLineItemDelegate
  $transaction: jest.Mock
}

function makePubSub(): { publish: jest.Mock; subscribe: jest.Mock } {
  return { publish: jest.fn(), subscribe: jest.fn() }
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
    winLossReason: null,
    winLossNote: null,
    competitorId: null,
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
      groupBy: jest.fn(),
    },
    dealStage: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    contact: {
      findFirst: jest.fn(),
    },
    dealLineItem: {
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  }
}

describe('DealsService', () => {
  let service: DealsService
  let prisma: MockPrisma
  let audit: { log: jest.Mock }
  let activity: { logSafe: jest.Mock }
  let activityLogPreference: { isEnabled: jest.Mock }

  beforeEach(() => {
    prisma = makePrisma()
    const pubSubMock = makePubSub()
    audit = { log: jest.fn().mockResolvedValue(undefined) }
    activity = { logSafe: jest.fn().mockResolvedValue(null) }
    activityLogPreference = { isEnabled: jest.fn().mockResolvedValue(true) }
    service = new DealsService(
      prisma as unknown as ConstructorParameters<typeof DealsService>[0],
      pubSubMock as never,
      audit as never,
      activity as unknown as ActivityService,
      activityLogPreference as unknown as ActivityLogPreferenceService,
    )
    ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(undefined)
  })

  describe('audit logging (NFR9)', () => {
    it('writes a CREATE audit row when a deal is created', async () => {
      const deal = makeDeal()
      prisma.contact.findFirst.mockResolvedValue({ id: CONTACT_ID })
      prisma.dealStage.findFirst.mockResolvedValue({ id: STAGE_ID, probability: 10 })
      prisma.deal.create.mockResolvedValue(deal)
      prisma.deal.findFirst.mockResolvedValue(deal)

      await service.create(TENANT_ID, USER_ID, {
        title: 'Deal',
        stageId: STAGE_ID,
        contactId: CONTACT_ID,
      })

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          userId: USER_ID,
          action: 'CREATE',
          entity: 'DEAL',
          entityId: deal.id,
        }),
      )
    })

    it('writes a DELETE audit row when a deal is soft-deleted', async () => {
      const deal = makeDeal()
      prisma.deal.findFirst.mockResolvedValue(deal)
      prisma.deal.updateMany.mockResolvedValue({ count: 1 })

      await service.delete(TENANT_ID, USER_ID, deal.id)

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DELETE', entity: 'DEAL', entityId: deal.id }),
      )
    })
  })

  describe('create()', () => {
    it('creates a deal scoped to authenticated tenant with all required fields', async () => {
      const deal = makeDeal()
      prisma.contact.findFirst.mockResolvedValue({ id: CONTACT_ID })
      prisma.dealStage.findFirst.mockResolvedValue({ id: STAGE_ID, probability: 10 })
      prisma.deal.create.mockResolvedValue(deal)
      prisma.deal.findFirst.mockResolvedValue(deal)

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
      prisma.deal.findFirst.mockResolvedValue(makeDeal())

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
      prisma.deal.findFirst.mockResolvedValue(makeDeal({ probability: 25 }))

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
      prisma.deal.findFirst.mockResolvedValue(makeDeal({ title: 'Big Deal' }))

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
      prisma.deal.findFirst.mockResolvedValue(makeDeal({ currency: 'USD' }))

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

    it('rejects clearing value with BadRequestException', async () => {
      prisma.deal.findFirst.mockResolvedValue(makeDeal())

      await expect(service.update(TENANT_ID, USER_ID, DEAL_ID, { value: null })).rejects.toThrow(
        'Value cannot be cleared (non-nullable)',
      )
    })

    it('rejects a negative value on update', async () => {
      prisma.deal.findFirst.mockResolvedValue(makeDeal())
      prisma.dealLineItem.count.mockResolvedValue(0)

      await expect(service.update(TENANT_ID, USER_ID, DEAL_ID, { value: -5 })).rejects.toThrow(
        'Value must be 0 or greater',
      )
    })

    it('rejects clearing probability with BadRequestException', async () => {
      prisma.deal.findFirst.mockResolvedValue(makeDeal())

      await expect(
        service.update(TENANT_ID, USER_ID, DEAL_ID, { probability: null }),
      ).rejects.toThrow('Probability cannot be cleared')
    })

    it('normalizes currency to uppercase on update', async () => {
      prisma.deal.findFirst.mockResolvedValue(makeDeal())
      prisma.deal.updateMany.mockResolvedValue({ count: 1 })

      await service.update(TENANT_ID, USER_ID, DEAL_ID, { currency: ' eur ' })

      expect(prisma.deal.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ currency: 'EUR' }) }),
      )
    })

    it('throws NotFoundException when the new contactId is missing', async () => {
      prisma.deal.findFirst.mockResolvedValue(makeDeal())
      prisma.contact.findFirst.mockResolvedValue(null)

      await expect(
        service.update(TENANT_ID, USER_ID, DEAL_ID, { contactId: 'missing-contact' }),
      ).rejects.toThrow('Contact not found')
    })

    it('accepts a valid new contactId on update', async () => {
      prisma.deal.findFirst.mockResolvedValue(makeDeal())
      prisma.contact.findFirst.mockResolvedValue({ id: 'contact-2' })
      prisma.deal.updateMany.mockResolvedValue({ count: 1 })

      await service.update(TENANT_ID, USER_ID, DEAL_ID, { contactId: 'contact-2' })

      expect(prisma.deal.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ contactId: 'contact-2' }) }),
      )
    })

    it('throws NotFoundException when the new stage is missing', async () => {
      prisma.deal.findFirst.mockResolvedValue(makeDeal())
      prisma.dealStage.findFirst.mockResolvedValue(null)

      await expect(
        service.update(TENANT_ID, USER_ID, DEAL_ID, { stageId: 'missing-stage' }),
      ).rejects.toThrow('Stage not found')
    })

    it('sets expectedCloseDate and actualCloseDate when provided', async () => {
      prisma.deal.findFirst.mockResolvedValue(makeDeal())
      prisma.deal.updateMany.mockResolvedValue({ count: 1 })

      await service.update(TENANT_ID, USER_ID, DEAL_ID, {
        expectedCloseDate: '2026-09-01T00:00:00.000Z',
        actualCloseDate: '2026-08-05T00:00:00.000Z',
      })

      expect(prisma.deal.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            expectedCloseDate: new Date('2026-09-01T00:00:00.000Z'),
            actualCloseDate: new Date('2026-08-05T00:00:00.000Z'),
          }),
        }),
      )
    })

    it('clears expectedCloseDate and actualCloseDate with null', async () => {
      prisma.deal.findFirst.mockResolvedValue(makeDeal())
      prisma.deal.updateMany.mockResolvedValue({ count: 1 })

      await service.update(TENANT_ID, USER_ID, DEAL_ID, {
        expectedCloseDate: null,
        actualCloseDate: null,
      })

      expect(prisma.deal.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ expectedCloseDate: null, actualCloseDate: null }),
        }),
      )
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

  describe('pipelineSummary()', () => {
    it('returns aggregate per stage for tenant active deals', async () => {
      prisma.deal.groupBy.mockResolvedValue([
        { stageId: 'stage-1', _count: { _all: 3 }, _sum: { value: 150000 } },
        { stageId: 'stage-2', _count: { _all: 2 }, _sum: { value: 75000 } },
      ])
      prisma.dealStage.findMany.mockResolvedValue([
        { id: 'stage-1', name: 'Lead' },
        { id: 'stage-2', name: 'Qualified' },
      ])

      const result = await service.pipelineSummary(TENANT_ID, USER_ID, {})

      expect(result).toEqual([
        { stageId: 'stage-1', count: 3, totalValue: 150000 },
        { stageId: 'stage-2', count: 2, totalValue: 75000 },
      ])
    })

    it('applies visibility filter identically to findMany', async () => {
      ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(USER_ID)
      prisma.deal.groupBy.mockResolvedValue([])
      prisma.dealStage.findMany.mockResolvedValue([])

      await service.pipelineSummary(TENANT_ID, USER_ID, {})

      expect(prisma.deal.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([expect.objectContaining({ ownerId: USER_ID })]),
          }),
        }),
      )
    })

    it('filters by stageId', async () => {
      prisma.deal.groupBy.mockResolvedValue([])
      prisma.dealStage.findMany.mockResolvedValue([])

      await service.pipelineSummary(TENANT_ID, USER_ID, { stageId: STAGE_ID })

      expect(prisma.deal.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([expect.objectContaining({ stageId: STAGE_ID })]),
          }),
        }),
      )
    })

    it('filters by ownerId', async () => {
      prisma.deal.groupBy.mockResolvedValue([])
      prisma.dealStage.findMany.mockResolvedValue([])

      await service.pipelineSummary(TENANT_ID, USER_ID, { ownerId: 'owner-1' })

      expect(prisma.deal.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([expect.objectContaining({ ownerId: 'owner-1' })]),
          }),
        }),
      )
    })

    it('filters by expectedCloseDate range', async () => {
      prisma.deal.groupBy.mockResolvedValue([])
      prisma.dealStage.findMany.mockResolvedValue([])

      await service.pipelineSummary(TENANT_ID, USER_ID, {
        expectedCloseDateFrom: '2026-01-01',
        expectedCloseDateTo: '2026-12-31',
      })

      expect(prisma.deal.groupBy).toHaveBeenCalledWith(
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

    it('excludes soft-deleted deals', async () => {
      prisma.deal.groupBy.mockResolvedValue([])
      prisma.dealStage.findMany.mockResolvedValue([])

      await service.pipelineSummary(TENANT_ID, USER_ID, {})

      expect(prisma.deal.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null }),
        }),
      )
    })

    it('stages with zero deals default to count=0 totalValue=0', async () => {
      prisma.deal.groupBy.mockResolvedValue([])
      prisma.dealStage.findMany.mockResolvedValue([
        { id: 'stage-1', name: 'Lead' },
        { id: 'stage-2', name: 'Qualified' },
        { id: 'stage-3', name: 'Proposal' },
      ])

      const result = await service.pipelineSummary(TENANT_ID, USER_ID, {})

      expect(result).toEqual([
        { stageId: 'stage-1', count: 0, totalValue: 0 },
        { stageId: 'stage-2', count: 0, totalValue: 0 },
        { stageId: 'stage-3', count: 0, totalValue: 0 },
      ])
    })

    it('defaults missing _count/_sum gracefully', async () => {
      prisma.deal.groupBy.mockResolvedValue([
        { stageId: 'stage-1', _count: undefined, _sum: undefined },
      ])
      prisma.dealStage.findMany.mockResolvedValue([{ id: 'stage-1', name: 'Lead' }])

      const result = await service.pipelineSummary(TENANT_ID, USER_ID, {})

      expect(result).toEqual([{ stageId: 'stage-1', count: 0, totalValue: 0 }])
    })

    it('tenant-scoped: always includes tenantId in where clause', async () => {
      prisma.deal.groupBy.mockResolvedValue([])
      prisma.dealStage.findMany.mockResolvedValue([])

      await service.pipelineSummary(TENANT_ID, USER_ID, {})

      expect(prisma.deal.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_ID }),
        }),
      )
    })

    it('searches title with case-insensitive contains', async () => {
      prisma.deal.groupBy.mockResolvedValue([])
      prisma.dealStage.findMany.mockResolvedValue([])

      await service.pipelineSummary(TENANT_ID, USER_ID, { search: 'Big' })

      expect(prisma.deal.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({ title: { contains: 'Big', mode: 'insensitive' } }),
            ]),
          }),
        }),
      )
    })
  })

  describe('moveToStage()', () => {
    it('moves deal to valid stage in same tenant', async () => {
      const deal = makeDeal()
      prisma.deal.findFirst.mockResolvedValue(deal)
      prisma.dealStage.findFirst.mockResolvedValue({ id: STAGE_ID, isWon: false, isLost: false })
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

    it('auto-syncs probability from target stage on moveToStage', async () => {
      const deal = makeDeal({ probability: 10 })
      prisma.deal.findFirst.mockResolvedValue(deal)
      prisma.dealStage.findFirst.mockResolvedValue({
        id: 'new-stage',
        probability: 50,
        isWon: false,
        isLost: false,
      })
      prisma.deal.updateMany.mockResolvedValue({ count: 1 })
      prisma.deal.findFirst.mockResolvedValue(deal)

      await service.moveToStage(TENANT_ID, USER_ID, DEAL_ID, 'new-stage')

      expect(prisma.deal.updateMany).toHaveBeenCalledWith({
        where: { id: DEAL_ID, tenantId: TENANT_ID, deletedAt: null },
        data: expect.objectContaining({ probability: 50 }),
      })
    })

    it('sets actualCloseDate to now when moving to a won stage', async () => {
      const deal = makeDeal()
      prisma.deal.findFirst.mockResolvedValue(deal)
      prisma.dealStage.findFirst.mockResolvedValue({
        id: 'won-stage',
        probability: 100,
        isWon: true,
        isLost: false,
      })
      prisma.deal.updateMany.mockResolvedValue({ count: 1 })
      prisma.deal.findFirst.mockResolvedValue(deal)

      await service.moveToStage(TENANT_ID, USER_ID, DEAL_ID, 'won-stage')

      expect(prisma.deal.updateMany).toHaveBeenCalledWith({
        where: { id: DEAL_ID, tenantId: TENANT_ID, deletedAt: null },
        data: expect.objectContaining({ actualCloseDate: expect.any(Date) }),
      })
    })

    it('sets actualCloseDate to now when moving to a lost stage', async () => {
      const deal = makeDeal()
      prisma.deal.findFirst.mockResolvedValue(deal)
      prisma.dealStage.findFirst.mockResolvedValue({
        id: 'lost-stage',
        probability: 0,
        isWon: false,
        isLost: true,
      })
      prisma.deal.updateMany.mockResolvedValue({ count: 1 })
      prisma.deal.findFirst.mockResolvedValue(deal)

      await service.moveToStage(TENANT_ID, USER_ID, DEAL_ID, 'lost-stage')

      expect(prisma.deal.updateMany).toHaveBeenCalledWith({
        where: { id: DEAL_ID, tenantId: TENANT_ID, deletedAt: null },
        data: expect.objectContaining({ actualCloseDate: expect.any(Date) }),
      })
    })

    it('clears actualCloseDate to null when moving back to an open stage', async () => {
      const deal = makeDeal({ actualCloseDate: new Date('2026-07-15') })
      prisma.deal.findFirst.mockResolvedValue(deal)
      prisma.dealStage.findFirst.mockResolvedValue({
        id: 'open-stage',
        probability: 25,
        isWon: false,
        isLost: false,
      })
      prisma.deal.updateMany.mockResolvedValue({ count: 1 })
      prisma.deal.findFirst.mockResolvedValue(deal)

      await service.moveToStage(TENANT_ID, USER_ID, DEAL_ID, 'open-stage')

      expect(prisma.deal.updateMany).toHaveBeenCalledWith({
        where: { id: DEAL_ID, tenantId: TENANT_ID, deletedAt: null },
        data: expect.objectContaining({ actualCloseDate: null }),
      })
    })
  })

  describe('normalizeProbability (create)', () => {
    it('accepts valid probability 0', async () => {
      prisma.contact.findFirst.mockResolvedValue({ id: CONTACT_ID })
      prisma.dealStage.findFirst.mockResolvedValue({ id: STAGE_ID, probability: 10 })
      prisma.deal.create.mockResolvedValue(makeDeal({ probability: 0 }))
      prisma.deal.findFirst.mockResolvedValue(makeDeal({ probability: 0 }))

      const result = await service.create(TENANT_ID, USER_ID, {
        title: 'Test',
        probability: 0,
        stageId: STAGE_ID,
        contactId: CONTACT_ID,
      })
      expect(result.probability).toBe(0)
    })

    it('accepts valid probability 100', async () => {
      prisma.contact.findFirst.mockResolvedValue({ id: CONTACT_ID })
      prisma.dealStage.findFirst.mockResolvedValue({ id: STAGE_ID, probability: 10 })
      prisma.deal.create.mockResolvedValue(makeDeal({ probability: 100 }))
      prisma.deal.findFirst.mockResolvedValue(makeDeal({ probability: 100 }))

      const result = await service.create(TENANT_ID, USER_ID, {
        title: 'Test',
        probability: 100,
        stageId: STAGE_ID,
        contactId: CONTACT_ID,
      })
      expect(result.probability).toBe(100)
    })

    it('rejects probability below 0 on create', async () => {
      prisma.contact.findFirst.mockResolvedValue({ id: CONTACT_ID })
      prisma.dealStage.findFirst.mockResolvedValue({ id: STAGE_ID, probability: 10 })

      await expect(
        service.create(TENANT_ID, USER_ID, {
          title: 'Test',
          probability: -1,
          stageId: STAGE_ID,
          contactId: CONTACT_ID,
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects probability above 100 on create', async () => {
      prisma.contact.findFirst.mockResolvedValue({ id: CONTACT_ID })
      prisma.dealStage.findFirst.mockResolvedValue({ id: STAGE_ID, probability: 10 })

      await expect(
        service.create(TENANT_ID, USER_ID, {
          title: 'Test',
          probability: 101,
          stageId: STAGE_ID,
          contactId: CONTACT_ID,
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects non-integer probability on create', async () => {
      prisma.contact.findFirst.mockResolvedValue({ id: CONTACT_ID })
      prisma.dealStage.findFirst.mockResolvedValue({ id: STAGE_ID, probability: 10 })

      await expect(
        service.create(TENANT_ID, USER_ID, {
          title: 'Test',
          probability: 50.5,
          stageId: STAGE_ID,
          contactId: CONTACT_ID,
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects NaN probability on create', async () => {
      prisma.contact.findFirst.mockResolvedValue({ id: CONTACT_ID })
      prisma.dealStage.findFirst.mockResolvedValue({ id: STAGE_ID, probability: 10 })

      await expect(
        service.create(TENANT_ID, USER_ID, {
          title: 'Test',
          probability: NaN,
          stageId: STAGE_ID,
          contactId: CONTACT_ID,
        }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('normalizeProbability (update)', () => {
    it('rejects probability below 0 on update', async () => {
      const deal = makeDeal()
      prisma.deal.findFirst.mockResolvedValue(deal)

      await expect(
        service.update(TENANT_ID, USER_ID, DEAL_ID, { probability: -1 }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects probability above 100 on update', async () => {
      const deal = makeDeal()
      prisma.deal.findFirst.mockResolvedValue(deal)

      await expect(
        service.update(TENANT_ID, USER_ID, DEAL_ID, { probability: 150 }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects non-integer probability on update', async () => {
      const deal = makeDeal()
      prisma.deal.findFirst.mockResolvedValue(deal)

      await expect(
        service.update(TENANT_ID, USER_ID, DEAL_ID, { probability: 75.5 }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('auto-logging deal events (Story 4.2)', () => {
    it('create() logs DEAL_CREATED on the deal contact with dedupeKey and metadata (AC 24 / UD1)', async () => {
      const deal = makeDeal()
      prisma.contact.findFirst.mockResolvedValue({ id: CONTACT_ID })
      prisma.dealStage.findFirst.mockResolvedValue({ id: STAGE_ID, probability: 10 })
      prisma.deal.create.mockResolvedValue(deal)
      prisma.deal.findFirst.mockResolvedValue(deal)

      await service.create(TENANT_ID, USER_ID, {
        title: 'Big Deal',
        stageId: STAGE_ID,
        contactId: CONTACT_ID,
      })

      expect(activity.logSafe).toHaveBeenCalledTimes(1)
      expect(activity.logSafe).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          contactId: CONTACT_ID,
          type: 'DEAL_CREATED',
          title: 'Deal created: Big Deal',
          source: 'DEAL',
          sourceId: DEAL_ID,
          dedupeKey: `DEAL_CREATED:${DEAL_ID}`,
          createdBy: USER_ID,
          metadata: expect.objectContaining({
            dealId: DEAL_ID,
            value: 50000,
            currency: 'USD',
            stageId: STAGE_ID,
            ownerId: USER_ID,
          }),
        }),
      )
    })

    it('create() is suppressed when logDealCreated is off (UD6)', async () => {
      activityLogPreference.isEnabled.mockResolvedValue(false)
      const deal = makeDeal()
      prisma.contact.findFirst.mockResolvedValue({ id: CONTACT_ID })
      prisma.dealStage.findFirst.mockResolvedValue({ id: STAGE_ID, probability: 10 })
      prisma.deal.create.mockResolvedValue(deal)
      prisma.deal.findFirst.mockResolvedValue(deal)

      const result = await service.create(TENANT_ID, USER_ID, {
        title: 'Big Deal',
        stageId: STAGE_ID,
        contactId: CONTACT_ID,
      })

      expect(result.id).toBe(DEAL_ID)
      expect(activity.logSafe).not.toHaveBeenCalled()
      expect(activityLogPreference.isEnabled).toHaveBeenCalledWith(
        TENANT_ID,
        USER_ID,
        'logDealCreated',
      )
    })

    it('moveToStage() logs DEAL_STAGE_CHANGED with stage names and dedupeKey pattern (AC 25 / UD2)', async () => {
      const toStage = { id: 'stage-2', name: 'Qualified' }
      const currentDeal = {
        ...makeDeal({ stageId: 'stage-1' }),
        stage: { id: 'stage-1', name: 'Lead' },
      }
      const movedDeal = {
        ...makeDeal({ stageId: 'stage-2' }),
        stage: { id: 'stage-2', name: 'Qualified' },
      }
      prisma.deal.findFirst.mockResolvedValueOnce(currentDeal).mockResolvedValueOnce(movedDeal)
      prisma.dealStage.findFirst.mockResolvedValue(toStage)
      prisma.deal.updateMany.mockResolvedValue({ count: 1 })

      await service.moveToStage(TENANT_ID, USER_ID, DEAL_ID, 'stage-2')

      expect(activity.logSafe).toHaveBeenCalledTimes(1)
      expect(activity.logSafe).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          contactId: CONTACT_ID,
          type: 'DEAL_STAGE_CHANGED',
          title: 'Deal moved to Qualified',
          description: 'Lead → Qualified',
          source: 'DEAL',
          sourceId: DEAL_ID,
          createdBy: USER_ID,
          metadata: expect.objectContaining({
            dealId: DEAL_ID,
            fromStageId: 'stage-1',
            toStageId: 'stage-2',
          }),
          dedupeKey: expect.stringMatching(/^DEAL_STAGE:deal-1:stage-2:\d{4}-\d{2}-\d{2}T/),
        }),
      )
    })

    it('moveToStage() is suppressed when logDealStageChanged is off (UD7)', async () => {
      activityLogPreference.isEnabled.mockResolvedValue(false)
      const currentDeal = {
        ...makeDeal({ stageId: 'stage-1' }),
        stage: { id: 'stage-1', name: 'Lead' },
      }
      const movedDeal = {
        ...makeDeal({ stageId: 'stage-2' }),
        stage: { id: 'stage-2', name: 'Qualified' },
      }
      prisma.deal.findFirst.mockResolvedValueOnce(currentDeal).mockResolvedValueOnce(movedDeal)
      prisma.dealStage.findFirst.mockResolvedValue({ id: 'stage-2', name: 'Qualified' })
      prisma.deal.updateMany.mockResolvedValue({ count: 1 })

      await service.moveToStage(TENANT_ID, USER_ID, DEAL_ID, 'stage-2')

      expect(activity.logSafe).not.toHaveBeenCalled()
    })

    it('update() logs nothing — field-level edits are out of scope (AC 26 / UD3)', async () => {
      prisma.deal.findFirst.mockResolvedValue(makeDeal())
      prisma.deal.updateMany.mockResolvedValue({ count: 1 })
      prisma.dealLineItem.count.mockResolvedValue(0)

      await service.update(TENANT_ID, USER_ID, DEAL_ID, { title: 'Renamed Deal' })

      expect(activity.logSafe).not.toHaveBeenCalled()
    })

    it('delete() logs nothing (AC 26 / UD4)', async () => {
      prisma.deal.findFirst.mockResolvedValue(makeDeal())
      prisma.deal.updateMany.mockResolvedValue({ count: 1 })

      await service.delete(TENANT_ID, USER_ID, DEAL_ID)

      expect(activity.logSafe).not.toHaveBeenCalled()
    })

    it('publishDealUpdate() logs nothing (UD5)', async () => {
      service.publishDealUpdate(TENANT_ID, makeDeal())

      expect(activity.logSafe).not.toHaveBeenCalled()
    })
  })
})
