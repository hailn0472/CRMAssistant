import { BadRequestException } from '@nestjs/common'

import { ForecastService } from '../forecast.service'

jest.mock('../../common/guards/visibility-check', () => ({
  resolveVisibilityFilter: jest.fn(),
  registerVisibilityService: jest.fn(),
}))

import { resolveVisibilityFilter } from '../../common/guards/visibility-check'

// ─── Types ───────────────────────────────────────────────────────────────────

type MockDealDelegate = {
  findMany: jest.Mock
  aggregate: jest.Mock
}

type MockForecastSnapshotDelegate = {
  findFirst: jest.Mock
  upsert: jest.Mock
}

type MockPrisma = {
  deal: MockDealDelegate
  forecastSnapshot: MockForecastSnapshotDelegate
}

function makeMockDeal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'd1',
    value: 10000,
    probability: 50,
    expectedCloseDate: new Date('2026-08-15T00:00:00.000Z'),
    ownerId: 'u1',
    currency: 'USD',
    owner: {
      id: 'u1',
      firstName: 'Alice',
      lastName: 'Smith',
      teamId: 't1',
      team: { id: 't1', name: 'Team Alpha' },
    },
    ...overrides,
  }
}

function makePrisma(): MockPrisma {
  return {
    deal: {
      findMany: jest.fn(),
      aggregate: jest.fn(),
    },
    forecastSnapshot: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
  }
}

const TENANT_ID = 'tenant-1'
const USER_ID = 'user-1'
const NOW = new Date('2026-07-30T00:00:00.000Z')

function makeMockDealsService(): {
  buildDealWhere: jest.Mock
  findMany: jest.Mock
  pipelineSummary: jest.Mock
} {
  return {
    buildDealWhere: jest.fn(),
    findMany: jest.fn(),
    pipelineSummary: jest.fn(),
  }
}

describe('ForecastService', () => {
  let service: ForecastService
  let prisma: MockPrisma
  let dealsService: ReturnType<typeof makeMockDealsService>

  beforeEach(() => {
    prisma = makePrisma()
    dealsService = makeMockDealsService()
    ;(resolveVisibilityFilter as jest.Mock).mockResolvedValue(undefined)

    jest.useFakeTimers()
    jest.setSystemTime(NOW)

    service = new ForecastService(
      prisma as unknown as ConstructorParameters<typeof ForecastService>[0],
      dealsService as unknown as ConstructorParameters<typeof ForecastService>[1],
    )
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.clearAllMocks()
  })

  describe('salesForecast', () => {
    it('validates startDate/endDate are parseable', async () => {
      dealsService.buildDealWhere.mockResolvedValue({ tenantId: TENANT_ID, deletedAt: null })

      await expect(
        service.salesForecast(TENANT_ID, USER_ID, {
          startDate: 'invalid',
          endDate: '2026-09-01',
          groupBy: 'MONTH',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects endDate before startDate', async () => {
      dealsService.buildDealWhere.mockResolvedValue({ tenantId: TENANT_ID, deletedAt: null })

      await expect(
        service.salesForecast(TENANT_ID, USER_ID, {
          startDate: '2026-09-01',
          endDate: '2026-08-01',
          groupBy: 'MONTH',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects range exceeding 36 months', async () => {
      dealsService.buildDealWhere.mockResolvedValue({ tenantId: TENANT_ID, deletedAt: null })

      await expect(
        service.salesForecast(TENANT_ID, USER_ID, {
          startDate: '2026-01-01',
          endDate: '2029-02-01',
          groupBy: 'MONTH',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('accepts range of exactly 36 months', async () => {
      dealsService.buildDealWhere.mockResolvedValue({ tenantId: TENANT_ID, deletedAt: null })
      prisma.deal.findMany.mockResolvedValue([])

      const result = await service.salesForecast(TENANT_ID, USER_ID, {
        startDate: '2026-01-01',
        endDate: '2028-12-31',
        groupBy: 'MONTH',
      })

      expect(result.buckets.length).toBe(36)
    })

    it('buckets by MONTH with dense zero-filled periods', async () => {
      dealsService.buildDealWhere.mockResolvedValue({ tenantId: TENANT_ID, deletedAt: null })
      prisma.deal.findMany.mockResolvedValue([
        makeMockDeal({
          id: 'd1',
          value: 10000,
          probability: 50,
          expectedCloseDate: new Date('2026-08-15'),
          currency: 'USD',
          owner: {
            id: 'u1',
            firstName: 'Alice',
            lastName: 'Smith',
            teamId: 't1',
            team: { id: 't1', name: 'Team Alpha' },
          },
        }),
      ])

      const result = await service.salesForecast(TENANT_ID, USER_ID, {
        startDate: '2026-08-01',
        endDate: '2026-10-01',
        groupBy: 'MONTH',
      })

      expect(result.buckets).toHaveLength(3)
      expect(result.buckets[0]).toMatchObject({
        key: '2026-08',
        label: 'Aug 2026',
        weightedValue: 5000, // 10000 * 50 / 100
        totalValue: 10000,
        count: 1,
      })
      expect(result.buckets[1]).toMatchObject({
        key: '2026-09',
        weightedValue: 0,
        totalValue: 0,
        count: 0,
      })
      expect(result.buckets[2]).toMatchObject({
        key: '2026-10',
        weightedValue: 0,
        totalValue: 0,
        count: 0,
      })
    })

    it('buckets by QUARTER with dense zero-filled periods', async () => {
      dealsService.buildDealWhere.mockResolvedValue({ tenantId: TENANT_ID, deletedAt: null })
      prisma.deal.findMany.mockResolvedValue([
        makeMockDeal({
          id: 'd1',
          value: 10000,
          probability: 50,
          expectedCloseDate: new Date('2026-08-15'),
          currency: 'USD',
          owner: {
            id: 'u1',
            firstName: 'Alice',
            lastName: 'Smith',
            teamId: 't1',
            team: { id: 't1', name: 'Team Alpha' },
          },
        }),
      ])

      const result = await service.salesForecast(TENANT_ID, USER_ID, {
        startDate: '2026-07-01',
        endDate: '2026-12-31',
        groupBy: 'QUARTER',
      })

      expect(result.buckets).toHaveLength(2)
      expect(result.buckets[0]).toMatchObject({
        key: '2026-Q3',
        label: 'Q3 2026',
        weightedValue: 5000,
        totalValue: 10000,
        count: 1,
      })
      expect(result.buckets[1]).toMatchObject({
        key: '2026-Q4',
        weightedValue: 0,
        totalValue: 0,
        count: 0,
      })
    })

    it('buckets by OWNER (sparse)', async () => {
      dealsService.buildDealWhere.mockResolvedValue({ tenantId: TENANT_ID, deletedAt: null })
      prisma.deal.findMany.mockResolvedValue([
        makeMockDeal({
          id: 'd1',
          value: 10000,
          probability: 50,
          expectedCloseDate: new Date('2026-08-15'),
          ownerId: 'u1',
          owner: {
            id: 'u1',
            firstName: 'Alice',
            lastName: 'Smith',
            teamId: 't1',
            team: { id: 't1', name: 'Team Alpha' },
          },
        }),
        makeMockDeal({
          id: 'd2',
          value: 20000,
          probability: 75,
          expectedCloseDate: new Date('2026-09-15'),
          ownerId: 'u2',
          currency: 'EUR',
          owner: {
            id: 'u2',
            firstName: 'Bob',
            lastName: 'Jones',
            teamId: 't1',
            team: { id: 't1', name: 'Team Alpha' },
          },
        }),
      ])

      const result = await service.salesForecast(TENANT_ID, USER_ID, {
        startDate: '2026-08-01',
        endDate: '2026-10-01',
        groupBy: 'OWNER',
      })

      expect(result.buckets).toHaveLength(2)
      // Sorted by weightedValue descending — Bob (15000) before Alice (5000)
      expect(result.buckets[0].key).toBe('u2')
      expect(result.buckets[0].weightedValue).toBe(15000)
      expect(result.buckets[1].key).toBe('u1')
      expect(result.buckets[1].weightedValue).toBe(5000)
    })

    it('buckets by TEAM in sparse mode', async () => {
      dealsService.buildDealWhere.mockResolvedValue({ tenantId: TENANT_ID, deletedAt: null })
      prisma.deal.findMany.mockResolvedValue([
        makeMockDeal({
          id: 'd1',
          value: 10000,
          probability: 50,
          expectedCloseDate: new Date('2026-08-15'),
          ownerId: 'u1',
          owner: {
            id: 'u1',
            firstName: 'Alice',
            lastName: 'Smith',
            teamId: 't1',
            team: { id: 't1', name: 'Team Alpha' },
          },
        }),
        makeMockDeal({
          id: 'd2',
          value: 20000,
          probability: 75,
          expectedCloseDate: new Date('2026-09-15'),
          ownerId: 'u3',
          currency: 'EUR',
          owner: { id: 'u3', firstName: 'Charlie', lastName: 'Brown', teamId: null, team: null },
        }),
      ])

      const result = await service.salesForecast(TENANT_ID, USER_ID, {
        startDate: '2026-08-01',
        endDate: '2026-10-01',
        groupBy: 'TEAM',
      })

      expect(result.buckets).toHaveLength(2)
      // Sort by weightedValue desc (unassigned's d2 = 15000 > Team Alpha's d1 = 5000)
      expect(result.buckets[0].key).toBe('unassigned')
      expect(result.buckets[0].label).toBe('No team')
      expect(result.buckets[1].key).toBe('t1')
      expect(result.buckets[1].label).toBe('Team Alpha')
    })

    it('computes nested bands (commit ⊆ bestCase ⊆ pipeline)', async () => {
      dealsService.buildDealWhere.mockResolvedValue({ tenantId: TENANT_ID, deletedAt: null })
      prisma.deal.findMany.mockResolvedValue([
        makeMockDeal({
          id: 'd1',
          value: 10000,
          probability: 80,
          expectedCloseDate: new Date('2026-08-15'),
          currency: 'USD',
          owner: {
            id: 'u1',
            firstName: 'Alice',
            lastName: 'Smith',
            teamId: 't1',
            team: { id: 't1', name: 'Team Alpha' },
          },
        }),
        makeMockDeal({
          id: 'd2',
          value: 20000,
          probability: 50,
          expectedCloseDate: new Date('2026-09-15'),
          currency: 'USD',
          owner: {
            id: 'u2',
            firstName: 'Bob',
            lastName: 'Jones',
            teamId: 't1',
            team: { id: 't1', name: 'Team Alpha' },
          },
        }),
        makeMockDeal({
          id: 'd3',
          value: 5000,
          probability: 25,
          expectedCloseDate: new Date('2026-10-15'),
          currency: 'USD',
          owner: {
            id: 'u3',
            firstName: 'Charlie',
            lastName: 'Brown',
            teamId: 't2',
            team: { id: 't2', name: 'Team Beta' },
          },
        }),
      ])

      const result = await service.salesForecast(TENANT_ID, USER_ID, {
        startDate: '2026-08-01',
        endDate: '2026-12-31',
        groupBy: 'MONTH',
      })

      // commit: probability >= 75 (d1 only)
      expect(result.commit).toMatchObject({
        weightedValue: 8000, // 10000 * 80 / 100
        totalValue: 10000,
        count: 1,
      })

      // bestCase: probability >= 50 (d1 + d2)
      expect(result.bestCase).toMatchObject({
        weightedValue: 18000, // 8000 + 10000
        totalValue: 30000,
        count: 2,
      })

      // pipeline: all (d1 + d2 + d3)
      expect(result.pipeline).toMatchObject({
        weightedValue: 19250, // 8000 + 10000 + 1250
        totalValue: 35000,
        count: 3,
      })
    })

    it('excludes expectedCloseDate: null deals', async () => {
      dealsService.buildDealWhere.mockResolvedValue({ tenantId: TENANT_ID, deletedAt: null })
      prisma.deal.findMany.mockResolvedValue([
        makeMockDeal({
          id: 'd1',
          value: 10000,
          probability: 50,
          expectedCloseDate: new Date('2026-08-15'),
          currency: 'USD',
          owner: {
            id: 'u1',
            firstName: 'Alice',
            lastName: 'Smith',
            teamId: 't1',
            team: { id: 't1', name: 'Team Alpha' },
          },
        }),
      ])

      // The mock returns only deals with expectedCloseDate — so null ones are already filtered
      const result = await service.salesForecast(TENANT_ID, USER_ID, {
        startDate: '2026-08-01',
        endDate: '2026-10-01',
        groupBy: 'MONTH',
      })

      expect(result.pipeline.count).toBe(1)
      expect(prisma.deal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            expectedCloseDate: { not: null },
          }),
        }),
      )
    })

    it('respects visibility narrowing via buildDealWhere', async () => {
      dealsService.buildDealWhere.mockResolvedValue({
        tenantId: TENANT_ID,
        deletedAt: null,
        AND: [{ ownerId: USER_ID }],
      })
      prisma.deal.findMany.mockResolvedValue([])

      await service.salesForecast(TENANT_ID, USER_ID, {
        startDate: '2026-08-01',
        endDate: '2026-10-01',
        groupBy: 'MONTH',
      })

      expect(dealsService.buildDealWhere).toHaveBeenCalled()
      expect(prisma.deal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([expect.objectContaining({ ownerId: USER_ID })]),
          }),
        }),
      )
    })

    it('returns default currency USD for empty result set', async () => {
      dealsService.buildDealWhere.mockResolvedValue({ tenantId: TENANT_ID, deletedAt: null })
      prisma.deal.findMany.mockResolvedValue([])

      const result = await service.salesForecast(TENANT_ID, USER_ID, {
        startDate: '2026-08-01',
        endDate: '2026-10-01',
        groupBy: 'MONTH',
      })

      expect(result.currency).toBe('USD')
    })

    it('handles band boundaries: probability=75 counts in commit', async () => {
      dealsService.buildDealWhere.mockResolvedValue({ tenantId: TENANT_ID, deletedAt: null })
      prisma.deal.findMany.mockResolvedValue([
        makeMockDeal({
          id: 'd1',
          value: 10000,
          probability: 75,
          expectedCloseDate: new Date('2026-08-15'),
          currency: 'USD',
          owner: {
            id: 'u1',
            firstName: 'Alice',
            lastName: 'Smith',
            teamId: 't1',
            team: { id: 't1', name: 'Team Alpha' },
          },
        }),
      ])

      const result = await service.salesForecast(TENANT_ID, USER_ID, {
        startDate: '2026-08-01',
        endDate: '2026-10-01',
        groupBy: 'MONTH',
      })

      expect(result.commit.count).toBe(1)
      expect(result.bestCase.count).toBe(1)
      expect(result.pipeline.count).toBe(1)
    })

    it('handles empty range gracefully', async () => {
      dealsService.buildDealWhere.mockResolvedValue({ tenantId: TENANT_ID, deletedAt: null })
      prisma.deal.findMany.mockResolvedValue([])

      const result = await service.salesForecast(TENANT_ID, USER_ID, {
        startDate: '2026-08-01',
        endDate: '2026-08-01',
        groupBy: 'MONTH',
      })

      expect(result.buckets).toHaveLength(1)
      expect(result.buckets[0].weightedValue).toBe(0)
      expect(result.commit).toMatchObject({ weightedValue: 0, totalValue: 0, count: 0 })
      expect(result.bestCase).toMatchObject({ weightedValue: 0, totalValue: 0, count: 0 })
      expect(result.pipeline).toMatchObject({ weightedValue: 0, totalValue: 0, count: 0 })
    })

    it('does NOT route through DealsService.findMany (no page size clamp)', async () => {
      dealsService.buildDealWhere.mockResolvedValue({ tenantId: TENANT_ID, deletedAt: null })
      prisma.deal.findMany.mockResolvedValue([])

      await service.salesForecast(TENANT_ID, USER_ID, {
        startDate: '2026-08-01',
        endDate: '2026-10-01',
        groupBy: 'MONTH',
      })

      expect(dealsService.buildDealWhere).toHaveBeenCalled()
      expect(dealsService.findMany).not.toHaveBeenCalled()
      expect(prisma.deal.findMany).toHaveBeenCalled()
    })
  })

  describe('captureSnapshots (write-through)', () => {
    it('does not fail the forecast when snapshot upsert fails', async () => {
      dealsService.buildDealWhere.mockResolvedValue({ tenantId: TENANT_ID, deletedAt: null })
      prisma.deal.findMany.mockResolvedValue([
        makeMockDeal({
          id: 'd1',
          value: 10000,
          probability: 50,
          expectedCloseDate: new Date('2026-08-15'),
          currency: 'USD',
          owner: {
            id: 'u1',
            firstName: 'Alice',
            lastName: 'Smith',
            teamId: 't1',
            team: { id: 't1', name: 'Team Alpha' },
          },
        }),
      ])
      prisma.forecastSnapshot.upsert.mockRejectedValue(new Error('DB error'))

      const result = await service.salesForecast(TENANT_ID, USER_ID, {
        startDate: '2026-08-01',
        endDate: '2026-10-01',
        groupBy: 'MONTH',
      })

      // Forecast still returns correctly despite snapshot failure
      expect(result.buckets[0].weightedValue).toBe(5000)
    })

    it('skips snapshot for past periods (periodEnd < today)', async () => {
      // NOW = July 30, 2026
      // Past period = June 2026 (periodEnd June 30 < July 30)
      dealsService.buildDealWhere.mockResolvedValue({ tenantId: TENANT_ID, deletedAt: null })
      prisma.deal.findMany.mockResolvedValue([])

      await service.salesForecast(TENANT_ID, USER_ID, {
        startDate: '2026-06-01',
        endDate: '2026-08-31',
        groupBy: 'MONTH',
      })

      // June (past) — no upsert
      // July (past) — periodEnd < today — actually July 31 > July 30, so it would be today/current
      // August (future) — upsert
      // Let's only check that August was upserted
      const upsertCalls = prisma.forecastSnapshot.upsert.mock.calls
      const upsertedPeriods = upsertCalls.map((c) =>
        (
          c[0] as unknown as { where: { tenantId_periodStart_snapshotDate: { periodStart: Date } } }
        ).where.tenantId_periodStart_snapshotDate.periodStart.toISOString(),
      )
      // June periodStart = 2026-06-01 should NOT be upserted (past)
      expect(upsertedPeriods.some((p: string) => p.startsWith('2026-06'))).toBe(false)
    })
  })

  describe('forecastAccuracy', () => {
    it('returns null forecastValue when no snapshot exists', async () => {
      prisma.forecastSnapshot.findFirst.mockResolvedValue(null)
      prisma.deal.aggregate.mockResolvedValue({ _sum: { value: 30000 } })

      const result = await service.forecastAccuracy(TENANT_ID, USER_ID, {
        startDate: '2026-06-01',
        endDate: '2026-06-30',
      })

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        forecastValue: null,
        actualValue: 30000,
        variance: null,
        accuracyPct: null,
      })
    })

    it('returns accuracyPct null when forecastValue is 0', async () => {
      prisma.forecastSnapshot.findFirst.mockResolvedValue({
        id: 's1',
        forecastValue: 0,
        commitValue: 0,
        bestCaseValue: 0,
        pipelineValue: 0,
        dealCount: 0,
      })
      prisma.deal.aggregate.mockResolvedValue({ _sum: { value: 50000 } })

      const result = await service.forecastAccuracy(TENANT_ID, USER_ID, {
        startDate: '2026-06-01',
        endDate: '2026-06-30',
      })

      expect(result[0].forecastValue).toBe(0)
      expect(result[0].accuracyPct).toBeNull() // guarded divide-by-zero
    })

    it('computes accuracy correctly', async () => {
      prisma.forecastSnapshot.findFirst.mockResolvedValue({
        id: 's1',
        forecastValue: 50000,
        commitValue: 20000,
        bestCaseValue: 35000,
        pipelineValue: 50000,
        dealCount: 10,
      })
      prisma.deal.aggregate.mockResolvedValue({ _sum: { value: 48000 } })

      const result = await service.forecastAccuracy(TENANT_ID, USER_ID, {
        startDate: '2026-06-01',
        endDate: '2026-06-30',
      })

      expect(result[0].forecastValue).toBe(50000)
      expect(result[0].actualValue).toBe(48000)
      expect(result[0].variance).toBe(-2000)
      expect(result[0].accuracyPct).toBe(96)
    })

    it('returns only completed months (periodEnd < today)', async () => {
      // NOW = July 30, 2026
      // Request June-Aug → only June and July (July 31 < July 30? NO, July 31 > July 30)
      // Wait — periodEnd < todayUtcMidnight means only past months
      // June 30 < July 30 ✓
      // July 31 < July 30 ✗ → current month, not included
      prisma.forecastSnapshot.findFirst.mockResolvedValue(null)
      prisma.deal.aggregate.mockResolvedValue({ _sum: { value: 0 } })

      const result = await service.forecastAccuracy(TENANT_ID, USER_ID, {
        startDate: '2026-07-01',
        endDate: '2026-09-30',
      })

      // July 31 > July 30, so July is not completed → only 0 past months
      // Actually July ended on July 31, which is in the future from July 30
      // So no months at all
      expect(result).toHaveLength(0)
    })

    it('selects the earliest snapshot for each period', async () => {
      prisma.forecastSnapshot.findFirst.mockResolvedValue({
        id: 'earliest',
        forecastValue: 50000,
        commitValue: 20000,
        bestCaseValue: 35000,
        pipelineValue: 50000,
        dealCount: 10,
      })
      prisma.deal.aggregate.mockResolvedValue({ _sum: { value: 48000 } })

      await service.forecastAccuracy(TENANT_ID, USER_ID, {
        startDate: '2026-06-01',
        endDate: '2026-06-30',
      })

      expect(prisma.forecastSnapshot.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { snapshotDate: 'asc' },
        }),
      )
    })
  })
})
