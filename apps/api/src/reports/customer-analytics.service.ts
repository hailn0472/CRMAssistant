/**
 * Story 6.7 typed customerAnalytics query service (Contract D26–D34).
 *
 * Every result section derives from ONE canonical base predicate produced by
 * ContactsService.buildContactWhere (own/team/all + sharing) — never a second
 * copy of the visibility rules. Summary/distributions/trend/cohort/currency
 * aggregates are database-side (Prisma aggregate/groupBy/count) and bounded;
 * the customer list is paginated (pageSize max 100) with a stable sort.
 *
 * Money safety (B15): when the visible won deals span more than one currency,
 * total/average are null and the UI must use the per-currency breakdown — no
 * FX conversion, no single-currency label.
 */
import { BadRequestException, Injectable, Optional } from '@nestjs/common'
import type { Prisma } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { ContactsService } from '../contacts/contacts.service'
import {
  CUSTOMER_CHURN_RISKS,
  isCustomerChurnRisk,
  isHighLifetimeValue,
  percentile75FromOrderStatistics,
  p75OrderStatisticIndices,
  recommendedActionFor,
  toUtcMidnight,
  type CustomerChurnRisk,
  type RecommendedAction,
} from './customer-analytics-score'

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100
const LTV_BIN_COUNT = 5
const TREND_DAYS = 90
const MS_PER_DAY = 86_400_000

function round2(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100
  return Number.isFinite(rounded) ? rounded : 0
}

function round1(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 10) / 10
  return Number.isFinite(rounded) ? rounded : 0
}

// ─── Typed result shapes (D31, D34) — Pothos refs are typed from these ──────

export type CustomerAnalyticsFilterInput = {
  minLifetimeValue?: number | null
  maxLifetimeValue?: number | null
  churnRisks?: CustomerChurnRisk[] | null
  lastActivityFrom?: string | null
  lastActivityTo?: string | null
  search?: string | null
  ownerId?: string | null
}

export type CustomerAnalyticsPaginationInput = {
  page?: number | null
  pageSize?: number | null
}

export type CurrencyBreakdownEntry = { currency: string; value: number }

export type CustomerAnalyticsSummary = {
  totalLifetimeValue: number | null
  averageLifetimeValue: number | null
  customerCount: number
  calculatedCustomerCount: number
  highLtvThreshold: number | null
  latestCalculatedAt: string | null
  mixedCurrencies: boolean
  currencyBreakdown: CurrencyBreakdownEntry[]
}

export type LtvDistributionBin = { label: string; min: number; max: number; count: number }

export type ChurnRiskDistributionBin = {
  risk: CustomerChurnRisk | 'NOT_CALCULATED'
  count: number
  percentage: number
}

export type CustomerAnalyticsCustomerItem = {
  id: string
  name: string
  ownerId: string
  ownerName: string | null
  lifetimeValue: number | null
  churnRiskScore: number | null
  churnRisk: CustomerChurnRisk | null
  lastActivityDate: string | null
  analyticsCalculatedAt: string | null
  recommendedAction: RecommendedAction
  isHighLifetimeValue: boolean
}

export type CustomerAnalyticsCustomerConnection = {
  items: CustomerAnalyticsCustomerItem[]
  total: number
  page: number
  pageSize: number
}

export type CustomerAnalyticsTrendPoint = {
  snapshotDate: string
  totalLtv: number
  averageLtv: number
  customerCount: number
}

export type CustomerAnalyticsCohort = {
  cohort: string
  customerCount: number
  totalLtv: number
  averageLtv: number
}

export type CustomerAnalyticsResult = {
  summary: CustomerAnalyticsSummary
  ltvDistribution: LtvDistributionBin[]
  churnRiskDistribution: ChurnRiskDistributionBin[]
  customers: CustomerAnalyticsCustomerConnection
  ltvTrend: CustomerAnalyticsTrendPoint[]
  cohorts: CustomerAnalyticsCohort[]
}

// Every field the Pothos CustomerAnalyticsCustomer ref exposes (D34 lockstep).
const CUSTOMER_ITEM_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  ownerId: true,
  owner: { select: { id: true, firstName: true, lastName: true } },
  lifetimeValue: true,
  churnRiskScore: true,
  churnRisk: true,
  lastActivityDate: true,
  analyticsCalculatedAt: true,
  createdAt: true,
} as const

type CustomerItemRow = {
  id: string
  firstName: string
  lastName: string
  email: string
  ownerId: string
  owner: { id: string; firstName: string; lastName: string } | null
  lifetimeValue: number | null
  churnRiskScore: number | null
  churnRisk: string | null
  lastActivityDate: Date | null
  analyticsCalculatedAt: Date | null
  createdAt: Date
}

// ─── Validation (D27, G5) ───────────────────────────────────────────────────

type ValidatedFilter = {
  minLifetimeValue?: number | null
  maxLifetimeValue?: number | null
  churnRisks?: CustomerChurnRisk[] | null
  lastActivityFrom?: Date | null
  lastActivityTo?: Date | null
  search?: string | null
  ownerId?: string | null
}

function validateBound(value: number | null | undefined, name: string): number | null | undefined {
  if (value === null || value === undefined) return value
  if (!Number.isFinite(value)) {
    throw new BadRequestException(`${name} must be a finite number`)
  }
  return value
}

function parseIsoDate(value: string | null | undefined, name: string): Date | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${name} must be a valid ISO date`)
  }
  return parsed
}

function validateFilter(filter: CustomerAnalyticsFilterInput): ValidatedFilter {
  const minLifetimeValue = validateBound(filter.minLifetimeValue, 'minLifetimeValue')
  const maxLifetimeValue = validateBound(filter.maxLifetimeValue, 'maxLifetimeValue')
  if (
    minLifetimeValue !== null &&
    minLifetimeValue !== undefined &&
    maxLifetimeValue !== null &&
    maxLifetimeValue !== undefined &&
    minLifetimeValue > maxLifetimeValue
  ) {
    throw new BadRequestException('minLifetimeValue must be <= maxLifetimeValue')
  }

  const churnRisks = filter.churnRisks ?? null
  if (churnRisks && churnRisks.some((risk) => !isCustomerChurnRisk(risk))) {
    throw new BadRequestException(`churnRisks must be one of ${CUSTOMER_CHURN_RISKS.join(', ')}`)
  }

  const lastActivityFrom = parseIsoDate(filter.lastActivityFrom, 'lastActivityFrom')
  const lastActivityTo = parseIsoDate(filter.lastActivityTo, 'lastActivityTo')
  if (lastActivityFrom && lastActivityTo && lastActivityFrom > lastActivityTo) {
    throw new BadRequestException('lastActivityFrom must be <= lastActivityTo')
  }

  return {
    minLifetimeValue,
    maxLifetimeValue,
    churnRisks,
    lastActivityFrom,
    lastActivityTo,
    search: filter.search ?? null,
    ownerId: filter.ownerId ?? null,
  }
}

@Injectable()
export class CustomerAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    @Optional() private readonly clock: () => Date = () => new Date(),
  ) {}

  async customerAnalytics(
    tenantId: string,
    userId: string,
    filter: CustomerAnalyticsFilterInput = {},
    pagination: CustomerAnalyticsPaginationInput = {},
  ): Promise<CustomerAnalyticsResult> {
    const validated = validateFilter(filter)
    const page = Math.max(pagination.page ?? DEFAULT_PAGE, 1)
    const pageSize = Math.min(Math.max(pagination.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)

    // Single canonical visibility predicate (D29) — AND the analytics filters.
    const baseWhere = await this.contacts.buildContactWhere(tenantId, userId, {
      search: validated.search ?? undefined,
      ownerId: validated.ownerId ?? undefined,
    })
    const where = this.applyAnalyticsFilters(baseWhere, validated)

    // List + counts + aggregate bounds run in one bounded parallel block.
    const [customerCount, calculatedCustomerCount, aggregate, currencyGroups] = await Promise.all([
      this.prisma.contact.count({ where }),
      this.prisma.contact.count({ where: { ...where, analyticsCalculatedAt: { not: null } } }),
      this.prisma.contact.aggregate({
        where,
        _sum: { lifetimeValue: true },
        _avg: { lifetimeValue: true },
        _min: { lifetimeValue: true },
        _max: { lifetimeValue: true, analyticsCalculatedAt: true },
      }),
      this.prisma.deal.groupBy({
        by: ['currency'],
        where: {
          tenantId,
          deletedAt: null,
          stage: { isWon: true, deletedAt: null },
          contact: where,
        },
        _sum: { value: true },
      }),
    ])

    const currencyBreakdown: CurrencyBreakdownEntry[] = currencyGroups
      .map((group) => ({ currency: group.currency, value: round2(group._sum?.value ?? 0) }))
      .sort((a, b) => a.currency.localeCompare(b.currency))
    const mixedCurrencies = currencyBreakdown.length > 1

    const rawTotal = aggregate._sum?.lifetimeValue ?? 0
    // R2-F1/D31/AC 10: the total must never fabricate 0 before the processor
    // materializes analytics — null when mixed currencies OR when no visible
    // customer has a calculated LTV (same null semantics as the average and
    // the empty distribution). With ≥1 calculated customer the raw SQL SUM is
    // a real value, so a genuine sum of 0 (calculated-0 contacts) stays 0.
    const totalLifetimeValue =
      mixedCurrencies || calculatedCustomerCount === 0 ? null : round2(rawTotal)
    // D31/AC 10: average over customers that actually HAVE a calculated LTV.
    // Prisma's `_avg` (SQL AVG) excludes NULL lifetime values — NOT_CALCULATED
    // contacts never dilute the average and are never treated as zero. Null
    // when mixed currencies or when no customer has a calculated LTV.
    const dbAverage = aggregate._avg?.lifetimeValue
    const averageLifetimeValue =
      mixedCurrencies || dbAverage === null || dbAverage === undefined ? null : round2(dbAverage)

    const [items, ltvDistribution, churnRiskDistribution] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        // Stable sort (D32): risk score desc (null last), LTV desc, id asc.
        orderBy: [
          { churnRiskScore: { sort: 'desc', nulls: 'last' } },
          { lifetimeValue: { sort: 'desc', nulls: 'last' } },
          { id: 'asc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: CUSTOMER_ITEM_SELECT,
      }),
      this.buildLtvDistribution(
        where,
        aggregate._min?.lifetimeValue ?? null,
        aggregate._max?.lifetimeValue ?? null,
      ),
      this.buildChurnRiskDistribution(where, customerCount),
    ])

    const highLtvThreshold = await this.resolveHighLtvThreshold(tenantId, userId)

    const customers: CustomerAnalyticsCustomerConnection = {
      items: items.map((row) =>
        this.toCustomerItem(row as unknown as CustomerItemRow, highLtvThreshold),
      ),
      total: customerCount,
      page,
      pageSize,
    }

    const [ltvTrend, cohorts] = await Promise.all([
      this.buildLtvTrend(tenantId, userId),
      this.buildCohorts(tenantId, userId),
    ])

    return {
      summary: {
        totalLifetimeValue,
        averageLifetimeValue,
        customerCount,
        calculatedCustomerCount,
        highLtvThreshold,
        latestCalculatedAt: aggregate._max?.analyticsCalculatedAt?.toISOString() ?? null,
        mixedCurrencies,
        currencyBreakdown,
      },
      ltvDistribution,
      churnRiskDistribution,
      customers,
      ltvTrend,
      cohorts,
    }
  }

  /** AND the closed analytics filters onto the base predicate (D27, D29). */
  private applyAnalyticsFilters(
    baseWhere: Prisma.ContactWhereInput,
    filter: ValidatedFilter,
  ): Prisma.ContactWhereInput {
    const ands: Prisma.ContactWhereInput[] = []

    if (
      (filter.minLifetimeValue !== null && filter.minLifetimeValue !== undefined) ||
      (filter.maxLifetimeValue !== null && filter.maxLifetimeValue !== undefined)
    ) {
      const ltvFilter: Prisma.FloatFilter = {}
      if (filter.minLifetimeValue !== null && filter.minLifetimeValue !== undefined) {
        ltvFilter.gte = filter.minLifetimeValue
      }
      if (filter.maxLifetimeValue !== null && filter.maxLifetimeValue !== undefined) {
        ltvFilter.lte = filter.maxLifetimeValue
      }
      ands.push({ lifetimeValue: ltvFilter })
    }
    if (filter.churnRisks && filter.churnRisks.length > 0) {
      ands.push({ churnRisk: { in: filter.churnRisks } })
    }
    if (filter.lastActivityFrom || filter.lastActivityTo) {
      const dateFilter: Prisma.DateTimeFilter = {}
      if (filter.lastActivityFrom) dateFilter.gte = filter.lastActivityFrom
      if (filter.lastActivityTo) {
        const end = new Date(filter.lastActivityTo)
        end.setUTCHours(23, 59, 59, 999)
        dateFilter.lte = end
      }
      ands.push({ lastActivityDate: dateFilter })
    }

    if (ands.length === 0) return baseWhere

    const existing = baseWhere.AND
    if (existing) {
      const existingAnds = Array.isArray(existing) ? existing : [existing]
      return { ...baseWhere, AND: [...existingAnds, ...ands] }
    }
    return { ...baseWhere, AND: ands }
  }

  /**
   * B14: the high-LTV threshold derives from the CURRENT visible tenant
   * snapshot (active contacts with positive LTV) — UI analytics filters never
   * change it. Null when the tenant has no positive-LTV contact.
   *
   * D32 bounded strategy: one count over the visible positive set, then at
   * most 2 rows for the exact Tukey-hinges p75 order statistics — never a
   * fetch of the full visible set (Contract D32 forbids summary thresholds
   * from materializing all rows in Node).
   */
  private async resolveHighLtvThreshold(tenantId: string, userId: string): Promise<number | null> {
    const visibleWhere = await this.contacts.buildContactWhere(tenantId, userId, {})
    const positiveWhere: Prisma.ContactWhereInput = {
      ...visibleWhere,
      lifetimeValue: { gt: 0 },
    }
    const count = await this.prisma.contact.count({ where: positiveWhere })
    const indices = p75OrderStatisticIndices(count)
    if (indices.length === 0) return null

    const rows = await this.prisma.contact.findMany({
      where: positiveWhere,
      select: { lifetimeValue: true },
      orderBy: [{ lifetimeValue: 'asc' }, { id: 'asc' }],
      skip: indices[0],
      take: indices.length,
    })
    return percentile75FromOrderStatistics(rows.map((row) => row.lifetimeValue as number))
  }

  /**
   * D32: at most 5 equal-width bins from the visible filtered min/max,
   * counted with bounded DB count queries (never a full-row fetch). Null
   * lifetime values are excluded; a single distinct value yields one bin.
   */
  private async buildLtvDistribution(
    where: Prisma.ContactWhereInput,
    min: number | null,
    max: number | null,
  ): Promise<LtvDistributionBin[]> {
    if (min === null || max === null) return []
    if (min === max) {
      const count = await this.prisma.contact.count({
        where: { ...where, lifetimeValue: min },
      })
      return [{ label: `${round2(min)}-${round2(max)}`, min: round2(min), max: round2(max), count }]
    }

    const width = (max - min) / LTV_BIN_COUNT
    const bins = await Promise.all(
      Array.from({ length: LTV_BIN_COUNT }, async (_, i) => {
        const lower = min + i * width
        const upper = i === LTV_BIN_COUNT - 1 ? max : min + (i + 1) * width
        const count = await this.prisma.contact.count({
          where: {
            ...where,
            lifetimeValue:
              i === LTV_BIN_COUNT - 1 ? { gte: lower, lte: upper } : { gte: lower, lt: upper },
          },
        })
        return {
          label: `${round2(lower)}-${round2(upper)}`,
          min: round2(lower),
          max: round2(upper),
          count,
        }
      }),
    )
    return bins
  }

  /** D31: LOW | MEDIUM | HIGH | NOT_CALCULATED with count + percentage. */
  private async buildChurnRiskDistribution(
    where: Prisma.ContactWhereInput,
    customerCount: number,
  ): Promise<ChurnRiskDistributionBin[]> {
    const groups = await this.prisma.contact.groupBy({
      by: ['churnRisk'],
      where,
      _count: { _all: true },
    })
    const countByRisk = new Map<string | null, number>()
    for (const group of groups) {
      countByRisk.set(group.churnRisk, group._count?._all ?? 0)
    }
    const calculated = CUSTOMER_CHURN_RISKS.map((risk) => ({
      risk,
      count: countByRisk.get(risk) ?? 0,
    }))
    const calculatedSum = calculated.reduce((sum, bin) => sum + bin.count, 0)
    const notCalculated = Math.max(customerCount - calculatedSum, 0)

    const percentage = (count: number): number =>
      customerCount > 0 ? round1((count / customerCount) * 100) : 0

    return [
      ...calculated.map((bin) => ({
        risk: bin.risk,
        count: bin.count,
        percentage: percentage(bin.count),
      })),
      {
        risk: 'NOT_CALCULATED' as const,
        count: notCalculated,
        percentage: percentage(notCalculated),
      },
    ]
  }

  /** C24: 90-day LTV trend from daily snapshots of visible contacts. */
  private async buildLtvTrend(
    tenantId: string,
    userId: string,
  ): Promise<CustomerAnalyticsTrendPoint[]> {
    const today = toUtcMidnight(this.clock())
    // C24: exactly 90 snapshot days (today-89 … today inclusive). With
    // endExclusive = today + 1 the start must be today - 89 — otherwise the
    // window would cover 91 UTC calendar days.
    const start = new Date(today.getTime() - (TREND_DAYS - 1) * MS_PER_DAY)
    const endExclusive = new Date(today.getTime() + MS_PER_DAY)
    const visibleWhere = await this.contacts.buildContactWhere(tenantId, userId, {})

    const groups = await this.prisma.customerAnalyticsSnapshot.groupBy({
      by: ['snapshotDate'],
      where: {
        tenantId,
        deletedAt: null,
        snapshotDate: { gte: start, lt: endExclusive },
        contact: visibleWhere,
      },
      _sum: { lifetimeValue: true },
      _avg: { lifetimeValue: true },
      _count: { _all: true },
    })

    return groups
      .map((group) => ({
        snapshotDate: group.snapshotDate?.toISOString() ?? '',
        totalLtv: round2(group._sum?.lifetimeValue ?? 0),
        averageLtv: round2(group._avg?.lifetimeValue ?? 0),
        customerCount: group._count?._all ?? 0,
      }))
      .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate))
  }

  /**
   * C25: acquisition cohorts (YYYY-MM from Contact.createdAt) grouped on the
   * current/latest visible snapshot day — one row per contact/day so no
   * historical day double-counts a contact.
   */
  private async buildCohorts(tenantId: string, userId: string): Promise<CustomerAnalyticsCohort[]> {
    // Scope the latest snapshot day to the caller's VISIBLE contacts BEFORE
    // aggregating: an invisible contact's newer snapshot must never push the
    // cohort day past the visible data (F2 regression).
    const visibleWhere = await this.contacts.buildContactWhere(tenantId, userId, {})
    const latest = await this.prisma.customerAnalyticsSnapshot.aggregate({
      where: { tenantId, deletedAt: null, contact: visibleWhere },
      _max: { snapshotDate: true },
    })
    const latestDate = latest._max?.snapshotDate
    if (!latestDate) return []

    const groups = await this.prisma.customerAnalyticsSnapshot.groupBy({
      by: ['acquisitionCohort'],
      where: { tenantId, deletedAt: null, snapshotDate: latestDate, contact: visibleWhere },
      _sum: { lifetimeValue: true },
      _avg: { lifetimeValue: true },
      _count: { _all: true },
    })

    return groups
      .map((group) => ({
        cohort: group.acquisitionCohort ?? '',
        customerCount: group._count?._all ?? 0,
        totalLtv: round2(group._sum?.lifetimeValue ?? 0),
        averageLtv: round2(group._avg?.lifetimeValue ?? 0),
      }))
      .sort((a, b) => a.cohort.localeCompare(b.cohort))
  }

  private toCustomerItem(
    row: CustomerItemRow,
    highLtvThreshold: number | null,
  ): CustomerAnalyticsCustomerItem {
    const name = `${row.firstName} ${row.lastName}`.trim()
    const ownerName = row.owner ? `${row.owner.firstName} ${row.owner.lastName}`.trim() : null
    const risk = row.churnRisk !== null && isCustomerChurnRisk(row.churnRisk) ? row.churnRisk : null
    const lifetimeValue = row.lifetimeValue ?? 0
    return {
      id: row.id,
      name,
      ownerId: row.ownerId,
      ownerName: ownerName || null,
      lifetimeValue: row.lifetimeValue,
      churnRiskScore: row.churnRiskScore,
      churnRisk: risk,
      lastActivityDate: row.lastActivityDate?.toISOString() ?? null,
      analyticsCalculatedAt: row.analyticsCalculatedAt?.toISOString() ?? null,
      recommendedAction: recommendedActionFor(risk, lifetimeValue, highLtvThreshold),
      isHighLifetimeValue: isHighLifetimeValue(lifetimeValue, highLtvThreshold),
    }
  }
}
