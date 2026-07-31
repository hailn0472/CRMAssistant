import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import { DealsService } from '../deals/deals.service'
import { isWinLossReason } from './win-loss-reasons'

export type AddDealCompetitorInput = {
  dealId: string
  competitorId: string
  note?: string | null
}

export type RecordWinLossInput = {
  dealId: string
  stageId?: string
  reason: string
  competitorId?: string | null
  note?: string | null
}

const MAX_NOTE_LENGTH = 500

// Every scalar field CompetitorRef exposes must be covered by this include
// (AC #20 — the nested-ref crash from Story 3.4).
const DEAL_COMPETITOR_INCLUDE: Record<string, unknown> = {
  competitor: {
    select: {
      id: true,
      name: true,
      website: true,
      strengths: true,
      weaknesses: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  },
}

@Injectable()
export class DealCompetitorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deals: DealsService,
  ) {}

  async findManyForDeal(
    tenantId: string,
    userId: string,
    dealId: string,
  ): Promise<Record<string, unknown>[]> {
    // Resolve deal through DealsService.findOne — enforces tenant + visibility
    await this.deals.findOne(tenantId, userId, dealId)

    return this.prisma.dealCompetitor.findMany({
      where: { tenantId, dealId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: DEAL_COMPETITOR_INCLUDE,
    })
  }

  async add(
    tenantId: string,
    userId: string,
    input: AddDealCompetitorInput,
  ): Promise<Record<string, unknown>> {
    // Verify deal visibility
    await this.deals.findOne(tenantId, userId, input.dealId)

    // Verify competitor exists in tenant
    const competitor = await this.prisma.competitor.findFirst({
      where: { id: input.competitorId, tenantId, deletedAt: null },
    })
    if (!competitor) {
      throw new NotFoundException('Competitor not found')
    }

    // Reject duplicate active link (no DB unique constraint)
    const existing = await this.prisma.dealCompetitor.findFirst({
      where: { tenantId, dealId: input.dealId, competitorId: input.competitorId, deletedAt: null },
    })
    if (existing) {
      throw new ConflictException('Competitor already linked to this deal')
    }

    const link = await this.prisma.dealCompetitor.create({
      data: {
        tenantId,
        dealId: input.dealId,
        competitorId: input.competitorId,
        note: input.note ?? null,
        createdBy: userId,
        updatedBy: userId,
      },
      include: DEAL_COMPETITOR_INCLUDE,
    })

    // Publish deal update after commit
    const deal = await this.deals.findOne(tenantId, userId, input.dealId)
    this.deals.publishDealUpdate(tenantId, deal)

    return link
  }

  async remove(tenantId: string, userId: string, id: string): Promise<boolean> {
    // Load the link row first — the deal is re-verified from link.dealId,
    // never from a client-supplied id (AC #13).
    const link = await this.prisma.dealCompetitor.findFirst({
      where: { id, tenantId, deletedAt: null },
    })
    if (!link) {
      throw new NotFoundException('Deal competitor link not found')
    }

    // Re-verify deal visibility from the loaded link row's dealId
    await this.deals.findOne(tenantId, userId, link.dealId)

    await this.prisma.dealCompetitor.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: userId },
    })

    // Publish deal update after commit
    const deal = await this.deals.findOne(tenantId, userId, link.dealId)
    this.deals.publishDealUpdate(tenantId, deal)

    return true
  }

  /**
   * Atomically moves the deal to a closed stage (when stageId is supplied),
   * records the win/loss reason/note/competitor, and upserts the DealCompetitor
   * link — so Deal.competitorId can never point at a competitor that is not
   * also linked to the deal (AC #7, #11). Publishes on the existing
   * DEAL_UPDATED channel after commit (AC #12).
   */
  async recordWinLoss(
    tenantId: string,
    userId: string,
    input: RecordWinLossInput,
  ): Promise<Record<string, unknown>> {
    // ─── Pure validation (AC #9, #10) ───────────────────────────────────────
    const reason = input.reason?.trim() ?? ''
    if (!reason) {
      throw new BadRequestException('reason is required')
    }
    if (!isWinLossReason(reason)) {
      throw new BadRequestException('Invalid win/loss reason')
    }

    const note = input.note?.trim() || undefined
    if (reason === 'OTHER') {
      if (!note) {
        throw new BadRequestException('note is required when reason is OTHER')
      }
      if (note.length > MAX_NOTE_LENGTH) {
        throw new BadRequestException(`note must be at most ${MAX_NOTE_LENGTH} characters`)
      }
    }

    const competitorId = input.competitorId?.trim() || undefined
    if (reason === 'COMPETITOR' && !competitorId) {
      throw new BadRequestException('competitorId is required when reason is COMPETITOR')
    }

    // ─── Deal access (AC #13, #14) ──────────────────────────────────────────
    await this.deals.findOne(tenantId, userId, input.dealId)

    // ─── One interactive transaction (AC #7) ────────────────────────────────
    await this.prisma.$transaction(async (tx) => {
      if (competitorId) {
        // Verify the competitor exists inside the transaction so a bad id
        // rolls everything back before any FK-violating write (AC #14, I-TC7.3).
        const competitor = await tx.competitor.findFirst({
          where: { id: competitorId, tenantId, deletedAt: null },
        })
        if (!competitor) {
          throw new NotFoundException('Competitor not found')
        }
      }

      if (input.stageId) {
        const stage = await tx.dealStage.findFirst({
          where: { id: input.stageId, tenantId, deletedAt: null },
        })
        if (!stage || (!stage.isWon && !stage.isLost)) {
          throw new BadRequestException('stageId must reference a closed stage')
        }
        await tx.deal.update({
          where: { id: input.dealId },
          data: {
            stageId: stage.id,
            probability: stage.probability,
            actualCloseDate: new Date(),
            updatedBy: userId,
          },
        })
      }

      await tx.deal.update({
        where: { id: input.dealId },
        data: {
          winLossReason: reason,
          winLossNote: note ?? null,
          competitorId: competitorId ?? null,
          updatedBy: userId,
        },
      })

      if (competitorId) {
        // Upsert semantics — no DB unique key on [dealId, competitorId], so
        // find the active row first, then create or update it (AC #11).
        const existing = await tx.dealCompetitor.findFirst({
          where: { tenantId, dealId: input.dealId, competitorId, deletedAt: null },
        })
        if (existing) {
          await tx.dealCompetitor.update({
            where: { id: existing.id },
            data: { note: note ?? existing.note, updatedBy: userId },
          })
        } else {
          await tx.dealCompetitor.create({
            data: {
              tenantId,
              dealId: input.dealId,
              competitorId,
              note: note ?? null,
              createdBy: userId,
              updatedBy: userId,
            },
          })
        }
      }
    })

    // ─── Re-read + publish after commit (AC #12) ────────────────────────────
    const deal = await this.deals.findOne(tenantId, userId, input.dealId)
    this.deals.publishDealUpdate(tenantId, deal)

    return deal
  }
}
