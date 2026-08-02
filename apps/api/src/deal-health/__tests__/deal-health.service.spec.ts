import { BadRequestException, NotFoundException } from '@nestjs/common'

import { DealHealthService } from '../deal-health.service'
import type { HealthDealRow } from '../deal-health.service'
import type { PrismaService } from '../../prisma/prisma.service'
import type { DealsService } from '../../deals/deals.service'
import type { AuditService } from '../../audit/audit.service'

const NOW = new Date('2026-08-01T10:30:00.000Z') // Saturday 2026-08-01
const MONDAY = new Date('2026-08-03T09:00:00.000Z') // Monday 2026-08-03
const TUESDAY = new Date('2026-08-04T09:00:00.000Z') // Tuesday 2026-08-04

type MockDealRow = HealthDealRow & {
  tenantId: string
  title: string
  value: number
  currency: string
  stageId: string
  contactId: string
  ownerId: string
  actualCloseDate: Date | null
  createdAt: Date
  deletedAt: Date | null
  stage: {
    id: string
    name: string
    color: string
    probability: number
    isWon: boolean
    isLost: boolean
  }
  owner: { id: string; firstName: string; lastName: string; email: string; avatar: string | null }
}

function makeDealRow(overrides: Partial<MockDealRow> = {}): MockDealRow {
  return {
    id: 'deal-1',
    tenantId: 'tenant-1',
    title: 'Enterprise Deal',
    value: 100000,
    currency: 'USD',
    probability: 25,
    stageId: 'stage-1',
    contactId: 'contact-1',
    ownerId: 'user-1',
    expectedCloseDate: new Date('2026-08-20T00:00:00.000Z'),
    actualCloseDate: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-30T00:00:00.000Z'),
    deletedAt: null,
    stage: {
      id: 'stage-1',
      name: 'Qualified',
      color: '#3B82F6',
      probability: 25,
      isWon: false,
      isLost: false,
    },
    owner: {
      id: 'user-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      avatar: null,
    },
    ...overrides,
  }
}

function makePrismaMock(): Record<string, unknown> & {
  dealComment: { groupBy: jest.Mock }
  dealDocument: { groupBy: jest.Mock }
  deal: { findMany: jest.Mock }
  dealReminder: { findFirst: jest.Mock; createMany: jest.Mock }
  dealReminderSnooze: {
    findFirst: jest.Mock
    findMany: jest.Mock
    upsert: jest.Mock
    updateMany: jest.Mock
  }
  userReminderPreference: { findFirst: jest.Mock; findMany: jest.Mock; upsert: jest.Mock }
} {
  return {
    dealComment: { groupBy: jest.fn() },
    dealDocument: { groupBy: jest.fn() },
    deal: { findMany: jest.fn() },
    dealReminder: { findFirst: jest.fn(), createMany: jest.fn() },
    dealReminderSnooze: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    userReminderPreference: { findFirst: jest.fn(), findMany: jest.fn(), upsert: jest.fn() },
  }
}

function makeDealsMock(): { findOne: jest.Mock; buildDealWhere: jest.Mock; findMany: jest.Mock } {
  return {
    findOne: jest.fn(),
    buildDealWhere: jest.fn(),
    findMany: jest.fn(),
  }
}

function makeAuditMock(): { log: jest.Mock } {
  return { log: jest.fn().mockResolvedValue(undefined) }
}

describe('DealHealthService', () => {
  let prisma: ReturnType<typeof makePrismaMock>
  let deals: ReturnType<typeof makeDealsMock>
  let audit: ReturnType<typeof makeAuditMock>
  let service: DealHealthService

  beforeEach(() => {
    prisma = makePrismaMock()
    deals = makeDealsMock()
    audit = makeAuditMock()
    service = new DealHealthService(
      prisma as unknown as PrismaService,
      deals as unknown as DealsService,
      audit as unknown as AuditService,
    )
    prisma.dealComment.groupBy.mockResolvedValue([])
    prisma.dealDocument.groupBy.mockResolvedValue([])
    prisma.dealReminderSnooze.findMany.mockResolvedValue([])
    prisma.userReminderPreference.findMany.mockResolvedValue([])
    prisma.dealReminder.createMany.mockResolvedValue({ count: 0 })
  })

  describe('resolveLastActivityAt (AC 20)', () => {
    it('issues exactly two groupBy queries regardless of deal-set size (no per-deal query)', async () => {
      prisma.dealComment.groupBy.mockResolvedValue([])
      prisma.dealDocument.groupBy.mockResolvedValue([])

      const result = await service.resolveLastActivityAt('tenant-1', ['deal-1', 'deal-2', 'deal-3'])

      expect(result.size).toBe(0)
      expect(prisma.dealComment.groupBy).toHaveBeenCalledTimes(1)
      expect(prisma.dealDocument.groupBy).toHaveBeenCalledTimes(1)
      expect(prisma.dealComment.groupBy).toHaveBeenCalledWith({
        by: ['dealId'],
        where: {
          tenantId: 'tenant-1',
          dealId: { in: ['deal-1', 'deal-2', 'deal-3'] },
          deletedAt: null,
        },
        _max: { createdAt: true },
      })
      expect(prisma.dealDocument.groupBy).toHaveBeenCalledWith({
        by: ['dealId'],
        where: {
          tenantId: 'tenant-1',
          dealId: { in: ['deal-1', 'deal-2', 'deal-3'] },
          deletedAt: null,
        },
        _max: { createdAt: true },
      })
    })

    it('picks the latest of comment and document activity per deal', async () => {
      prisma.dealComment.groupBy.mockResolvedValue([
        { dealId: 'deal-1', _max: { createdAt: new Date('2026-07-28T00:00:00.000Z') } },
      ])
      prisma.dealDocument.groupBy.mockResolvedValue([
        { dealId: 'deal-1', _max: { createdAt: new Date('2026-07-29T00:00:00.000Z') } },
      ])

      const result = await service.resolveLastActivityAt('tenant-1', ['deal-1'])

      expect(result.get('deal-1')).toEqual(new Date('2026-07-29T00:00:00.000Z'))
    })

    it('uses the comment date when it is the latest source', async () => {
      prisma.dealComment.groupBy.mockResolvedValue([
        { dealId: 'deal-1', _max: { createdAt: new Date('2026-07-29T00:00:00.000Z') } },
      ])
      prisma.dealDocument.groupBy.mockResolvedValue([
        { dealId: 'deal-1', _max: { createdAt: new Date('2026-07-28T00:00:00.000Z') } },
      ])

      const result = await service.resolveLastActivityAt('tenant-1', ['deal-1'])

      expect(result.get('deal-1')).toEqual(new Date('2026-07-29T00:00:00.000Z'))
    })

    it('never queries the Activity model (AC 21)', async () => {
      await service.resolveLastActivityAt('tenant-1', ['deal-1'])
      expect(prisma.dealComment.groupBy).toHaveBeenCalledTimes(1)
      expect(prisma.dealDocument.groupBy).toHaveBeenCalledTimes(1)
    })
  })

  describe('computeForDeals (AC 22)', () => {
    it('falls back to Deal.updatedAt when a deal has no comments or documents', async () => {
      const deal = makeDealRow({ updatedAt: new Date('2026-07-20T00:00:00.000Z') })

      const [entry] = await service.computeForDeals('tenant-1', [deal], NOW)

      expect(entry.lastActivityAt).toEqual(new Date('2026-07-20T00:00:00.000Z'))
      // 12 days since activity → NO_ACTIVITY_7D (-20) → 80
      expect(entry.health.score).toBe(80)
      expect(entry.health.signals).toEqual(['NO_ACTIVITY_7D'])
    })

    it('uses the max of updatedAt, comments and documents (AC 20)', async () => {
      prisma.dealComment.groupBy.mockResolvedValue([
        { dealId: 'deal-1', _max: { createdAt: new Date('2026-07-29T00:00:00.000Z') } },
      ])
      prisma.dealDocument.groupBy.mockResolvedValue([
        { dealId: 'deal-1', _max: { createdAt: new Date('2026-07-28T00:00:00.000Z') } },
      ])
      const deal = makeDealRow({ updatedAt: new Date('2026-07-20T00:00:00.000Z') })

      const [entry] = await service.computeForDeals('tenant-1', [deal], NOW)

      expect(entry.lastActivityAt).toEqual(new Date('2026-07-29T00:00:00.000Z'))
    })

    it('skips closed deals (scoreDealHealth returns null)', async () => {
      const open = makeDealRow({ id: 'deal-open' })
      const closedWon = makeDealRow({ id: 'deal-won', stage: { ...open.stage, isWon: true } })
      const closedLost = makeDealRow({ id: 'deal-lost', stage: { ...open.stage, isLost: true } })

      const entries = await service.computeForDeals('tenant-1', [open, closedWon, closedLost], NOW)

      expect(entries.map((e) => e.deal.id)).toEqual(['deal-open'])
    })
  })

  describe('findOneHealth (AC 23)', () => {
    it('calls deals.findOne first and returns health, lastActivityAt and snoozedUntil', async () => {
      deals.findOne.mockResolvedValue(
        makeDealRow({ updatedAt: new Date('2026-07-29T00:00:00.000Z') }),
      )
      prisma.dealReminderSnooze.findFirst.mockResolvedValue({
        snoozedUntil: new Date('2026-08-08T00:00:00.000Z'),
      })

      const result = await service.findOneHealth('tenant-1', 'user-1', 'deal-1', NOW)

      expect(deals.findOne).toHaveBeenCalledWith('tenant-1', 'user-1', 'deal-1')
      expect(result.health?.status).toBe('HEALTHY')
      expect(result.lastActivityAt).toEqual(new Date('2026-07-29T00:00:00.000Z'))
      expect(result.snoozedUntil).toEqual(new Date('2026-08-08T00:00:00.000Z'))
    })

    it('returns null health for a closed deal but still resolves activity and snooze', async () => {
      deals.findOne.mockResolvedValue(
        makeDealRow({ stage: { ...makeDealRow().stage, isWon: true } }),
      )
      prisma.dealReminderSnooze.findFirst.mockResolvedValue(null)

      const result = await service.findOneHealth('tenant-1', 'user-1', 'deal-1', NOW)

      expect(result.health).toBeNull()
      expect(result.lastActivityAt).toBeInstanceOf(Date)
      expect(result.snoozedUntil).toBeNull()
    })

    it('propagates the identical NotFoundException from deals.findOne for cross-tenant/soft-deleted/not-visible deals', async () => {
      deals.findOne.mockRejectedValue(new NotFoundException('Deal not found'))

      await expect(service.findOneHealth('tenant-1', 'user-1', 'deal-1', NOW)).rejects.toThrow(
        new NotFoundException('Deal not found'),
      )
    })
  })

  describe('findAtRisk (AC 24, 25)', () => {
    beforeEach(() => {
      deals.buildDealWhere.mockResolvedValue({ tenantId: 'tenant-1', deletedAt: null })
      prisma.deal.findMany.mockResolvedValue([])
    })

    it('builds its where from buildDealWhere and never calls DealsService.findMany (AC 25)', async () => {
      await service.findAtRisk('tenant-1', 'user-1', {}, NOW)

      expect(deals.buildDealWhere).toHaveBeenCalledWith('tenant-1', 'user-1', {})
      expect(deals.findMany).not.toHaveBeenCalled()
    })

    it('excludes HEALTHY deals and closed-stage deals, keeps AT_RISK and STALE', async () => {
      const healthy = makeDealRow({
        id: 'healthy',
        updatedAt: new Date('2026-07-31T00:00:00.000Z'),
      })
      const atRisk = makeDealRow({
        id: 'at-risk',
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
        expectedCloseDate: null,
      })
      const stale = makeDealRow({
        id: 'stale',
        updatedAt: new Date('2026-06-01T00:00:00.000Z'),
        expectedCloseDate: new Date('2026-06-01T00:00:00.000Z'),
      })
      const closedWon = makeDealRow({
        id: 'closed',
        stage: { ...makeDealRow().stage, isWon: true },
      })
      prisma.deal.findMany.mockResolvedValue([healthy, atRisk, stale, closedWon])

      const result = await service.findAtRisk('tenant-1', 'user-1', {}, NOW)

      expect(result.items.map((e) => e.deal.id).sort()).toEqual(['at-risk', 'stale'])
      expect(result.total).toBe(2)
    })

    it('excludes deals the calling user has actively snoozed (snoozedUntil > now)', async () => {
      const atRisk = makeDealRow({
        id: 'at-risk',
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
        expectedCloseDate: null,
      })
      prisma.deal.findMany.mockResolvedValue([atRisk])
      prisma.dealReminderSnooze.findMany.mockResolvedValue([{ dealId: 'at-risk' }])

      const result = await service.findAtRisk('tenant-1', 'user-1', {}, NOW)

      expect(result.items).toHaveLength(0)
      expect(result.total).toBe(0)
    })

    it('sorts by score ascending (worst first), then expectedCloseDate ascending', async () => {
      // score 45: 31 days idle (-40) + closing in 3 days (-15)
      const score45 = makeDealRow({
        id: 'score45',
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
        expectedCloseDate: new Date('2026-08-04T00:00:00.000Z'),
      })
      // score 60: 31 days idle (-40) only
      const score60 = makeDealRow({
        id: 'score60',
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
        expectedCloseDate: new Date('2026-08-20T00:00:00.000Z'),
      })
      // score 65: 7 days idle (-20) + closing today (-15)
      const score65 = makeDealRow({
        id: 'score65',
        updatedAt: new Date('2026-07-25T00:00:00.000Z'),
        expectedCloseDate: new Date('2026-08-01T00:00:00.000Z'),
      })
      prisma.deal.findMany.mockResolvedValue([score65, score45, score60])

      const result = await service.findAtRisk('tenant-1', 'user-1', {}, NOW)

      expect(result.items.map((e) => e.deal.id)).toEqual(['score45', 'score60', 'score65'])
    })

    it('breaks score ties by expectedCloseDate ascending (nulls last)', async () => {
      const tieA = makeDealRow({
        id: 'tie-a',
        updatedAt: new Date('2026-07-01T00:00:00.000Z'), // -40 → 60
        expectedCloseDate: new Date('2026-08-10T00:00:00.000Z'),
      })
      const tieB = makeDealRow({
        id: 'tie-b',
        updatedAt: new Date('2026-07-01T00:00:00.000Z'), // -40 → 60
        expectedCloseDate: new Date('2026-08-05T00:00:00.000Z'),
      })
      prisma.deal.findMany.mockResolvedValue([tieA, tieB])

      const result = await service.findAtRisk('tenant-1', 'user-1', {}, NOW)

      expect(result.items.map((e) => e.deal.id)).toEqual(['tie-b', 'tie-a'])
    })

    it('paginates in TypeScript with defaults page 1 / size 20 and reports the full total', async () => {
      const deals = Array.from({ length: 25 }, (_, i) =>
        makeDealRow({
          id: `deal-${i}`,
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          expectedCloseDate: null,
        }),
      )
      prisma.deal.findMany.mockResolvedValue(deals)

      const result = await service.findAtRisk('tenant-1', 'user-1', {}, NOW)

      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(20)
      expect(result.items).toHaveLength(20)
      expect(result.total).toBe(25)

      const pageTwo = await service.findAtRisk('tenant-1', 'user-1', { page: 2, pageSize: 20 }, NOW)
      expect(pageTwo.items).toHaveLength(5)
      expect(pageTwo.total).toBe(25)
    })

    it('clamps pageSize at 100', async () => {
      prisma.deal.findMany.mockResolvedValue([])
      const result = await service.findAtRisk('tenant-1', 'user-1', { page: 1, pageSize: 500 }, NOW)
      expect(result.pageSize).toBe(100)
    })
  })

  describe('runSweep (AC 26-31)', () => {
    beforeEach(() => {
      prisma.deal.findMany.mockResolvedValue([])
    })

    it('builds its tenant-wide where from scratch — no buildDealWhere, no visibility filter (AC 26)', async () => {
      prisma.deal.findMany.mockResolvedValue([])
      await service.runSweep('tenant-1', 'user-1', NOW)

      expect(deals.buildDealWhere).not.toHaveBeenCalled()
      expect(prisma.deal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: 'tenant-1',
            deletedAt: null,
            stage: { isWon: false, isLost: false, deletedAt: null },
          },
        }),
      )
    })

    it('writes one row per reason for a stale deal (NO_ACTIVITY_7D + AT_RISK)', async () => {
      const stale = makeDealRow({
        updatedAt: new Date('2026-07-01T00:00:00.000Z'), // 31 days idle → score 60 (AT_RISK)
        expectedCloseDate: new Date('2026-08-20T00:00:00.000Z'),
      })
      prisma.deal.findMany.mockResolvedValue([stale])
      prisma.dealReminder.createMany.mockResolvedValue({ count: 2 })

      const result = await service.runSweep('tenant-1', 'user-1', NOW)

      expect(result.dealsEvaluated).toBe(1)
      expect(result.remindersCreated).toBe(2)
      expect(prisma.dealReminder.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            tenantId: 'tenant-1',
            dealId: 'deal-1',
            userId: 'user-1',
            reason: 'NO_ACTIVITY_7D',
            healthStatus: 'AT_RISK',
            healthScore: 60,
            sweepDate: new Date('2026-08-01T00:00:00.000Z'),
          }),
          expect.objectContaining({ reason: 'AT_RISK' }),
        ]),
        skipDuplicates: true,
      })
    })

    it('raises CLOSING_SOON_3D when 0 <= daysUntilClose <= 3', async () => {
      const closing = makeDealRow({
        updatedAt: new Date('2026-07-30T00:00:00.000Z'), // 2 days → healthy
        expectedCloseDate: new Date('2026-08-04T00:00:00.000Z'), // 3 days out
      })
      prisma.deal.findMany.mockResolvedValue([closing])
      prisma.dealReminder.createMany.mockResolvedValue({ count: 1 })

      await service.runSweep('tenant-1', 'user-1', NOW)

      expect(prisma.dealReminder.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ reason: 'CLOSING_SOON_3D' })],
        skipDuplicates: true,
      })
    })

    it('is idempotent within one UTC day — a second run adds nothing (AC 30)', async () => {
      const stale = makeDealRow({ updatedAt: new Date('2026-07-01T00:00:00.000Z') })
      prisma.deal.findMany.mockResolvedValue([stale])
      prisma.dealReminder.createMany
        .mockResolvedValueOnce({ count: 2 })
        .mockResolvedValueOnce({ count: 0 })

      const first = await service.runSweep('tenant-1', 'user-1', NOW)
      const second = await service.runSweep('tenant-1', 'user-1', NOW)

      expect(first.remindersCreated).toBe(2)
      // skipDuplicates makes the second write a no-op against @@unique
      expect(second.remindersCreated).toBe(0)
      expect(prisma.dealReminder.createMany).toHaveBeenCalledTimes(2)
    })

    it('suppresses a reason when the owner toggle for it is false (AC 28a)', async () => {
      const stale = makeDealRow({ updatedAt: new Date('2026-07-01T00:00:00.000Z') })
      prisma.deal.findMany.mockResolvedValue([stale])
      prisma.userReminderPreference.findMany.mockResolvedValue([
        {
          tenantId: 'tenant-1',
          userId: 'user-1',
          emailFrequency: 'DAILY',
          notifyNoActivity: false,
          notifyClosingSoon: true,
          notifyAtRisk: true,
        },
      ])
      prisma.dealReminder.createMany.mockResolvedValue({ count: 1 })

      await service.runSweep('tenant-1', 'user-1', NOW)

      const reasons = prisma.dealReminder.createMany.mock.calls[0][0].data.map(
        (row: { reason: string }) => row.reason,
      )
      expect(reasons).toEqual(['AT_RISK'])
    })

    it('emailFrequency OFF suppresses every reason (AC 28b)', async () => {
      const stale = makeDealRow({ updatedAt: new Date('2026-07-01T00:00:00.000Z') })
      prisma.deal.findMany.mockResolvedValue([stale])
      prisma.userReminderPreference.findMany.mockResolvedValue([
        {
          tenantId: 'tenant-1',
          userId: 'user-1',
          emailFrequency: 'OFF',
          notifyNoActivity: true,
          notifyClosingSoon: true,
          notifyAtRisk: true,
        },
      ])

      await service.runSweep('tenant-1', 'user-1', NOW)

      expect(prisma.dealReminder.createMany).not.toHaveBeenCalled()
      expect(audit.log).toHaveBeenCalled()
    })

    it('suppresses every reason for a deal the owner has actively snoozed (AC 28c)', async () => {
      const stale = makeDealRow({ updatedAt: new Date('2026-07-01T00:00:00.000Z') })
      prisma.deal.findMany.mockResolvedValue([stale])
      prisma.dealReminderSnooze.findMany.mockResolvedValue([{ dealId: 'deal-1', userId: 'user-1' }])

      await service.runSweep('tenant-1', 'user-1', NOW)

      expect(prisma.dealReminder.createMany).not.toHaveBeenCalled()
    })

    it('WEEKLY suppresses everything on a Tuesday and nothing on a Monday (AC 29)', async () => {
      const stale = makeDealRow({ updatedAt: new Date('2026-07-01T00:00:00.000Z') })
      prisma.userReminderPreference.findMany.mockResolvedValue([
        {
          tenantId: 'tenant-1',
          userId: 'user-1',
          emailFrequency: 'WEEKLY',
          notifyNoActivity: true,
          notifyClosingSoon: true,
          notifyAtRisk: true,
        },
      ])
      prisma.dealReminder.createMany.mockResolvedValue({ count: 0 })

      // Tuesday: sweepDate 2026-08-04 is a Tuesday → everything suppressed
      prisma.deal.findMany.mockResolvedValue([stale])
      await service.runSweep('tenant-1', 'user-1', TUESDAY)
      expect(prisma.dealReminder.createMany).not.toHaveBeenCalled()

      // Monday: sweepDate 2026-08-03 is a Monday → rows created
      prisma.dealReminder.createMany.mockClear()
      prisma.dealReminder.createMany.mockResolvedValue({ count: 2 })
      await service.runSweep('tenant-1', 'user-1', MONDAY)
      expect(prisma.dealReminder.createMany).toHaveBeenCalledTimes(1)
    })

    it('a user with no preference row is treated as all-defaults (AC 28)', async () => {
      const stale = makeDealRow({ updatedAt: new Date('2026-07-01T00:00:00.000Z') })
      prisma.deal.findMany.mockResolvedValue([stale])
      prisma.userReminderPreference.findMany.mockResolvedValue([])
      prisma.dealReminder.createMany.mockResolvedValue({ count: 2 })

      await service.runSweep('tenant-1', 'user-1', NOW)

      // The sweep reads preferences but must never create a preference row.
      expect(prisma.userReminderPreference.findMany).toHaveBeenCalled()
      expect(prisma.dealReminder.createMany).toHaveBeenCalledTimes(1)
    })

    it('calls AuditService.log explicitly with UPDATE/DEAL (AC 31)', async () => {
      prisma.deal.findMany.mockResolvedValue([makeDealRow()])
      prisma.dealReminder.createMany.mockResolvedValue({ count: 0 })

      await service.runSweep('tenant-1', 'user-1', NOW)

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          userId: 'user-1',
          action: 'UPDATE',
          entity: 'DEAL',
        }),
      )
    })
  })

  describe('ensureSweptToday (AC 32, 33)', () => {
    it('skips the sweep when a reminder row for today already exists', async () => {
      prisma.dealReminder.findFirst.mockResolvedValue({ id: 'reminder-1' })

      await service.ensureSweptToday('tenant-1', 'user-1', NOW)

      expect(prisma.dealReminder.findFirst).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', sweepDate: new Date('2026-08-01T00:00:00.000Z') },
        select: { id: true },
      })
      expect(prisma.deal.findMany).not.toHaveBeenCalled()
    })

    it('runs the sweep when no row exists for today', async () => {
      prisma.dealReminder.findFirst.mockResolvedValue(null)
      prisma.deal.findMany.mockResolvedValue([])

      await service.ensureSweptToday('tenant-1', 'user-1', NOW)

      expect(prisma.deal.findMany).toHaveBeenCalled()
    })

    it('swallows and logs sweep failures — never fails the calling query (AC 33)', async () => {
      prisma.dealReminder.findFirst.mockResolvedValue(null)
      prisma.deal.findMany.mockRejectedValue(new Error('DB hiccup'))
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

      await expect(service.ensureSweptToday('tenant-1', 'user-1', NOW)).resolves.toBeUndefined()

      errorSpy.mockRestore()
    })
  })

  describe('snoozeDealReminder (AC 38)', () => {
    it('rejects days outside 7, 14, 30', async () => {
      await expect(service.snoozeDealReminder('tenant-1', 'user-1', 'deal-1', 5)).rejects.toThrow(
        new BadRequestException('days must be one of 7, 14, 30'),
      )
      expect(deals.findOne).not.toHaveBeenCalled()
    })

    it('verifies deal access via DealsService.findOne then upserts on the unique key', async () => {
      deals.findOne.mockResolvedValue(makeDealRow())
      prisma.dealReminderSnooze.upsert.mockResolvedValue({
        id: 'snooze-1',
        snoozedUntil: new Date('2026-08-08T00:00:00.000Z'),
      })

      const result = await service.snoozeDealReminder('tenant-1', 'user-1', 'deal-1', 7, NOW)

      expect(deals.findOne).toHaveBeenCalledWith('tenant-1', 'user-1', 'deal-1')
      expect(prisma.dealReminderSnooze.upsert).toHaveBeenCalledWith({
        where: {
          tenantId_dealId_userId: { tenantId: 'tenant-1', dealId: 'deal-1', userId: 'user-1' },
        },
        create: expect.objectContaining({ snoozedUntil: new Date('2026-08-08T00:00:00.000Z') }),
        update: expect.objectContaining({ snoozedUntil: new Date('2026-08-08T00:00:00.000Z') }),
      })
      expect(result).toEqual({ id: 'snooze-1', snoozedUntil: new Date('2026-08-08T00:00:00.000Z') })
    })
  })

  describe('unsnoozeDealReminder (AC 39)', () => {
    it('throws NotFoundException when the updateMany count is 0 (TOCTOU guard)', async () => {
      deals.findOne.mockResolvedValue(makeDealRow())
      prisma.dealReminderSnooze.updateMany.mockResolvedValue({ count: 0 })

      await expect(service.unsnoozeDealReminder('tenant-1', 'user-1', 'deal-1')).rejects.toThrow(
        new NotFoundException('Snooze not found'),
      )
    })

    it('soft-deletes the active snooze and returns true', async () => {
      deals.findOne.mockResolvedValue(makeDealRow())
      prisma.dealReminderSnooze.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.unsnoozeDealReminder('tenant-1', 'user-1', 'deal-1')

      expect(prisma.dealReminderSnooze.updateMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', dealId: 'deal-1', userId: 'user-1', deletedAt: null },
        data: expect.objectContaining({ deletedAt: expect.any(Date), updatedBy: 'user-1' }),
      })
      expect(result).toBe(true)
    })
  })

  describe('reminder preferences (AC 40, 15)', () => {
    it('myReminderPreferences returns defaults without creating a row when none exists', async () => {
      prisma.userReminderPreference.findFirst.mockResolvedValue(null)

      const result = await service.myReminderPreferences('tenant-1', 'user-1')

      expect(result).toEqual({
        emailFrequency: 'DAILY',
        notifyNoActivity: true,
        notifyClosingSoon: true,
        notifyAtRisk: true,
      })
      expect(prisma.userReminderPreference.upsert).not.toHaveBeenCalled()
    })

    it('myReminderPreferences returns the persisted row when one exists', async () => {
      prisma.userReminderPreference.findFirst.mockResolvedValue({
        id: 'pref-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        emailFrequency: 'WEEKLY',
        notifyNoActivity: false,
        notifyClosingSoon: true,
        notifyAtRisk: true,
      })

      const result = await service.myReminderPreferences('tenant-1', 'user-1')

      expect(result).toEqual(
        expect.objectContaining({ emailFrequency: 'WEEKLY', notifyNoActivity: false }),
      )
    })

    it('updateReminderPreferences rejects an invalid emailFrequency (AC 15)', async () => {
      await expect(
        service.updateReminderPreferences('tenant-1', 'user-1', {
          emailFrequency: 'HOURLY',
          notifyNoActivity: true,
          notifyClosingSoon: true,
          notifyAtRisk: true,
        }),
      ).rejects.toThrow(new BadRequestException('emailFrequency must be one of DAILY, WEEKLY, OFF'))
    })

    it('updateReminderPreferences upserts on @@unique([tenantId, userId])', async () => {
      prisma.userReminderPreference.upsert.mockResolvedValue({
        id: 'pref-1',
        emailFrequency: 'WEEKLY',
        notifyNoActivity: true,
        notifyClosingSoon: false,
        notifyAtRisk: true,
      })

      const result = await service.updateReminderPreferences('tenant-1', 'user-1', {
        emailFrequency: 'WEEKLY',
        notifyNoActivity: true,
        notifyClosingSoon: false,
        notifyAtRisk: true,
      })

      expect(prisma.userReminderPreference.upsert).toHaveBeenCalledWith({
        where: { tenantId_userId: { tenantId: 'tenant-1', userId: 'user-1' } },
        create: expect.objectContaining({ emailFrequency: 'WEEKLY', notifyClosingSoon: false }),
        update: expect.objectContaining({ emailFrequency: 'WEEKLY', notifyClosingSoon: false }),
      })
      expect(result).toEqual(expect.objectContaining({ emailFrequency: 'WEEKLY' }))
    })
  })
})
