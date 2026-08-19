/**
 * Story 6.7 (Contract D26–D34, F48): customerAnalytics query service.
 * Exercises typed filter validation, the shared Contacts visibility predicate
 * (never a second copy), bounded DB aggregates for summary/distributions/
 * trend/cohort/currency, stable sort + pagination, null-analytics handling and
 * the analytics-filter-independent high-LTV threshold.
 */
import { BadRequestException } from '@nestjs/common'

import { CustomerAnalyticsService } from '../customer-analytics.service'
import { ContactsService } from '../../contacts/contacts.service'
import { PrismaService } from '../../prisma/prisma.service'

const TENANT = 'tenant-1'
const USER = 'user-1'
const MS_PER_DAY = 86_400_000

type MockPrisma = {
  contact: {
    findMany: jest.Mock
    count: jest.Mock
    aggregate: jest.Mock
    groupBy: jest.Mock
  }
  deal: { groupBy: jest.Mock }
  customerAnalyticsSnapshot: {
    groupBy: jest.Mock
    aggregate: jest.Mock
  }
}

function buildPrismaMock(): MockPrisma {
  return {
    contact: {
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
    },
    deal: { groupBy: jest.fn() },
    customerAnalyticsSnapshot: {
      groupBy: jest.fn(),
      aggregate: jest.fn(),
    },
  }
}

function makeService(prisma: MockPrisma): {
  service: CustomerAnalyticsService
  contacts: { buildContactWhere: jest.Mock }
} {
  const contacts = {
    buildContactWhere: jest.fn().mockResolvedValue({ tenantId: TENANT, deletedAt: null }),
  }
  const service = new CustomerAnalyticsService(
    prisma as unknown as PrismaService,
    contacts as unknown as ContactsService,
  )
  return { service, contacts }
}

function contactRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'contact-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@test.local',
    ownerId: 'user-owner',
    owner: { id: 'user-owner', firstName: 'Test', lastName: 'Owner' },
    lifetimeValue: 350.5,
    churnRiskScore: 85,
    churnRisk: 'HIGH',
    lastActivityDate: new Date('2026-08-01T00:00:00.000Z'),
    analyticsCalculatedAt: new Date('2026-08-15T02:00:00.000Z'),
    createdAt: new Date('2026-01-10T00:00:00.000Z'),
    ...overrides,
  }
}

describe('CustomerAnalyticsService', () => {
  let prisma: MockPrisma

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = buildPrismaMock()
    prisma.contact.findMany.mockResolvedValue([contactRow()])
    prisma.contact.count.mockResolvedValue(1)
    prisma.contact.aggregate.mockResolvedValue({
      _sum: { lifetimeValue: 350.5 },
      _avg: { lifetimeValue: 350.5 },
      _min: { lifetimeValue: 350.5 },
      _max: { lifetimeValue: 350.5, analyticsCalculatedAt: new Date('2026-08-15T02:00:00.000Z') },
    })
    prisma.contact.groupBy.mockResolvedValue([{ churnRisk: 'HIGH', _count: { _all: 1 } }])
    prisma.deal.groupBy.mockResolvedValue([{ currency: 'USD', _sum: { value: 350.5 } }])
    prisma.customerAnalyticsSnapshot.aggregate.mockResolvedValue({
      _max: { snapshotDate: new Date('2026-08-15T00:00:00.000Z') },
    })
    prisma.customerAnalyticsSnapshot.groupBy.mockImplementation(({ by }: { by: string[] }) => {
      if (by.includes('acquisitionCohort')) {
        return Promise.resolve([])
      }
      return Promise.resolve([
        {
          snapshotDate: new Date('2026-08-15T00:00:00.000Z'),
          _sum: { lifetimeValue: 350.5 },
          _avg: { lifetimeValue: 350.5 },
          _count: { _all: 1 },
        },
      ])
    })
  })

  describe('filter validation (D27, G5)', () => {
    it('rejects minLifetimeValue > maxLifetimeValue', async () => {
      const { service } = makeService(prisma)
      await expect(
        service.customerAnalytics(TENANT, USER, { minLifetimeValue: 100, maxLifetimeValue: 50 }),
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('rejects non-finite LTV bounds', async () => {
      const { service } = makeService(prisma)
      await expect(
        service.customerAnalytics(TENANT, USER, { minLifetimeValue: Number.NaN }),
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        service.customerAnalytics(TENANT, USER, { maxLifetimeValue: Infinity }),
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('rejects invalid ISO dates and from > to', async () => {
      const { service } = makeService(prisma)
      await expect(
        service.customerAnalytics(TENANT, USER, { lastActivityFrom: 'not-a-date' }),
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        service.customerAnalytics(TENANT, USER, {
          lastActivityFrom: '2026-08-10T00:00:00.000Z',
          lastActivityTo: '2026-08-01T00:00:00.000Z',
        }),
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('rejects unknown churn risk values', async () => {
      const { service } = makeService(prisma)
      await expect(
        service.customerAnalytics(TENANT, USER, { churnRisks: ['NOPE' as never] }),
      ).rejects.toBeInstanceOf(BadRequestException)
    })
  })

  describe('predicate construction (D29, D30)', () => {
    it('builds the base predicate from ContactsService.buildContactWhere (never a copy)', async () => {
      const { service, contacts } = makeService(prisma)
      await service.customerAnalytics(TENANT, USER, { search: 'ada', ownerId: 'u9' })

      expect(contacts.buildContactWhere).toHaveBeenCalledWith(
        TENANT,
        USER,
        expect.objectContaining({ search: 'ada', ownerId: 'u9' }),
      )
      // The service passes search/ownerId INTO the canonical builder and does
      // not re-implement them; the list predicate is exactly what the builder
      // returned (tenant + active constraints here).
      const listWhere = prisma.contact.findMany.mock.calls[0][0].where
      expect(listWhere).toEqual(expect.objectContaining({ tenantId: TENANT, deletedAt: null }))
    })

    it('ANDs the analytics filters onto the base predicate', async () => {
      const { service } = makeService(prisma)
      await service.customerAnalytics(TENANT, USER, {
        minLifetimeValue: 100,
        maxLifetimeValue: 500,
        churnRisks: ['HIGH'],
        lastActivityFrom: '2026-08-01T00:00:00.000Z',
        lastActivityTo: '2026-08-15T00:00:00.000Z',
      })

      const where = prisma.contact.findMany.mock.calls[0][0].where
      const ands = where.AND
      expect(ands).toEqual(
        expect.arrayContaining([
          { lifetimeValue: { gte: 100, lte: 500 } },
          { churnRisk: { in: ['HIGH'] } },
          {
            lastActivityDate: {
              gte: new Date('2026-08-01T00:00:00.000Z'),
              lte: new Date('2026-08-15T23:59:59.999Z'),
            },
          },
        ]),
      )
    })

    it('does not include analytics filters in the high-LTV threshold query (B14)', async () => {
      const { service } = makeService(prisma)
      await service.customerAnalytics(TENANT, USER, { churnRisks: ['HIGH'], minLifetimeValue: 999 })

      // The threshold fetch uses the UNFILTERED visible predicate.
      const thresholdCall = prisma.contact.findMany.mock.calls.find((c) => {
        const where = c[0]?.where as Record<string, unknown> | undefined
        return (
          where !== undefined &&
          (where.lifetimeValue as Record<string, unknown> | undefined)?.gt === 0
        )
      })
      expect(thresholdCall).toBeTruthy()
      const thresholdWhere = thresholdCall![0].where as Record<string, unknown>
      expect(thresholdWhere).not.toHaveProperty('churnRisk')
      expect((thresholdWhere.lifetimeValue as Record<string, unknown>).gte).toBeUndefined()
      expect(thresholdWhere.lifetimeValue).toEqual({ gt: 0 })
    })
    it('tolerates a base predicate whose AND is a single condition object (D29)', async () => {
      const { service, contacts } = makeService(prisma)
      contacts.buildContactWhere.mockResolvedValue({
        tenantId: TENANT,
        deletedAt: null,
        AND: { ownerId: 'u1' },
      })
      await service.customerAnalytics(TENANT, USER, { churnRisks: ['HIGH'] })

      const where = prisma.contact.findMany.mock.calls[0][0].where
      expect(where.AND).toEqual([{ ownerId: 'u1' }, { churnRisk: { in: ['HIGH'] } }])
    })

    it('tolerates a null average/count aggregate group in the trend (bounded fallback)', async () => {
      prisma.customerAnalyticsSnapshot.groupBy.mockImplementation(({ by }: { by: string[] }) => {
        if (by.includes('acquisitionCohort')) {
          return Promise.resolve([])
        }
        return Promise.resolve([
          {
            snapshotDate: new Date('2026-08-15T00:00:00.000Z'),
            _sum: null,
            _avg: null,
            _count: null,
          },
        ])
      })
      const { service } = makeService(prisma)
      const result = await service.customerAnalytics(TENANT, USER, {})

      expect(result.ltvTrend).toEqual([
        { snapshotDate: '2026-08-15T00:00:00.000Z', totalLtv: 0, averageLtv: 0, customerCount: 0 },
      ])
    })

    it('reports a single-value distribution when min === max (bounded fallback)', async () => {
      prisma.contact.aggregate.mockResolvedValue({
        _sum: { lifetimeValue: 350.5 },
        _min: { lifetimeValue: 350.5 },
        _max: { lifetimeValue: 350.5, analyticsCalculatedAt: new Date('2026-08-15T02:00:00.000Z') },
      })
      prisma.contact.count.mockResolvedValue(1)
      const { service } = makeService(prisma)
      const result = await service.customerAnalytics(TENANT, USER, {})

      expect(result.ltvDistribution).toEqual([
        { label: '350.5-350.5', min: 350.5, max: 350.5, count: 1 },
      ])
    })
  })

  describe('summary (D31, B12)', () => {
    it('returns bounded DB-aggregated summary values', async () => {
      const { service } = makeService(prisma)
      const result = await service.customerAnalytics(TENANT, USER, {})

      expect(result.summary).toEqual(
        expect.objectContaining({
          customerCount: 1,
          calculatedCustomerCount: 1,
          totalLifetimeValue: 350.5,
          averageLifetimeValue: 350.5,
          highLtvThreshold: 350.5,
          latestCalculatedAt: '2026-08-15T02:00:00.000Z',
          mixedCurrencies: false,
          currencyBreakdown: [{ currency: 'USD', value: 350.5 }],
        }),
      )
    })

    it('nulls total/average when currencies are mixed (B15, F25)', async () => {
      prisma.deal.groupBy.mockResolvedValue([
        { currency: 'USD', _sum: { value: 350.5 } },
        { currency: 'VND', _sum: { value: 1_000_000 } },
      ])
      const { service } = makeService(prisma)
      const result = await service.customerAnalytics(TENANT, USER, {})

      expect(result.summary.mixedCurrencies).toBe(true)
      expect(result.summary.totalLifetimeValue).toBeNull()
      expect(result.summary.averageLifetimeValue).toBeNull()
      expect(result.summary.currencyBreakdown).toEqual([
        { currency: 'USD', value: 350.5 },
        { currency: 'VND', value: 1_000_000 },
      ])
    })

    it('averages LTV only over calculated customers — NOT_CALCULATED never counts as zero (D31, AC 10)', async () => {
      // 2 visible customers: one calculated (350.5), one NOT_CALCULATED
      // (null analytics). customerCount and calculatedCustomerCount stay.
      prisma.contact.count
        .mockResolvedValueOnce(2) // customerCount
        .mockResolvedValueOnce(1) // calculatedCustomerCount
        .mockResolvedValue(1) // threshold + distribution counts
      prisma.contact.aggregate.mockResolvedValue({
        _sum: { lifetimeValue: 350.5 },
        _avg: { lifetimeValue: 350.5 },
        _min: { lifetimeValue: 350.5 },
        _max: { lifetimeValue: 350.5, analyticsCalculatedAt: new Date('2026-08-15T02:00:00.000Z') },
      })
      const { service } = makeService(prisma)
      const result = await service.customerAnalytics(TENANT, USER, {})

      expect(result.summary.customerCount).toBe(2)
      expect(result.summary.calculatedCustomerCount).toBe(1)
      expect(result.summary.totalLifetimeValue).toBe(350.5)
      // 350.5 / 1 calculated customer — NOT 350.5 / 2 visible customers.
      expect(result.summary.averageLifetimeValue).toBe(350.5)
    })

    it('returns null average (never 0) when no customer has calculated LTV (D31, AC 10)', async () => {
      prisma.contact.count
        .mockResolvedValueOnce(2) // customerCount
        .mockResolvedValueOnce(0) // calculatedCustomerCount
        .mockResolvedValue(0) // threshold + distribution counts
      prisma.contact.aggregate.mockResolvedValue({
        _sum: { lifetimeValue: null },
        _avg: { lifetimeValue: null },
        _min: { lifetimeValue: null },
        _max: { lifetimeValue: null, analyticsCalculatedAt: null },
      })
      prisma.deal.groupBy.mockResolvedValue([]) // no won deals → no currency groups
      const { service } = makeService(prisma)
      const result = await service.customerAnalytics(TENANT, USER, {})

      expect(result.summary.customerCount).toBe(2)
      expect(result.summary.calculatedCustomerCount).toBe(0)
      expect(result.summary.averageLifetimeValue).toBeNull()
      // R2-F1/D31/AC 10: the TOTAL must not fabricate 0 either — a fresh
      // tenant with no calculated customer has no LTV at all (SQL SUM is
      // NULL). E42/security invariant 8: null analytics render "Not
      // calculated", never a fabricated 0.
      expect(result.summary.totalLifetimeValue).toBeNull()
    })

    it('keeps 0 total when a calculated customer truly has LTV 0 (R2-F1)', async () => {
      // 1 visible customer, calculated, whose sum of won deal values is
      // exactly 0 → the raw SQL SUM is a real 0 and must NOT be nulled by
      // the zero-calculated guard (which keys off calculatedCustomerCount).
      prisma.contact.count
        .mockResolvedValueOnce(1) // customerCount
        .mockResolvedValueOnce(1) // calculatedCustomerCount
        .mockResolvedValue(0) // threshold + distribution counts
      prisma.contact.aggregate.mockResolvedValue({
        _sum: { lifetimeValue: 0 },
        _avg: { lifetimeValue: 0 },
        _min: { lifetimeValue: 0 },
        _max: { lifetimeValue: 0, analyticsCalculatedAt: new Date('2026-08-15T02:00:00.000Z') },
      })
      prisma.deal.groupBy.mockResolvedValue([{ currency: 'USD', _sum: { value: 0 } }])
      const { service } = makeService(prisma)
      const result = await service.customerAnalytics(TENANT, USER, {})

      expect(result.summary.calculatedCustomerCount).toBe(1)
      expect(result.summary.mixedCurrencies).toBe(false)
      expect(result.summary.totalLifetimeValue).toBe(0)
      expect(result.summary.averageLifetimeValue).toBe(0)
    })
  })

  describe('distributions (D31, B12)', () => {
    it('builds at most 5 equal-width LTV bins from the filtered min/max', async () => {
      prisma.contact.aggregate.mockResolvedValue({
        _sum: { lifetimeValue: 1000 },
        _min: { lifetimeValue: 0 },
        _max: { lifetimeValue: 400, analyticsCalculatedAt: new Date('2026-08-15T02:00:00.000Z') },
      })
      prisma.contact.count.mockResolvedValue(4)
      const { service } = makeService(prisma)
      const result = await service.customerAnalytics(TENANT, USER, {})

      expect(result.ltvDistribution).toHaveLength(5)
      expect(result.ltvDistribution[0]).toEqual(
        expect.objectContaining({
          min: 0,
          max: 80,
          count: expect.any(Number),
          label: expect.any(String),
        }),
      )
      expect(result.ltvDistribution[4].max).toBe(400)
      // 5 bounded count queries — never a full-row fetch. (The high-LTV
      // threshold count is a separate bounded count with {gt: 0}; bins are
      // exactly the 5 range-shaped count queries.)
      const binCounts = prisma.contact.count.mock.calls.filter((c) => {
        const ltv = (c[0].where as Record<string, unknown>).lifetimeValue
        return (
          typeof ltv === 'object' &&
          ltv !== null &&
          (Object.prototype.hasOwnProperty.call(ltv, 'gte') ||
            Object.prototype.hasOwnProperty.call(ltv, 'lte'))
        )
      })
      expect(binCounts.length).toBe(5)
    })

    it('reports NOT_CALCULATED with percentages summing to 100 (B13)', async () => {
      prisma.contact.count.mockResolvedValue(4)
      prisma.contact.groupBy.mockResolvedValue([
        { churnRisk: 'LOW', _count: { _all: 1 } },
        { churnRisk: 'HIGH', _count: { _all: 2 } },
      ])
      const { service } = makeService(prisma)
      const result = await service.customerAnalytics(TENANT, USER, {})

      const bins = result.churnRiskDistribution
      expect(bins).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ risk: 'LOW', count: 1 }),
          expect.objectContaining({ risk: 'HIGH', count: 2 }),
          expect.objectContaining({ risk: 'NOT_CALCULATED', count: 1 }),
        ]),
      )
      const totalPercentage = bins.reduce((sum, b) => sum + b.percentage, 0)
      expect(totalPercentage).toBeCloseTo(100, 5)
    })
  })

  describe('customers list (D31, D32, B10)', () => {
    it('applies the stable sort: risk desc (null last), LTV desc, id asc', async () => {
      const { service } = makeService(prisma)
      await service.customerAnalytics(TENANT, USER, {})

      expect(prisma.contact.findMany.mock.calls[0][0].orderBy).toEqual([
        { churnRiskScore: { sort: 'desc', nulls: 'last' } },
        { lifetimeValue: { sort: 'desc', nulls: 'last' } },
        { id: 'asc' },
      ])
    })

    it('clamps pageSize to 100 and defaults to 20 (D27, B11)', async () => {
      const { service } = makeService(prisma)
      await service.customerAnalytics(TENANT, USER, {}, { page: 2, pageSize: 500 })
      expect(prisma.contact.findMany.mock.calls[0][0].take).toBe(100)
      expect(prisma.contact.findMany.mock.calls[0][0].skip).toBe(100)

      prisma.contact.findMany.mockClear()
      await service.customerAnalytics(TENANT, USER, {})
      expect(prisma.contact.findMany.mock.calls[0][0].take).toBe(20)
    })

    it('exposes recommended action + high-LTV flag on items (B13, F26)', async () => {
      prisma.contact.findMany.mockResolvedValue([contactRow()])
      const { service } = makeService(prisma)
      const result = await service.customerAnalytics(TENANT, USER, {})

      expect(result.customers.items[0]).toEqual(
        expect.objectContaining({
          id: 'contact-1',
          name: 'Ada Lovelace',
          recommendedAction: { code: 'SCHEDULE_FOLLOW_UP', label: 'Schedule follow-up' },
        }),
      )
      expect(typeof result.customers.items[0].isHighLifetimeValue).toBe('boolean')
    })

    it('keeps null calculated fields nullable (B13, R-008)', async () => {
      prisma.contact.findMany.mockResolvedValue([
        contactRow({
          lifetimeValue: null,
          churnRisk: null,
          churnRiskScore: null,
          lastActivityDate: null,
          analyticsCalculatedAt: null,
        }),
      ])
      const { service } = makeService(prisma)
      const result = await service.customerAnalytics(TENANT, USER, {})

      expect(result.customers.items[0].lifetimeValue).toBeNull()
      expect(result.customers.items[0].churnRisk).toBeNull()
      expect(result.customers.items[0].recommendedAction).toEqual({
        code: 'MONITOR',
        label: 'Monitor',
      })
    })
  })

  describe('trend (C24, B9)', () => {
    it('aggregates snapshots over the last 90 days via visible contacts', async () => {
      const { service } = makeService(prisma)
      const result = await service.customerAnalytics(TENANT, USER, {})

      expect(result.ltvTrend).toEqual([
        {
          snapshotDate: '2026-08-15T00:00:00.000Z',
          totalLtv: 350.5,
          averageLtv: 350.5,
          customerCount: 1,
        },
      ])
      const groupByWhere = prisma.customerAnalyticsSnapshot.groupBy.mock.calls[0][0].where
      expect(groupByWhere.tenantId).toBe(TENANT)
      expect(groupByWhere.snapshotDate.gte).toBeInstanceOf(Date)
      expect(groupByWhere.contact).toEqual(
        expect.objectContaining({ tenantId: TENANT, deletedAt: null }),
      )
    })

    it('covers exactly 90 snapshot days: today-89 … today, excluding today-90 (C24)', async () => {
      const fixedToday = new Date('2026-08-15T00:00:00.000Z')
      const contacts = {
        buildContactWhere: jest.fn().mockResolvedValue({ tenantId: TENANT, deletedAt: null }),
      }
      const service = new CustomerAnalyticsService(
        prisma as unknown as PrismaService,
        contacts as unknown as ContactsService,
        () => fixedToday,
      )
      await service.customerAnalytics(TENANT, USER, {})

      const where = prisma.customerAnalyticsSnapshot.groupBy.mock.calls[0][0].where
      const start = where.snapshotDate.gte as Date
      const endExclusive = where.snapshotDate.lt as Date
      // First included snapshot day = today - 89 (90 calendar days incl. today).
      expect(start.toISOString()).toBe('2026-05-18T00:00:00.000Z')
      // Day today - 90 must be excluded (the old off-by-one start).
      expect(start.toISOString()).not.toBe('2026-05-17T00:00:00.000Z')
      // Exactly 90 UTC calendar days between the exclusive bounds.
      expect((endExclusive.getTime() - start.getTime()) / MS_PER_DAY).toBe(90)
      expect(endExclusive.toISOString()).toBe('2026-08-16T00:00:00.000Z') // today + 1 (exclusive)
    })
  })

  describe('high-LTV threshold — bounded order-statistic fetch (B14, D32)', () => {
    const thresholdCall = (
      calls: jest.Mock['mock']['calls'],
    ): jest.Mock['mock']['calls'][number] | undefined =>
      calls.find((c) => {
        const where = c[0]?.where as Record<string, unknown> | undefined
        return (
          where !== undefined &&
          (where.lifetimeValue as Record<string, unknown> | undefined)?.gt === 0
        )
      })

    it('fetches at most 2 lifetime values for any positive-set size — never the full set (D32)', async () => {
      prisma.contact.count.mockResolvedValue(1_000_000)
      const { service } = makeService(prisma)
      await service.customerAnalytics(TENANT, USER, {})

      const countCall = prisma.contact.count.mock.calls.find((c) => {
        const ltv = (c[0].where as Record<string, unknown>).lifetimeValue
        return typeof ltv === 'object' && ltv !== null && (ltv as { gt?: number }).gt === 0
      })
      expect(countCall).toBeTruthy() // one bounded count
      const fetch = thresholdCall(prisma.contact.findMany.mock.calls)
      expect(fetch).toBeTruthy()
      expect(fetch![0].take).toBeLessThanOrEqual(2)
      expect(fetch![0].skip).toBeGreaterThanOrEqual(0)
      expect(fetch![0].select).toEqual({ lifetimeValue: true })
      expect(fetch![0].orderBy).toEqual([{ lifetimeValue: 'asc' }, { id: 'asc' }])
      // Exactly ONE value fetch — no full-row mapping in Node.
      const valueFetches = prisma.contact.findMany.mock.calls.filter((c) => {
        const where = c[0]?.where as Record<string, unknown> | undefined
        return (
          where !== undefined &&
          (where.lifetimeValue as Record<string, unknown> | undefined)?.gt === 0
        )
      })
      expect(valueFetches).toHaveLength(1)
    })

    it('keeps the exact Tukey-hinges p75 for an even positive set (skip 5 take 2)', async () => {
      prisma.contact.count.mockResolvedValue(8)
      prisma.contact.findMany.mockImplementation((args: { where?: Record<string, unknown> }) => {
        if ((args.where?.lifetimeValue as Record<string, unknown> | undefined)?.gt === 0) {
          return Promise.resolve([{ lifetimeValue: 600 }, { lifetimeValue: 700 }])
        }
        return Promise.resolve([contactRow()])
      })
      const { service } = makeService(prisma)
      const result = await service.customerAnalytics(TENANT, USER, {})

      expect(result.summary.highLtvThreshold).toBe(650)
      const fetch = thresholdCall(prisma.contact.findMany.mock.calls)
      expect(fetch![0].skip).toBe(5)
      expect(fetch![0].take).toBe(2)
    })

    it('keeps the exact p75 for an odd positive set (single order statistic)', async () => {
      prisma.contact.count.mockResolvedValue(5)
      prisma.contact.findMany.mockImplementation((args: { where?: Record<string, unknown> }) => {
        if ((args.where?.lifetimeValue as Record<string, unknown> | undefined)?.gt === 0) {
          return Promise.resolve([{ lifetimeValue: 400 }])
        }
        return Promise.resolve([contactRow()])
      })
      const { service } = makeService(prisma)
      const result = await service.customerAnalytics(TENANT, USER, {})

      expect(result.summary.highLtvThreshold).toBe(400)
      const fetch = thresholdCall(prisma.contact.findMany.mock.calls)
      expect(fetch![0].skip).toBe(3)
      expect(fetch![0].take).toBe(1)
    })

    it('single positive contact → threshold is its value (skip 0 take 1)', async () => {
      prisma.contact.count.mockResolvedValue(1)
      prisma.contact.findMany.mockImplementation((args: { where?: Record<string, unknown> }) => {
        if ((args.where?.lifetimeValue as Record<string, unknown> | undefined)?.gt === 0) {
          return Promise.resolve([{ lifetimeValue: 350.5 }])
        }
        return Promise.resolve([contactRow()])
      })
      const { service } = makeService(prisma)
      const result = await service.customerAnalytics(TENANT, USER, {})

      expect(result.summary.highLtvThreshold).toBe(350.5)
    })

    it('no positive contacts → null threshold and no value fetch at all (B14)', async () => {
      prisma.contact.count.mockResolvedValue(0)
      const { service } = makeService(prisma)
      const result = await service.customerAnalytics(TENANT, USER, {})

      expect(result.summary.highLtvThreshold).toBeNull()
      expect(thresholdCall(prisma.contact.findMany.mock.calls)).toBeUndefined()
    })

    it('keeps the count and fetch scoped to the unfiltered visible predicate (B14, D29)', async () => {
      const { service } = makeService(prisma)
      await service.customerAnalytics(TENANT, USER, { churnRisks: ['HIGH'], minLifetimeValue: 999 })

      const countCall = prisma.contact.count.mock.calls.find((c) => {
        const ltv = (c[0].where as Record<string, unknown>).lifetimeValue
        return typeof ltv === 'object' && ltv !== null && (ltv as { gt?: number }).gt === 0
      })
      expect(countCall![0].where).toEqual(
        expect.objectContaining({ tenantId: TENANT, deletedAt: null }),
      )
      expect(countCall![0].where).not.toHaveProperty('churnRisk')
      const fetch = thresholdCall(prisma.contact.findMany.mock.calls)
      expect(fetch![0].where).toEqual(
        expect.objectContaining({ tenantId: TENANT, deletedAt: null }),
      )
      expect(fetch![0].where).not.toHaveProperty('churnRisk')
    })
  })

  describe('cohorts (C25, AC16)', () => {
    it('groups the latest snapshot day by acquisitionCohort, ascending', async () => {
      prisma.customerAnalyticsSnapshot.groupBy.mockImplementation(({ by }: { by: string[] }) => {
        if (by.includes('acquisitionCohort')) {
          return Promise.resolve([
            {
              acquisitionCohort: '2026-01',
              _sum: { lifetimeValue: 350.5 },
              _avg: { lifetimeValue: 350.5 },
              _count: { _all: 1 },
            },
            {
              acquisitionCohort: '2025-12',
              _sum: { lifetimeValue: 100 },
              _avg: { lifetimeValue: 100 },
              _count: { _all: 1 },
            },
          ])
        }
        return Promise.resolve([])
      })
      const { service } = makeService(prisma)
      const result = await service.customerAnalytics(TENANT, USER, {})

      expect(result.cohorts.map((c) => c.cohort)).toEqual(['2025-12', '2026-01'])
      expect(result.cohorts[1]).toEqual(
        expect.objectContaining({
          cohort: '2026-01',
          customerCount: 1,
          totalLtv: 350.5,
          averageLtv: 350.5,
        }),
      )
    })

    it('derives the cohort latest day from VISIBLE contacts only, never the tenant-wide max (F2 regression)', async () => {
      const visibleLatest = new Date('2026-08-15T00:00:00.000Z') // day N-1 (visible contacts)
      const invisibleLatest = new Date('2026-08-16T00:00:00.000Z') // day N (invisible contact only)

      // Simulate the real DB: the max query scoped to visible contacts
      // returns the VISIBLE max; an unscoped tenant-wide query returns the
      // invisible contact's later day.
      prisma.customerAnalyticsSnapshot.aggregate.mockImplementation(
        (args: { where?: Record<string, unknown> }) => {
          if (args.where?.contact) {
            return Promise.resolve({ _max: { snapshotDate: visibleLatest } })
          }
          return Promise.resolve({ _max: { snapshotDate: invisibleLatest } })
        },
      )
      prisma.customerAnalyticsSnapshot.groupBy.mockImplementation(
        (args: { by: string[]; where?: Record<string, unknown> }) => {
          if (args.by.includes('acquisitionCohort')) {
            const snapshotDate = args.where?.snapshotDate as Date | undefined
            if (snapshotDate?.getTime() === invisibleLatest.getTime()) {
              // No VISIBLE cohort row exists on the invisible contact's day.
              return Promise.resolve([])
            }
            return Promise.resolve([
              {
                acquisitionCohort: '2026-01',
                _sum: { lifetimeValue: 350.5 },
                _avg: { lifetimeValue: 350.5 },
                _count: { _all: 1 },
              },
            ])
          }
          return Promise.resolve([])
        },
      )

      const { service } = makeService(prisma)
      const result = await service.customerAnalytics(TENANT, USER, {})

      // Caller must receive the VISIBLE N-1 cohort — not an empty result.
      expect(result.cohorts).toEqual([
        expect.objectContaining({ cohort: '2026-01', customerCount: 1 }),
      ])
      // The latest-day aggregate itself must be scoped to visible contacts.
      const aggCall = prisma.customerAnalyticsSnapshot.aggregate.mock.calls[0][0]
      expect(aggCall.where).toEqual(expect.objectContaining({ tenantId: TENANT, deletedAt: null }))
      expect(aggCall.where.contact).toEqual(
        expect.objectContaining({ tenantId: TENANT, deletedAt: null }),
      )
    })
  })
})
