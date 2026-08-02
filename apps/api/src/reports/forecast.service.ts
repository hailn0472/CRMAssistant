import { BadRequestException, Injectable, Logger } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import { DealsService } from '../deals/deals.service'
import type { Prisma } from '@prisma/client'

// ─── Types ───────────────────────────────────────────────────────────────────

export type ForecastGroupBy = 'MONTH' | 'QUARTER' | 'OWNER' | 'TEAM'

export type SalesForecastInput = {
  startDate: string
  endDate: string
  groupBy: ForecastGroupBy
  ownerId?: string
  teamId?: string
}

export type ForecastBucket = {
  key: string
  label: string
  periodStart: string | null
  periodEnd: string | null
  weightedValue: number
  totalValue: number
  count: number
}

export type ForecastBand = {
  weightedValue: number
  totalValue: number
  count: number
}

export type SalesForecastResult = {
  buckets: ForecastBucket[]
  commit: ForecastBand
  bestCase: ForecastBand
  pipeline: ForecastBand
  currency: string
}

export type ForecastAccuracyPeriod = {
  periodStart: string
  periodEnd: string
  forecastValue: number | null
  actualValue: number
  variance: number | null
  accuracyPct: number | null
}

export type ForecastAccuracyInput = {
  startDate: string
  endDate: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTodayUtcMidnight(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}
// NOTE: toUtcMidnight in apps/api/src/deal-health/deal-health-score.ts
// duplicates this three-line UTC-midnight construction (this helper is not
// exported). Keep the two implementations in sync — hand-duplication with a
// cross-reference comment is the established convention (docs/project-context.md).

export function parseDateOrThrow(value: string, label: string): Date {
  const d = new Date(value)
  if (isNaN(d.getTime())) {
    throw new BadRequestException(`Invalid date: ${label}`)
  }
  return d
}

/**
 * Detect the most frequent currency across a set of deal-like rows.
 * Shared with WinLossService — do not re-derive per report.
 */
export function detectMostFrequentCurrency(deals: { currency: string }[]): string {
  const currencyCount = new Map<string, number>()
  for (const d of deals) {
    const cur = d.currency || 'USD'
    currencyCount.set(cur, (currencyCount.get(cur) || 0) + 1)
  }
  let currency = 'USD'
  let maxCount = 0
  for (const [cur, count] of currencyCount) {
    if (count > maxCount) {
      maxCount = count
      currency = cur
    }
  }
  return currency
}

function getMonthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function getMonthLabel(date: Date): string {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  return `${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

function getQuarterKey(date: Date): string {
  const q = Math.floor(date.getUTCMonth() / 3) + 1
  return `${date.getUTCFullYear()}-Q${q}`
}

function getQuarterLabel(date: Date): string {
  const q = Math.floor(date.getUTCMonth() / 3) + 1
  return `Q${q} ${date.getUTCFullYear()}`
}

function getQuarterStart(date: Date): Date {
  const q = Math.floor(date.getUTCMonth() / 3)
  return new Date(Date.UTC(date.getUTCFullYear(), q * 3, 1))
}

function getQuarterEnd(date: Date): Date {
  const q = Math.floor(date.getUTCMonth() / 3)
  // Last day of the quarter
  return new Date(Date.UTC(date.getUTCFullYear(), q * 3 + 3, 0, 23, 59, 59, 999))
}

function getMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function getMonthEnd(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999))
}

function addMonth(date: Date, count: number): Date {
  const result = new Date(date)
  result.setUTCMonth(result.getUTCMonth() + count)
  return result
}

function addQuarter(date: Date, count: number): Date {
  const result = new Date(date)
  result.setUTCMonth(result.getUTCMonth() + count * 3)
  return result
}

// ─── Deal shape for forecast computation ─────────────────────────────────────

type DealForecastItem = {
  id: string
  value: number
  probability: number
  expectedCloseDate: Date | null
  ownerId: string
  currency: string
  owner: {
    id: string
    firstName: string
    lastName: string
    teamId: string | null
    team: { id: string; name: string } | null
  } | null
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class ForecastService {
  private readonly logger = new Logger(ForecastService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly dealsService: DealsService,
  ) {}

  async salesForecast(
    tenantId: string,
    userId: string,
    input: SalesForecastInput,
  ): Promise<SalesForecastResult> {
    const startDate = parseDateOrThrow(input.startDate, 'startDate')
    const endDate = parseDateOrThrow(input.endDate, 'endDate')

    // Validate range
    if (endDate < startDate) {
      throw new BadRequestException('endDate must be >= startDate')
    }

    // Max 36 months
    const monthsDiff =
      (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
      endDate.getUTCMonth() -
      startDate.getUTCMonth()
    if (monthsDiff > 36) {
      throw new BadRequestException('Forecast range must not exceed 36 months')
    }

    // Build base where using DealsService.buildDealWhere (reuse visibility + filters)
    const baseWhere = await this.dealsService.buildDealWhere(tenantId, userId, {
      expectedCloseDateFrom: input.startDate,
      expectedCloseDateTo: input.endDate,
      ownerId: input.ownerId,
    })

    // Add expectedCloseDate: not null and merge with any teamId filter
    const where: Prisma.DealWhereInput = {
      ...baseWhere,
      expectedCloseDate: { not: null },
    }

    // Apply teamId filter if provided — narrow on top of visibility
    if (input.teamId) {
      where.AND = [
        ...(Array.isArray(baseWhere.AND) ? baseWhere.AND : baseWhere.AND ? [baseWhere.AND] : []),
        { owner: { teamId: input.teamId, deletedAt: null } },
      ]
    }

    // Fetch all deals in range (NOT through findMany — it clamps pageSize!)
    const deals = await this.prisma.deal.findMany({
      where,
      select: {
        id: true,
        value: true,
        probability: true,
        expectedCloseDate: true,
        ownerId: true,
        currency: true,
        owner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            teamId: true,
            team: { select: { id: true, name: true } },
          },
        },
      },
    })

    const typedDeals = deals as unknown as DealForecastItem[]

    // Compute currency (most frequent)
    const currency = detectMostFrequentCurrency(typedDeals)

    // Compute buckets
    const buckets = this.computeBuckets(typedDeals, input.groupBy, startDate, endDate)

    // Compute bands
    const commit = this.computeBand(typedDeals, 75)
    const bestCase = this.computeBand(typedDeals, 50)
    const pipeline = this.computeBand(typedDeals, 0)

    // Snapshot write-through (fire-and-forget, never fails the read)
    this.captureSnapshots(tenantId, startDate, endDate).catch((err) => {
      this.logger.error('Snapshot capture failed', err)
    })

    return { buckets, commit, bestCase, pipeline, currency }
  }

  async forecastAccuracy(
    tenantId: string,
    _userId: string,
    input: ForecastAccuracyInput,
  ): Promise<ForecastAccuracyPeriod[]> {
    const startDate = parseDateOrThrow(input.startDate, 'startDate')
    const endDate = parseDateOrThrow(input.endDate, 'endDate')

    const todayUtcMidnight = getTodayUtcMidnight()

    const periods: ForecastAccuracyPeriod[] = []

    // Iterate through months
    let current = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1))
    while (current <= endDate) {
      const periodStart = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1))
      const periodEnd = new Date(
        Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0, 23, 59, 59, 999),
      )

      // Only completed months
      if (periodEnd < todayUtcMidnight) {
        // Get earliest snapshot for this period
        const snapshot = await this.prisma.forecastSnapshot.findFirst({
          where: {
            tenantId,
            periodStart,
            deletedAt: null,
          },
          orderBy: { snapshotDate: 'asc' as const },
        })

        // Compute actual value from won deals with actualCloseDate in this period
        const actualAgg = await this.prisma.deal.aggregate({
          where: {
            tenantId,
            deletedAt: null,
            stage: { isWon: true },
            actualCloseDate: { gte: periodStart, lte: periodEnd },
          },
          _sum: { value: true },
        })
        const actualValue = actualAgg._sum.value ?? 0

        const forecastValue = snapshot?.forecastValue ?? null
        let variance: number | null = null
        let accuracyPct: number | null = null

        if (forecastValue !== null) {
          variance = actualValue - forecastValue
          if (forecastValue > 0) {
            accuracyPct = (actualValue / forecastValue) * 100
          }
          // forecastValue === 0 → accuracyPct stays null (guarded divide-by-zero)
        }

        periods.push({
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
          forecastValue,
          actualValue,
          variance,
          accuracyPct,
        })
      }

      // Move to next month
      current = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1))
    }

    return periods
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private computeBuckets(
    deals: DealForecastItem[],
    groupBy: ForecastGroupBy,
    startDate: Date,
    endDate: Date,
  ): ForecastBucket[] {
    if (groupBy === 'OWNER' || groupBy === 'TEAM') {
      return this.computeSparseBuckets(deals, groupBy)
    }
    return this.computeDenseBuckets(deals, groupBy, startDate, endDate)
  }

  private computeDenseBuckets(
    deals: DealForecastItem[],
    groupBy: ForecastGroupBy,
    startDate: Date,
    endDate: Date,
  ): ForecastBucket[] {
    const map = new Map<
      string,
      {
        weightedValue: number
        totalValue: number
        count: number
        periodStart: Date
        periodEnd: Date
      }
    >()

    for (const deal of deals) {
      if (!deal.expectedCloseDate) continue
      let key: string
      let ps: Date
      let pe: Date

      if (groupBy === 'QUARTER') {
        key = getQuarterKey(deal.expectedCloseDate)
        ps = getQuarterStart(deal.expectedCloseDate)
        pe = getQuarterEnd(deal.expectedCloseDate)
      } else {
        // MONTH
        key = getMonthKey(deal.expectedCloseDate)
        ps = getMonthStart(deal.expectedCloseDate)
        pe = getMonthEnd(deal.expectedCloseDate)
      }

      const existing = map.get(key) ?? {
        weightedValue: 0,
        totalValue: 0,
        count: 0,
        periodStart: ps,
        periodEnd: pe,
      }
      existing.weightedValue += (deal.value * deal.probability) / 100
      existing.totalValue += deal.value
      existing.count += 1
      map.set(key, existing)
    }

    // Generate dense sequence
    const buckets: ForecastBucket[] = []
    let current: Date
    let next: (d: Date) => Date
    let getKey: (d: Date) => string
    let getLabel: (d: Date) => string

    if (groupBy === 'QUARTER') {
      current = getQuarterStart(startDate)
      next = (d: Date): Date => addQuarter(d, 1)
      getKey = getQuarterKey
      getLabel = getQuarterLabel
    } else {
      current = getMonthStart(startDate)
      next = (d: Date): Date => addMonth(d, 1)
      getKey = getMonthKey
      getLabel = getMonthLabel
    }

    while (current <= endDate) {
      const key = getKey(current)
      const entry = map.get(key)
      buckets.push({
        key,
        label: getLabel(current),
        periodStart: current.toISOString(),
        periodEnd:
          groupBy === 'QUARTER'
            ? getQuarterEnd(current).toISOString()
            : getMonthEnd(current).toISOString(),
        weightedValue: entry?.weightedValue ?? 0,
        totalValue: entry?.totalValue ?? 0,
        count: entry?.count ?? 0,
      })
      current = next(current)
    }

    return buckets
  }

  private computeSparseBuckets(
    deals: DealForecastItem[],
    groupBy: ForecastGroupBy,
  ): ForecastBucket[] {
    const map = new Map<
      string,
      { weightedValue: number; totalValue: number; count: number; label: string }
    >()

    for (const deal of deals) {
      if (!deal.expectedCloseDate) continue
      let key: string
      let label: string

      if (groupBy === 'TEAM') {
        key = deal.owner?.teamId ?? 'unassigned'
        label = deal.owner?.team?.name ?? 'No team'
      } else {
        // OWNER
        key = deal.owner?.id ?? deal.ownerId
        label = deal.owner ? `${deal.owner.firstName} ${deal.owner.lastName}` : deal.ownerId
      }

      const existing = map.get(key) ?? { weightedValue: 0, totalValue: 0, count: 0, label }
      existing.weightedValue += (deal.value * deal.probability) / 100
      existing.totalValue += deal.value
      existing.count += 1
      map.set(key, existing)
    }

    const buckets: ForecastBucket[] = Array.from(map.entries()).map(([key, entry]) => ({
      key,
      label: entry.label,
      periodStart: null,
      periodEnd: null,
      weightedValue: entry.weightedValue,
      totalValue: entry.totalValue,
      count: entry.count,
    }))

    // Sort by weightedValue descending
    buckets.sort((a, b) => b.weightedValue - a.weightedValue)

    return buckets
  }

  private computeBand(deals: DealForecastItem[], minProbability: number): ForecastBand {
    let weightedValue = 0
    let totalValue = 0
    let count = 0

    for (const deal of deals) {
      if (deal.probability >= minProbability) {
        weightedValue += (deal.value * deal.probability) / 100
        totalValue += deal.value
        count += 1
      }
    }

    return { weightedValue, totalValue, count }
  }

  private async captureSnapshots(tenantId: string, startDate: Date, endDate: Date): Promise<void> {
    const todayUtcMidnight = getTodayUtcMidnight()

    // Self-fetch tenant-wide deals (no visibility filter — snapshot must be tenant-wide)
    const deals = await this.prisma.deal.findMany({
      where: {
        tenantId,
        deletedAt: null,
        expectedCloseDate: { not: null },
      },
      select: {
        value: true,
        probability: true,
        expectedCloseDate: true,
      },
    })

    // Compute tenant-wide values (no visibility filter)
    let current = getMonthStart(startDate)

    while (current <= endDate) {
      const periodStart = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1))
      const periodEnd = new Date(
        Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0, 23, 59, 59, 999),
      )

      // Only snapshot open/future periods
      if (periodEnd >= todayUtcMidnight) {
        // Compute tenant-wide values for this period
        const periodDeals = deals.filter((d) => {
          if (!d.expectedCloseDate) return false
          return d.expectedCloseDate >= periodStart && d.expectedCloseDate <= periodEnd
        })

        const forecastValue = periodDeals.reduce(
          (sum, d) => sum + (d.value * d.probability) / 100,
          0,
        )
        const commitValue = periodDeals
          .filter((d) => d.probability >= 75)
          .reduce((sum, d) => sum + (d.value * d.probability) / 100, 0)
        const bestCaseValue = periodDeals
          .filter((d) => d.probability >= 50)
          .reduce((sum, d) => sum + (d.value * d.probability) / 100, 0)
        const pipelineValue = periodDeals.reduce(
          (sum, d) => sum + (d.value * d.probability) / 100,
          0,
        )
        const dealCount = periodDeals.length

        try {
          await this.prisma.forecastSnapshot.upsert({
            where: {
              tenantId_periodStart_snapshotDate: {
                tenantId,
                periodStart,
                snapshotDate: todayUtcMidnight,
              },
            },
            create: {
              tenantId,
              periodStart,
              periodEnd,
              snapshotDate: todayUtcMidnight,
              forecastValue,
              commitValue,
              bestCaseValue,
              pipelineValue,
              dealCount,
            },
            update: {
              forecastValue,
              commitValue,
              bestCaseValue,
              pipelineValue,
              dealCount,
              updatedBy: 'system',
            },
          })
        } catch (err) {
          this.logger.error(`Snapshot upsert failed for period ${periodStart.toISOString()}`, err)
          // Non-blocking — never fail the read
        }
      }

      current = addMonth(current, 1)
    }
  }
}
