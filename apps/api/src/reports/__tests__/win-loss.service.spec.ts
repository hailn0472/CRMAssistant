import { BadRequestException } from '@nestjs/common'

import { WinLossService } from '../win-loss.service'

type MockDealDelegate = {
  findMany: jest.Mock
}

type MockPrisma = {
  deal: MockDealDelegate
}

function makePrisma(): MockPrisma {
  return {
    deal: {
      findMany: jest.fn(),
    },
  }
}

function makeDealsService(): {
  buildDealWhere: jest.Mock
  findMany: jest.Mock
} {
  return {
    buildDealWhere: jest.fn().mockResolvedValue({ tenantId: TENANT_ID, deletedAt: null }),
    findMany: jest.fn(),
  }
}

const TENANT_ID = 'tenant-1'
const USER_ID = 'user-1'

function makeDeal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'd1',
    value: 10000,
    currency: 'USD',
    winLossReason: null,
    competitorId: null,
    stage: { isWon: false, isLost: false },
    competitor: null,
    ...overrides,
  }
}

describe('WinLossService', () => {
  let service: WinLossService
  let prisma: MockPrisma
  let dealsService: ReturnType<typeof makeDealsService>

  beforeEach(() => {
    prisma = makePrisma()
    dealsService = makeDealsService()
    service = new WinLossService(
      prisma as unknown as ConstructorParameters<typeof WinLossService>[0],
      dealsService as unknown as ConstructorParameters<typeof WinLossService>[1],
    )
  })

  describe('date range validation (AC #23)', () => {
    it('rejects an invalid startDate via parseDateOrThrow', async () => {
      await expect(
        service.winLossAnalysis(TENANT_ID, USER_ID, {
          startDate: 'invalid',
          endDate: '2026-09-01',
        }),
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.winLossAnalysis(TENANT_ID, USER_ID, {
          startDate: 'invalid',
          endDate: '2026-09-01',
        }),
      ).rejects.toThrow('Invalid date: startDate')
    })

    it('rejects an invalid endDate via parseDateOrThrow', async () => {
      await expect(
        service.winLossAnalysis(TENANT_ID, USER_ID, { startDate: '2026-01-01', endDate: 'nope' }),
      ).rejects.toThrow('Invalid date: endDate')
    })

    it('rejects endDate before startDate', async () => {
      await expect(
        service.winLossAnalysis(TENANT_ID, USER_ID, {
          startDate: '2026-02-01',
          endDate: '2026-01-01',
        }),
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.winLossAnalysis(TENANT_ID, USER_ID, {
          startDate: '2026-02-01',
          endDate: '2026-01-01',
        }),
      ).rejects.toThrow('endDate must be >= startDate')
    })

    it('rejects a range over 36 months', async () => {
      await expect(
        service.winLossAnalysis(TENANT_ID, USER_ID, {
          startDate: '2023-01-01',
          endDate: '2026-02-01',
        }),
      ).rejects.toThrow('Win/loss range must not exceed 36 months')
    })

    it('allows a range of exactly 36 months', async () => {
      prisma.deal.findMany.mockResolvedValue([])
      await expect(
        service.winLossAnalysis(TENANT_ID, USER_ID, {
          startDate: '2023-01-01',
          endDate: '2026-01-01',
        }),
      ).resolves.toBeDefined()
    })

    it('allows a single-day range (startDate === endDate)', async () => {
      prisma.deal.findMany.mockResolvedValue([])
      const result = await service.winLossAnalysis(TENANT_ID, USER_ID, {
        startDate: '2026-07-01',
        endDate: '2026-07-01',
      })
      expect(result.totalClosed).toBe(0)
    })
  })

  describe('where construction (AC #22)', () => {
    it('reuses buildDealWhere with ownerId for the base visibility filter', async () => {
      prisma.deal.findMany.mockResolvedValue([])
      await service.winLossAnalysis(TENANT_ID, USER_ID, {
        startDate: '2026-01-01',
        endDate: '2026-06-30',
        ownerId: 'owner-1',
      })
      expect(dealsService.buildDealWhere).toHaveBeenCalledWith(TENANT_ID, USER_ID, {
        ownerId: 'owner-1',
      })
    })

    it('narrows with actualCloseDate (inclusive end-of-day) and closed-stage OR', async () => {
      prisma.deal.findMany.mockResolvedValue([])
      await service.winLossAnalysis(TENANT_ID, USER_ID, {
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      })
      expect(prisma.deal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: TENANT_ID,
            deletedAt: null,
            actualCloseDate: {
              gte: new Date('2026-01-01T00:00:00.000Z'),
              lte: new Date('2026-01-31T23:59:59.999Z'),
            },
            stage: { OR: [{ isWon: true }, { isLost: true }] },
          }),
        }),
      )
    })

    it('fetches via prisma.deal.findMany directly, never DealsService.findMany', async () => {
      prisma.deal.findMany.mockResolvedValue([])
      await service.winLossAnalysis(TENANT_ID, USER_ID, {
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      })
      expect(prisma.deal.findMany).toHaveBeenCalledTimes(1)
      expect(dealsService.findMany).not.toHaveBeenCalled()
    })

    it('appends the teamId filter to AND like forecast.service.ts', async () => {
      dealsService.buildDealWhere.mockResolvedValue({
        tenantId: TENANT_ID,
        deletedAt: null,
        AND: [{ ownerId: USER_ID }],
      })
      prisma.deal.findMany.mockResolvedValue([])
      await service.winLossAnalysis(TENANT_ID, USER_ID, {
        startDate: '2026-01-01',
        endDate: '2026-06-30',
        teamId: 'team-1',
      })
      expect(prisma.deal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              { ownerId: USER_ID },
              { owner: { teamId: 'team-1', deletedAt: null } },
            ]),
          }),
        }),
      )
    })

    it('selects every field the refs expose (AC #20)', async () => {
      prisma.deal.findMany.mockResolvedValue([])
      await service.winLossAnalysis(TENANT_ID, USER_ID, {
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      })
      expect(prisma.deal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            id: true,
            value: true,
            currency: true,
            winLossReason: true,
            competitorId: true,
            stage: { select: { isWon: true, isLost: true } },
            competitor: { select: { id: true, name: true } },
          }),
        }),
      )
    })

    it('narrows by stage/product/currency filters (story 6.2 focused regression fix, AC 24/28/40/30)', async () => {
      prisma.deal.findMany.mockResolvedValue([])
      await service.winLossAnalysis(TENANT_ID, USER_ID, {
        startDate: '2026-01-01',
        endDate: '2026-06-30',
        stageId: 'stage-7',
        productId: 'product-9',
        currency: 'EUR',
      })
      expect(prisma.deal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              { stageId: 'stage-7' },
              { lineItems: { some: { productId: 'product-9', deletedAt: null } } },
              { currency: 'EUR' },
            ]),
          }),
        }),
      )
    })

    it('leaves the predicate un-narrowed when the optional filters are absent', async () => {
      prisma.deal.findMany.mockResolvedValue([])
      await service.winLossAnalysis(TENANT_ID, USER_ID, {
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      })
      const where = (prisma.deal.findMany.mock.calls[0][0] as { where: Record<string, unknown> })
        .where
      expect(where.stageId).toBeUndefined()
      expect(where.currency).toBeUndefined()
      expect(where.lineItems).toBeUndefined()
    })
  })

  describe('math and reduce (AC #24)', () => {
    it('returns winRate 0 when nothing is closed (no division by zero)', async () => {
      prisma.deal.findMany.mockResolvedValue([])
      const result = await service.winLossAnalysis(TENANT_ID, USER_ID, {
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      })
      expect(result).toEqual({
        totalClosed: 0,
        wonCount: 0,
        lostCount: 0,
        winRate: 0,
        wonValue: 0,
        lostValue: 0,
        currency: 'USD',
        lossReasons: [],
        winReasons: [],
        competitors: [],
      })
    })

    it('computes winRate = wonCount / totalClosed * 100 rounded to 1 decimal', async () => {
      const won = makeDeal({ id: 'd1', value: 1000, stage: { isWon: true, isLost: false } })
      const won2 = makeDeal({ id: 'd2', value: 2000, stage: { isWon: true, isLost: false } })
      const lost = makeDeal({ id: 'd3', value: 500, stage: { isWon: false, isLost: true } })
      prisma.deal.findMany.mockResolvedValue([won, won2, lost])
      const result = await service.winLossAnalysis(TENANT_ID, USER_ID, {
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      })
      expect(result.totalClosed).toBe(3)
      expect(result.wonCount).toBe(2)
      expect(result.lostCount).toBe(1)
      expect(result.winRate).toBe(66.7) // 2/3*100 = 66.666... → 66.7
      expect(result.wonValue).toBe(3000)
      expect(result.lostValue).toBe(500)
    })

    it('uses wonCount / totalClosed, not wonCount / (wonCount + lostCount) — same thing but explicit', async () => {
      // 3 won, 2 lost → 3/5 = 60.0
      const deals = [
        makeDeal({ id: 'a', stage: { isWon: true, isLost: false } }),
        makeDeal({ id: 'b', stage: { isWon: true, isLost: false } }),
        makeDeal({ id: 'c', stage: { isWon: true, isLost: false } }),
        makeDeal({ id: 'd', stage: { isWon: false, isLost: true } }),
        makeDeal({ id: 'e', stage: { isWon: false, isLost: true } }),
      ]
      prisma.deal.findMany.mockResolvedValue(deals)
      const result = await service.winLossAnalysis(TENANT_ID, USER_ID, {
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      })
      expect(result.winRate).toBe(60)
    })

    it('computes reason bucket percentage relative to its own side', async () => {
      const deals = [
        // Won side: 2 PRICE, 1 FEATURES (3 total)
        makeDeal({
          id: 'w1',
          winLossReason: 'PRICE',
          stage: { isWon: true, isLost: false },
        }),
        makeDeal({
          id: 'w2',
          winLossReason: 'PRICE',
          stage: { isWon: true, isLost: false },
        }),
        makeDeal({
          id: 'w3',
          winLossReason: 'FEATURES',
          stage: { isWon: true, isLost: false },
        }),
        // Lost side: 1 PRICE, 1 BUDGET (2 total)
        makeDeal({
          id: 'l1',
          winLossReason: 'PRICE',
          stage: { isWon: false, isLost: true },
        }),
        makeDeal({
          id: 'l2',
          winLossReason: 'BUDGET',
          stage: { isWon: false, isLost: true },
        }),
      ]
      prisma.deal.findMany.mockResolvedValue(deals)
      const result = await service.winLossAnalysis(TENANT_ID, USER_ID, {
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      })
      expect(result.winReasons).toEqual([
        { reason: 'PRICE', count: 2, totalValue: 20000, percentage: 66.7 },
        { reason: 'FEATURES', count: 1, totalValue: 10000, percentage: 33.3 },
      ])
      expect(result.lossReasons).toEqual([
        { reason: 'BUDGET', count: 1, totalValue: 10000, percentage: 50 },
        { reason: 'PRICE', count: 1, totalValue: 10000, percentage: 50 },
      ])
    })

    it('a closed deal with a null reason counts but produces no reason bucket', async () => {
      const deals = [
        makeDeal({ id: 'w1', winLossReason: null, stage: { isWon: true, isLost: false } }),
        makeDeal({
          id: 'w2',
          winLossReason: 'PRICE',
          stage: { isWon: true, isLost: false },
        }),
        makeDeal({
          id: 'l1',
          winLossReason: null,
          stage: { isWon: false, isLost: true },
        }),
      ]
      prisma.deal.findMany.mockResolvedValue(deals)
      const result = await service.winLossAnalysis(TENANT_ID, USER_ID, {
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      })
      expect(result.wonCount).toBe(2)
      expect(result.lostCount).toBe(1)
      expect(result.winReasons).toEqual([
        { reason: 'PRICE', count: 1, totalValue: 10000, percentage: 50 },
      ])
      expect(result.lossReasons).toEqual([])
    })

    it('loss bucket percentages are 0 when lostCount is 0 (no division by zero)', async () => {
      const deals = [
        makeDeal({
          id: 'w1',
          winLossReason: 'FEATURES',
          stage: { isWon: true, isLost: false },
        }),
      ]
      prisma.deal.findMany.mockResolvedValue(deals)
      const result = await service.winLossAnalysis(TENANT_ID, USER_ID, {
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      })
      expect(result.lossReasons).toEqual([])
    })

    it('aggregates competitor outcomes with per-competitor win rate', async () => {
      const deals = [
        makeDeal({
          id: 'w1',
          value: 5000,
          competitorId: 'c1',
          competitor: { id: 'c1', name: 'Acme' },
          stage: { isWon: true, isLost: false },
        }),
        makeDeal({
          id: 'l1',
          value: 3000,
          competitorId: 'c1',
          competitor: { id: 'c1', name: 'Acme' },
          stage: { isWon: false, isLost: true },
        }),
        makeDeal({
          id: 'l2',
          value: 9000,
          competitorId: 'c2',
          competitor: { id: 'c2', name: 'Globex' },
          stage: { isWon: false, isLost: true },
        }),
      ]
      prisma.deal.findMany.mockResolvedValue(deals)
      const result = await service.winLossAnalysis(TENANT_ID, USER_ID, {
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      })
      // sorted by totalValue desc: Globex (9000) before Acme (8000)
      expect(result.competitors).toEqual([
        {
          competitorId: 'c2',
          competitorName: 'Globex',
          wonCount: 0,
          lostCount: 1,
          winRate: 0,
          totalValue: 9000,
        },
        {
          competitorId: 'c1',
          competitorName: 'Acme',
          wonCount: 1,
          lostCount: 1,
          winRate: 50,
          totalValue: 8000,
        },
      ])
    })

    it('detects the most frequent currency across closed deals', async () => {
      const deals = [
        makeDeal({ id: 'w1', currency: 'EUR', stage: { isWon: true, isLost: false } }),
        makeDeal({ id: 'w2', currency: 'EUR', stage: { isWon: true, isLost: false } }),
        makeDeal({ id: 'l1', currency: 'USD', stage: { isWon: false, isLost: true } }),
      ]
      prisma.deal.findMany.mockResolvedValue(deals)
      const result = await service.winLossAnalysis(TENANT_ID, USER_ID, {
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      })
      expect(result.currency).toBe('EUR')
    })
  })
})
