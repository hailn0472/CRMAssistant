import { BadRequestException, Injectable } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import { DealsService } from '../deals/deals.service'
import { detectMostFrequentCurrency, parseDateOrThrow } from './forecast.service'
import type { Prisma } from '@prisma/client'

// ─── Types ───────────────────────────────────────────────────────────────────

export type WinLossAnalysisInput = {
  startDate: string
  endDate: string
  ownerId?: string
  teamId?: string
}

export type WinLossReasonBucket = {
  reason: string
  count: number
  totalValue: number
  percentage: number
}

export type CompetitorOutcome = {
  competitorId: string
  competitorName: string
  wonCount: number
  lostCount: number
  winRate: number
  totalValue: number
}

export type WinLossAnalysisResult = {
  totalClosed: number
  wonCount: number
  lostCount: number
  winRate: number
  wonValue: number
  lostValue: number
  currency: string
  lossReasons: WinLossReasonBucket[]
  winReasons: WinLossReasonBucket[]
  competitors: CompetitorOutcome[]
}

// ─── Deal shape for win/loss computation ─────────────────────────────────────

type DealWinLossItem = {
  id: string
  value: number
  currency: string
  winLossReason: string | null
  competitorId: string | null
  stage: { isWon: boolean; isLost: boolean } | null
  competitor: { id: string; name: string } | null
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class WinLossService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dealsService: DealsService,
  ) {}

  /**
   * Win/loss analysis over deals whose actualCloseDate falls in the range.
   * Inherits the caller's data-visibility filter via buildDealWhere — a rep
   * with OWN visibility sees their own win rate, not a tenant-wide leak.
   */
  async winLossAnalysis(
    tenantId: string,
    userId: string,
    input: WinLossAnalysisInput,
  ): Promise<WinLossAnalysisResult> {
    const startDate = parseDateOrThrow(input.startDate, 'startDate')
    const endDate = parseDateOrThrow(input.endDate, 'endDate')

    // Validate range (mirrors ForecastService.salesForecast)
    if (endDate < startDate) {
      throw new BadRequestException('endDate must be >= startDate')
    }

    // Max 36 months
    const monthsDiff =
      (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
      endDate.getUTCMonth() -
      startDate.getUTCMonth()
    if (monthsDiff > 36) {
      throw new BadRequestException('Win/loss range must not exceed 36 months')
    }

    // Inclusive end-of-day so deals closed any time on the end date count
    const endOfDay = new Date(endDate)
    endOfDay.setUTCHours(23, 59, 59, 999)

    // Base where from DealsService.buildDealWhere — inherits visibility filter
    const baseWhere = await this.dealsService.buildDealWhere(tenantId, userId, {
      ownerId: input.ownerId,
    })

    const where: Prisma.DealWhereInput = {
      ...baseWhere,
      actualCloseDate: { gte: startDate, lte: endOfDay },
      stage: { OR: [{ isWon: true }, { isLost: true }] },
    }

    // Apply teamId filter if provided — narrow on top of visibility
    if (input.teamId) {
      where.AND = [
        ...(Array.isArray(baseWhere.AND) ? baseWhere.AND : baseWhere.AND ? [baseWhere.AND] : []),
        { owner: { teamId: input.teamId, deletedAt: null } },
      ]
    }

    // Fetch directly via prisma.deal.findMany — NEVER DealsService.findMany,
    // which clamps pageSize at 100 (AC #22).
    const deals = (await this.prisma.deal.findMany({
      where,
      select: {
        id: true,
        value: true,
        currency: true,
        winLossReason: true,
        competitorId: true,
        stage: { select: { isWon: true, isLost: true } },
        competitor: { select: { id: true, name: true } },
      },
    })) as unknown as DealWinLossItem[]

    // ─── In-memory reduce (AC #24) ─────────────────────────────────────────
    let wonCount = 0
    let lostCount = 0
    let wonValue = 0
    let lostValue = 0

    const winBuckets = new Map<string, { count: number; totalValue: number }>()
    const lossBuckets = new Map<string, { count: number; totalValue: number }>()
    const competitorMap = new Map<
      string,
      { name: string; wonCount: number; lostCount: number; totalValue: number }
    >()

    for (const deal of deals) {
      const isWon = deal.stage?.isWon ?? false
      const isLost = deal.stage?.isLost ?? false

      if (isWon) {
        wonCount += 1
        wonValue += deal.value
        // Closed deals with a null reason count, but produce no bucket
        if (deal.winLossReason) {
          const bucket = winBuckets.get(deal.winLossReason) ?? { count: 0, totalValue: 0 }
          bucket.count += 1
          bucket.totalValue += deal.value
          winBuckets.set(deal.winLossReason, bucket)
        }
      } else if (isLost) {
        lostCount += 1
        lostValue += deal.value
        if (deal.winLossReason) {
          const bucket = lossBuckets.get(deal.winLossReason) ?? { count: 0, totalValue: 0 }
          bucket.count += 1
          bucket.totalValue += deal.value
          lossBuckets.set(deal.winLossReason, bucket)
        }
      }

      if (deal.competitor) {
        const entry = competitorMap.get(deal.competitor.id) ?? {
          name: deal.competitor.name,
          wonCount: 0,
          lostCount: 0,
          totalValue: 0,
        }
        if (isWon) entry.wonCount += 1
        if (isLost) entry.lostCount += 1
        entry.totalValue += deal.value
        competitorMap.set(deal.competitor.id, entry)
      }
    }

    const totalClosed = wonCount + lostCount
    // winRate = wonCount / totalClosed * 100 — 0 when nothing closed (no div-by-zero)
    const winRate = totalClosed > 0 ? round1((wonCount / totalClosed) * 100) : 0

    const winReasons: WinLossReasonBucket[] = Array.from(winBuckets.entries())
      .map(([reason, bucket]) => ({
        reason,
        count: bucket.count,
        totalValue: bucket.totalValue,
        // percentage relative to the win side only
        percentage: wonCount > 0 ? round1((bucket.count / wonCount) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))

    const lossReasons: WinLossReasonBucket[] = Array.from(lossBuckets.entries())
      .map(([reason, bucket]) => ({
        reason,
        count: bucket.count,
        totalValue: bucket.totalValue,
        // percentage relative to the loss side only
        percentage: lostCount > 0 ? round1((bucket.count / lostCount) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))

    const competitors: CompetitorOutcome[] = Array.from(competitorMap.entries())
      .map(([competitorId, entry]) => {
        const closed = entry.wonCount + entry.lostCount
        return {
          competitorId,
          competitorName: entry.name,
          wonCount: entry.wonCount,
          lostCount: entry.lostCount,
          winRate: closed > 0 ? round1((entry.wonCount / closed) * 100) : 0,
          totalValue: entry.totalValue,
        }
      })
      .sort(
        (a, b) => b.totalValue - a.totalValue || a.competitorName.localeCompare(b.competitorName),
      )

    const currency = detectMostFrequentCurrency(deals)

    return {
      totalClosed,
      wonCount,
      lostCount,
      winRate,
      wonValue,
      lostValue,
      currency,
      lossReasons,
      winReasons,
      competitors,
    }
  }
}
