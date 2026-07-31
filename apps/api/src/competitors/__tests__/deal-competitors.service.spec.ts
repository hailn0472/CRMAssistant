import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'

import { DealCompetitorsService } from '../deal-competitors.service'

// ─── Mock Prisma with a self-referential $transaction ────────────────────────
// tx.<delegate> === prisma.<delegate>, so existing mockResolvedValue setups
// keep working inside the transaction callback.

type MockDealDelegate = {
  update: jest.Mock
  findFirst: jest.Mock
}

type MockDealStageDelegate = {
  findFirst: jest.Mock
}

type MockDealCompetitorDelegate = {
  findFirst: jest.Mock
  findMany: jest.Mock
  create: jest.Mock
  update: jest.Mock
}

type MockCompetitorDelegate = {
  findFirst: jest.Mock
}

type MockPrisma = {
  deal: MockDealDelegate
  dealStage: MockDealStageDelegate
  dealCompetitor: MockDealCompetitorDelegate
  competitor: MockCompetitorDelegate
  $transaction: jest.Mock
}

function makePrisma(): MockPrisma {
  const delegates = {
    deal: { update: jest.fn(), findFirst: jest.fn() },
    dealStage: { findFirst: jest.fn() },
    dealCompetitor: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    competitor: { findFirst: jest.fn() },
  }
  return {
    ...delegates,
    $transaction: jest.fn((cb: (tx: typeof delegates) => unknown) => cb(delegates)),
  }
}

function makeDealsService(): {
  findOne: jest.Mock
  publishDealUpdate: jest.Mock
} {
  return {
    findOne: jest.fn().mockResolvedValue({
      id: 'deal-1',
      tenantId: 'tenant-1',
      title: 'Big Deal',
      value: 50000,
      currency: 'USD',
      probability: 10,
      stageId: 'stage-open',
    }),
    publishDealUpdate: jest.fn(),
  }
}

const TENANT_ID = 'tenant-1'
const OTHER_TENANT_ID = 'tenant-2'
const USER_ID = 'user-1'
const DEAL_ID = 'deal-1'
const COMPETITOR_ID = 'competitor-1'

function makeLink(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'link-1',
    tenantId: TENANT_ID,
    dealId: DEAL_ID,
    competitorId: COMPETITOR_ID,
    note: null,
    deletedAt: null,
    ...overrides,
  }
}

function makeCompetitor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: COMPETITOR_ID,
    tenantId: TENANT_ID,
    name: 'Acme Corp',
    isActive: true,
    deletedAt: null,
    ...overrides,
  }
}

describe('DealCompetitorsService', () => {
  let service: DealCompetitorsService
  let prisma: MockPrisma
  let deals: ReturnType<typeof makeDealsService>

  beforeEach(() => {
    prisma = makePrisma()
    deals = makeDealsService()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new DealCompetitorsService(prisma as any, deals as any)
  })

  describe('findManyForDeal', () => {
    it('verifies deal via DealsService.findOne first', async () => {
      prisma.dealCompetitor.findMany.mockResolvedValue([])
      await service.findManyForDeal(TENANT_ID, USER_ID, DEAL_ID)
      expect(deals.findOne).toHaveBeenCalledWith(TENANT_ID, USER_ID, DEAL_ID)
    })

    it('propagates NotFoundException for an inaccessible deal', async () => {
      deals.findOne.mockRejectedValue(new NotFoundException('Deal not found'))
      await expect(service.findManyForDeal(OTHER_TENANT_ID, USER_ID, DEAL_ID)).rejects.toThrow(
        'Deal not found',
      )
    })

    it('returns links with a competitor include covering every ref field (AC #20)', async () => {
      prisma.dealCompetitor.findMany.mockResolvedValue([makeLink()])
      await service.findManyForDeal(TENANT_ID, USER_ID, DEAL_ID)
      expect(prisma.dealCompetitor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_ID, dealId: DEAL_ID, deletedAt: null }),
          include: expect.objectContaining({
            competitor: expect.objectContaining({
              select: expect.objectContaining({
                id: true,
                name: true,
                website: true,
                strengths: true,
                weaknesses: true,
                isActive: true,
                createdAt: true,
                updatedAt: true,
              }),
            }),
          }),
        }),
      )
    })
  })

  describe('add', () => {
    it('verifies deal access then checks the competitor exists', async () => {
      prisma.competitor.findFirst.mockResolvedValue(makeCompetitor())
      prisma.dealCompetitor.findFirst.mockResolvedValue(null)
      prisma.dealCompetitor.create.mockResolvedValue(makeLink())
      await service.add(TENANT_ID, USER_ID, { dealId: DEAL_ID, competitorId: COMPETITOR_ID })
      expect(deals.findOne).toHaveBeenCalledWith(TENANT_ID, USER_ID, DEAL_ID)
      expect(prisma.competitor.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: COMPETITOR_ID, tenantId: TENANT_ID, deletedAt: null },
        }),
      )
    })

    it('throws NotFoundException when the competitor is missing or soft-deleted (AC #14)', async () => {
      prisma.competitor.findFirst.mockResolvedValue(null)
      await expect(
        service.add(TENANT_ID, USER_ID, { dealId: DEAL_ID, competitorId: 'missing' }),
      ).rejects.toThrow(NotFoundException)
      await expect(
        service.add(TENANT_ID, USER_ID, { dealId: DEAL_ID, competitorId: 'missing' }),
      ).rejects.toThrow('Competitor not found')
    })

    it('rejects a duplicate active link with ConflictException (AC #13)', async () => {
      prisma.competitor.findFirst.mockResolvedValue(makeCompetitor())
      prisma.dealCompetitor.findFirst.mockResolvedValue(makeLink())
      await expect(
        service.add(TENANT_ID, USER_ID, { dealId: DEAL_ID, competitorId: COMPETITOR_ID }),
      ).rejects.toThrow(ConflictException)
      await expect(
        service.add(TENANT_ID, USER_ID, { dealId: DEAL_ID, competitorId: COMPETITOR_ID }),
      ).rejects.toThrow('Competitor already linked to this deal')
    })

    it('allows re-adding a competitor whose previous link was removed', async () => {
      prisma.competitor.findFirst.mockResolvedValue(makeCompetitor())
      prisma.dealCompetitor.findFirst.mockResolvedValue(null) // no active row
      prisma.dealCompetitor.create.mockResolvedValue(makeLink())
      await expect(
        service.add(TENANT_ID, USER_ID, { dealId: DEAL_ID, competitorId: COMPETITOR_ID }),
      ).resolves.toEqual(makeLink())
    })

    it('publishes a deal update after commit', async () => {
      prisma.competitor.findFirst.mockResolvedValue(makeCompetitor())
      prisma.dealCompetitor.findFirst.mockResolvedValue(null)
      prisma.dealCompetitor.create.mockResolvedValue(makeLink())
      await service.add(TENANT_ID, USER_ID, { dealId: DEAL_ID, competitorId: COMPETITOR_ID })
      expect(deals.publishDealUpdate).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ id: DEAL_ID }),
      )
    })
  })

  describe('remove', () => {
    it('loads the link by { id, tenantId, deletedAt: null } and re-verifies the deal from link.dealId (AC #13)', async () => {
      prisma.dealCompetitor.findFirst.mockResolvedValue(makeLink())
      prisma.dealCompetitor.update.mockResolvedValue(makeLink({ deletedAt: new Date() }))
      await service.remove(TENANT_ID, USER_ID, 'link-1')
      expect(prisma.dealCompetitor.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'link-1', tenantId: TENANT_ID, deletedAt: null },
        }),
      )
      // Re-verification uses the loaded row's dealId — not a client-supplied id
      expect(deals.findOne).toHaveBeenCalledWith(TENANT_ID, USER_ID, DEAL_ID)
      expect(prisma.dealCompetitor.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'link-1' },
          data: expect.objectContaining({ deletedAt: expect.any(Date), updatedBy: USER_ID }),
        }),
      )
    })

    it('a SALES_REP with OWN visibility cannot unlink a competitor from a colleague deal (AC #13)', async () => {
      prisma.dealCompetitor.findFirst.mockResolvedValue(makeLink())
      deals.findOne.mockRejectedValue(new NotFoundException('Deal not found'))
      await expect(service.remove(TENANT_ID, 'rep-b', 'link-1')).rejects.toThrow('Deal not found')
      expect(prisma.dealCompetitor.update).not.toHaveBeenCalled()
    })

    it('throws NotFoundException when the link row is missing', async () => {
      prisma.dealCompetitor.findFirst.mockResolvedValue(null)
      await expect(service.remove(TENANT_ID, USER_ID, 'missing')).rejects.toThrow(NotFoundException)
    })

    it('publishes a deal update after remove', async () => {
      prisma.dealCompetitor.findFirst.mockResolvedValue(makeLink())
      prisma.dealCompetitor.update.mockResolvedValue(makeLink({ deletedAt: new Date() }))
      await service.remove(TENANT_ID, USER_ID, 'link-1')
      expect(deals.publishDealUpdate).toHaveBeenCalledWith(TENANT_ID, expect.anything())
    })
  })

  describe('recordWinLoss — reason validation (AC #9)', () => {
    it('rejects an empty reason', async () => {
      await expect(
        service.recordWinLoss(TENANT_ID, USER_ID, { dealId: DEAL_ID, reason: '' }),
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.recordWinLoss(TENANT_ID, USER_ID, { dealId: DEAL_ID, reason: '   ' }),
      ).rejects.toThrow('reason is required')
    })

    it('rejects a reason outside WIN_LOSS_REASONS', async () => {
      await expect(
        service.recordWinLoss(TENANT_ID, USER_ID, { dealId: DEAL_ID, reason: 'INVALID' }),
      ).rejects.toThrow('Invalid win/loss reason')
    })

    it('accepts every valid reason (pure validation passes)', async () => {
      for (const reason of ['PRICE', 'FEATURES', 'TIMING', 'COMPETITOR', 'BUDGET', 'OTHER']) {
        prisma.dealCompetitor.findFirst.mockResolvedValue(null)
        prisma.dealCompetitor.create.mockResolvedValue(makeLink())
        if (reason === 'OTHER') {
          await service.recordWinLoss(TENANT_ID, USER_ID, { dealId: DEAL_ID, reason, note: 'why' })
        } else if (reason === 'COMPETITOR') {
          prisma.competitor.findFirst.mockResolvedValue(makeCompetitor())
          await service.recordWinLoss(TENANT_ID, USER_ID, {
            dealId: DEAL_ID,
            reason,
            competitorId: COMPETITOR_ID,
          })
        } else {
          await service.recordWinLoss(TENANT_ID, USER_ID, { dealId: DEAL_ID, reason })
        }
        // deal.update was called with the reason
        expect(prisma.deal.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ winLossReason: reason, updatedBy: USER_ID }),
          }),
        )
        jest.clearAllMocks()
      }
    })
  })

  describe('recordWinLoss — conditional field requirements (AC #10)', () => {
    it('OTHER without note → error', async () => {
      await expect(
        service.recordWinLoss(TENANT_ID, USER_ID, { dealId: DEAL_ID, reason: 'OTHER' }),
      ).rejects.toThrow('note is required when reason is OTHER')
    })

    it('OTHER with empty note → error', async () => {
      await expect(
        service.recordWinLoss(TENANT_ID, USER_ID, { dealId: DEAL_ID, reason: 'OTHER', note: '  ' }),
      ).rejects.toThrow('note is required when reason is OTHER')
    })

    it('OTHER with a 501-char note → error (max 500)', async () => {
      await expect(
        service.recordWinLoss(TENANT_ID, USER_ID, {
          dealId: DEAL_ID,
          reason: 'OTHER',
          note: 'a'.repeat(501),
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('OTHER with a valid note passes', async () => {
      prisma.dealCompetitor.findFirst.mockResolvedValue(null)
      await service.recordWinLoss(TENANT_ID, USER_ID, {
        dealId: DEAL_ID,
        reason: 'OTHER',
        note: 'Budget was cut',
      })
      expect(prisma.deal.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ winLossNote: 'Budget was cut' }),
        }),
      )
    })

    it('COMPETITOR without competitorId → error', async () => {
      await expect(
        service.recordWinLoss(TENANT_ID, USER_ID, { dealId: DEAL_ID, reason: 'COMPETITOR' }),
      ).rejects.toThrow('competitorId is required when reason is COMPETITOR')
    })

    it('COMPETITOR with a valid competitorId passes', async () => {
      prisma.competitor.findFirst.mockResolvedValue(makeCompetitor())
      prisma.dealCompetitor.findFirst.mockResolvedValue(null)
      prisma.dealCompetitor.create.mockResolvedValue(makeLink())
      await service.recordWinLoss(TENANT_ID, USER_ID, {
        dealId: DEAL_ID,
        reason: 'COMPETITOR',
        competitorId: COMPETITOR_ID,
      })
      expect(prisma.deal.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ competitorId: COMPETITOR_ID }),
        }),
      )
    })

    it('PRICE needs neither note nor competitorId', async () => {
      await service.recordWinLoss(TENANT_ID, USER_ID, { dealId: DEAL_ID, reason: 'PRICE' })
      expect(prisma.deal.update).toHaveBeenCalled()
    })
  })

  describe('recordWinLoss — stage validation (AC #8)', () => {
    it('rejects a stageId that is neither won nor lost', async () => {
      prisma.dealStage.findFirst.mockResolvedValue({
        id: 'stage-open',
        tenantId: TENANT_ID,
        name: 'Qualified',
        probability: 40,
        isWon: false,
        isLost: false,
      })
      await expect(
        service.recordWinLoss(TENANT_ID, USER_ID, {
          dealId: DEAL_ID,
          stageId: 'stage-open',
          reason: 'PRICE',
        }),
      ).rejects.toThrow('stageId must reference a closed stage')
      expect(prisma.deal.update).not.toHaveBeenCalled()
    })

    it('rejects a missing stageId', async () => {
      prisma.dealStage.findFirst.mockResolvedValue(null)
      await expect(
        service.recordWinLoss(TENANT_ID, USER_ID, {
          dealId: DEAL_ID,
          stageId: 'stage-ghost',
          reason: 'PRICE',
        }),
      ).rejects.toThrow('stageId must reference a closed stage')
    })

    it('accepts a stage with isWon: true', async () => {
      prisma.dealStage.findFirst.mockResolvedValue({
        id: 'stage-won',
        tenantId: TENANT_ID,
        name: 'Closed Won',
        probability: 100,
        isWon: true,
        isLost: false,
      })
      await service.recordWinLoss(TENANT_ID, USER_ID, {
        dealId: DEAL_ID,
        stageId: 'stage-won',
        reason: 'PRICE',
      })
      expect(prisma.deal.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stageId: 'stage-won',
            probability: 100,
            actualCloseDate: expect.any(Date),
          }),
        }),
      )
    })

    it('accepts a stage with isLost: true', async () => {
      prisma.dealStage.findFirst.mockResolvedValue({
        id: 'stage-lost',
        tenantId: TENANT_ID,
        name: 'Closed Lost',
        probability: 0,
        isWon: false,
        isLost: true,
      })
      await service.recordWinLoss(TENANT_ID, USER_ID, {
        dealId: DEAL_ID,
        stageId: 'stage-lost',
        reason: 'BUDGET',
      })
      expect(prisma.deal.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ stageId: 'stage-lost', probability: 0 }),
        }),
      )
    })

    it('omits the stage move entirely when stageId is not supplied', async () => {
      prisma.dealCompetitor.findFirst.mockResolvedValue(null)
      await service.recordWinLoss(TENANT_ID, USER_ID, { dealId: DEAL_ID, reason: 'PRICE' })
      const stageMoveCalls = prisma.deal.update.mock.calls.filter(
        (call) => call[0].data?.stageId !== undefined,
      )
      expect(stageMoveCalls).toHaveLength(0)
      expect(prisma.dealStage.findFirst).not.toHaveBeenCalled()
    })
  })

  describe('recordWinLoss — transaction contents (AC #7, #11)', () => {
    it('runs the whole flow inside one prisma.$transaction', async () => {
      prisma.dealStage.findFirst.mockResolvedValue({
        id: 'stage-lost',
        tenantId: TENANT_ID,
        name: 'Closed Lost',
        probability: 0,
        isWon: false,
        isLost: true,
      })
      prisma.competitor.findFirst.mockResolvedValue(makeCompetitor())
      prisma.dealCompetitor.findFirst.mockResolvedValue(null)
      prisma.dealCompetitor.create.mockResolvedValue(makeLink())

      await service.recordWinLoss(TENANT_ID, USER_ID, {
        dealId: DEAL_ID,
        stageId: 'stage-lost',
        reason: 'COMPETITOR',
        competitorId: COMPETITOR_ID,
        note: 'Lost to Acme',
      })

      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      // stage move + win/loss fields + link create all happened inside the tx
      expect(prisma.deal.update).toHaveBeenCalledTimes(2)
      expect(prisma.dealCompetitor.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_ID,
            dealId: DEAL_ID,
            competitorId: COMPETITOR_ID,
            createdBy: USER_ID,
            updatedBy: USER_ID,
          }),
        }),
      )
    })

    it('upserts the existing link instead of creating a duplicate (AC #11)', async () => {
      prisma.competitor.findFirst.mockResolvedValue(makeCompetitor())
      prisma.dealCompetitor.findFirst.mockResolvedValue(makeLink({ note: 'old note' }))
      prisma.dealCompetitor.update.mockResolvedValue(makeLink({ note: 'new note' }))
      await service.recordWinLoss(TENANT_ID, USER_ID, {
        dealId: DEAL_ID,
        reason: 'COMPETITOR',
        competitorId: COMPETITOR_ID,
        note: 'new note',
      })
      expect(prisma.dealCompetitor.create).not.toHaveBeenCalled()
      expect(prisma.dealCompetitor.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'link-1' },
          data: expect.objectContaining({ note: 'new note', updatedBy: USER_ID }),
        }),
      )
    })

    it('creates no link when competitorId is not supplied', async () => {
      await service.recordWinLoss(TENANT_ID, USER_ID, { dealId: DEAL_ID, reason: 'PRICE' })
      expect(prisma.dealCompetitor.create).not.toHaveBeenCalled()
      expect(prisma.dealCompetitor.findFirst).not.toHaveBeenCalled()
    })

    it('rolls back when competitorId points at a missing competitor (AC #14)', async () => {
      prisma.dealStage.findFirst.mockResolvedValue({
        id: 'stage-lost',
        tenantId: TENANT_ID,
        name: 'Closed Lost',
        probability: 0,
        isWon: false,
        isLost: true,
      })
      prisma.competitor.findFirst.mockResolvedValue(null)
      await expect(
        service.recordWinLoss(TENANT_ID, USER_ID, {
          dealId: DEAL_ID,
          stageId: 'stage-lost',
          reason: 'COMPETITOR',
          competitorId: 'missing',
        }),
      ).rejects.toThrow('Competitor not found')
    })
  })

  describe('recordWinLoss — re-read + publish (AC #12)', () => {
    it('re-reads the deal via findOne then publishes on DEAL_UPDATED', async () => {
      const reReadDeal = { id: DEAL_ID, title: 'Big Deal', winLossReason: 'PRICE' }
      deals.findOne
        .mockResolvedValueOnce({ id: DEAL_ID, title: 'Big Deal' }) // access check
        .mockResolvedValueOnce(reReadDeal) // re-read after commit
      await service.recordWinLoss(TENANT_ID, USER_ID, { dealId: DEAL_ID, reason: 'PRICE' })
      expect(deals.findOne).toHaveBeenCalledTimes(2)
      expect(deals.findOne).toHaveBeenLastCalledWith(TENANT_ID, USER_ID, DEAL_ID)
      expect(deals.publishDealUpdate).toHaveBeenCalledWith(TENANT_ID, reReadDeal)
    })

    it('publishes the freshly re-read deal, not a stale object', async () => {
      const freshDeal = { id: DEAL_ID, winLossReason: 'BUDGET' }
      deals.findOne
        .mockResolvedValueOnce({ id: DEAL_ID, winLossReason: null })
        .mockResolvedValueOnce(freshDeal)
      await service.recordWinLoss(TENANT_ID, USER_ID, { dealId: DEAL_ID, reason: 'BUDGET' })
      expect(deals.publishDealUpdate).toHaveBeenCalledWith(TENANT_ID, freshDeal)
    })

    it('never re-verifies deal access twice for the same dealId', async () => {
      deals.findOne.mockResolvedValue({ id: DEAL_ID })
      await service.recordWinLoss(TENANT_ID, USER_ID, { dealId: DEAL_ID, reason: 'PRICE' })
      expect(deals.findOne).toHaveBeenCalledTimes(2) // access check + re-read only
    })
  })

  describe('recordWinLoss — NotFound consistency (AC #14)', () => {
    it('surfaces Deal not found for cross-tenant, soft-deleted and not-visible deals', async () => {
      for (const failure of [
        new NotFoundException('Deal not found'),
        new NotFoundException('Deal not found'),
      ]) {
        deals.findOne.mockRejectedValueOnce(failure)
        await expect(
          service.recordWinLoss(OTHER_TENANT_ID, USER_ID, { dealId: DEAL_ID, reason: 'PRICE' }),
        ).rejects.toThrow('Deal not found')
      }
    })

    it('validates reason before touching the deal (cheap failure first)', async () => {
      await expect(
        service.recordWinLoss(OTHER_TENANT_ID, USER_ID, { dealId: DEAL_ID, reason: '' }),
      ).rejects.toThrow('reason is required')
      expect(deals.findOne).not.toHaveBeenCalled()
    })
  })
})
