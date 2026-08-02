import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import { DealsService } from '../deals/deals.service'
import { AuditService } from '../audit/audit.service'
import {
  CLOSING_SOON_DAYS,
  STALE_ACTIVITY_DAYS,
  daysBetweenUtc,
  scoreDealHealth,
  toUtcMidnight,
} from './deal-health-score'
import { isEmailFrequency } from './reminder-preference-values'
import type { DealHealthResult } from './deal-health-score'

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

const SNOOZE_DAYS = [7, 14, 30] as const

const dealHealthSelect = {
  id: true,
  tenantId: true,
  title: true,
  value: true,
  currency: true,
  probability: true,
  stageId: true,
  contactId: true,
  ownerId: true,
  expectedCloseDate: true,
  actualCloseDate: true,
  createdAt: true,
  updatedAt: true,
  stage: {
    select: { id: true, name: true, color: true, probability: true, isWon: true, isLost: true },
  },
  owner: {
    select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
  },
} as const

/**
 * Minimal deal shape the health computations need. The at-risk read path
 * fetches the richer select above; findOneHealth works off DealsService.findOne
 * which already includes stage/owner.
 */
export type HealthDealRow = {
  id: string
  probability: number
  expectedCloseDate: Date | null
  updatedAt: Date
  stage: { isWon: boolean; isLost: boolean; probability: number }
}

export type DealHealthEntry = {
  deal: HealthDealRow & Record<string, unknown>
  health: DealHealthResult
  lastActivityAt: Date
}

export type AtRiskDealConnection = {
  items: DealHealthEntry[]
  total: number
  page: number
  pageSize: number
}

export type SingleDealHealth = {
  health: DealHealthResult | null
  lastActivityAt: Date
  snoozedUntil: Date | null
}

export type SweepResult = {
  sweepDate: Date
  dealsEvaluated: number
  remindersCreated: number
}

export type UpdateReminderPreferenceInput = {
  emailFrequency: string
  notifyNoActivity: boolean
  notifyClosingSoon: boolean
  notifyAtRisk: boolean
}

const DEFAULT_PREFERENCES = {
  emailFrequency: 'DAILY',
  notifyNoActivity: true,
  notifyClosingSoon: true,
  notifyAtRisk: true,
} as const

type PreferenceRow = {
  userId: string
  emailFrequency: string
  notifyNoActivity: boolean
  notifyClosingSoon: boolean
  notifyAtRisk: boolean
}

type SnoozeRow = {
  dealId: string
  userId: string
}

@Injectable()
export class DealHealthService {
  private readonly logger = new Logger('DealHealthService')

  constructor(
    private readonly prisma: PrismaService,
    private readonly deals: DealsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Per deal, the latest of Deal.updatedAt, the latest active DealComment and
   * the latest active DealDocument. Exactly two groupBy queries for any
   * deal-set size — never a per-deal query. The Deal.updatedAt fallback is
   * merged in by the callers (computeForDeals / findOneHealth) which hold the
   * deal rows.
   */
  async resolveLastActivityAt(tenantId: string, dealIds: string[]): Promise<Map<string, Date>> {
    const [commentGroups, documentGroups] = await Promise.all([
      this.prisma.dealComment.groupBy({
        by: ['dealId'],
        where: { tenantId, dealId: { in: dealIds }, deletedAt: null },
        _max: { createdAt: true },
      }),
      this.prisma.dealDocument.groupBy({
        by: ['dealId'],
        where: { tenantId, dealId: { in: dealIds }, deletedAt: null },
        _max: { createdAt: true },
      }),
    ])

    const latest = new Map<string, Date>()
    for (const group of commentGroups) {
      const createdAt = group._max?.createdAt
      if (createdAt) {
        latest.set(group.dealId, createdAt)
      }
    }
    for (const group of documentGroups) {
      const createdAt = group._max?.createdAt
      if (createdAt) {
        const existing = latest.get(group.dealId)
        if (!existing || createdAt > existing) {
          latest.set(group.dealId, createdAt)
        }
      }
    }
    return latest
  }

  /** Compute health for a set of open deals, skipping closed ones (null). */
  async computeForDeals(
    tenantId: string,
    deals: HealthDealRow[],
    now: Date,
  ): Promise<DealHealthEntry[]> {
    if (deals.length === 0) return []

    const activityMap = await this.resolveLastActivityAt(
      tenantId,
      deals.map((deal) => deal.id),
    )

    const entries: DealHealthEntry[] = []
    for (const deal of deals) {
      const lastActivityAt = activityMap.get(deal.id) ?? deal.updatedAt
      const health = scoreDealHealth(
        {
          stageIsWon: deal.stage.isWon,
          stageIsLost: deal.stage.isLost,
          stageProbability: deal.stage.probability,
          dealProbability: deal.probability,
          expectedCloseDate: deal.expectedCloseDate,
          lastActivityAt,
        },
        now,
      )
      if (health) {
        entries.push({ deal, health, lastActivityAt })
      }
    }
    return entries
  }

  /**
   * Health for one deal. DealsService.findOne is the single authorization
   * primitive: one call enforces tenant scope, soft delete and
   * resolveVisibilityFilter, and throws the identical NotFoundException for
   * all three failure modes. DealReminder/DealReminderSnooze have no ownerId,
   * so resolveVisibilityFilter must not be layered on again.
   */
  async findOneHealth(
    tenantId: string,
    userId: string,
    dealId: string,
    now: Date = new Date(),
  ): Promise<SingleDealHealth> {
    const deal = await this.deals.findOne(tenantId, userId, dealId)
    const dealWithStage = deal as unknown as HealthDealRow & {
      expectedCloseDate: Date | null
      updatedAt: Date
    }

    const activityMap = await this.resolveLastActivityAt(tenantId, [dealId])
    const lastActivityAt = activityMap.get(dealId) ?? dealWithStage.updatedAt

    const health = scoreDealHealth(
      {
        stageIsWon: dealWithStage.stage.isWon,
        stageIsLost: dealWithStage.stage.isLost,
        stageProbability: dealWithStage.stage.probability,
        dealProbability: dealWithStage.probability,
        expectedCloseDate: dealWithStage.expectedCloseDate,
        lastActivityAt,
      },
      now,
    )

    const snooze = await this.prisma.dealReminderSnooze.findFirst({
      where: { tenantId, dealId, userId, deletedAt: null, snoozedUntil: { gt: now } },
      select: { snoozedUntil: true },
    })

    return { health, lastActivityAt, snoozedUntil: snooze?.snoozedUntil ?? null }
  }

  /**
   * At-risk deals for the calling user. Builds its where with
   * DealsService.buildDealWhere (already visibility-filtered), narrows to open
   * stages, computes health live, keeps AT_RISK and STALE, drops deals the
   * caller has actively snoozed, sorts worst-first and paginates in TypeScript.
   * Must NOT call DealsService.findMany — its MAX_PAGE_SIZE clamp would
   * silently under-report the total.
   */
  async findAtRisk(
    tenantId: string,
    userId: string,
    pagination: { page?: number; pageSize?: number } = {},
    now: Date = new Date(),
  ): Promise<AtRiskDealConnection> {
    const page = Math.max(pagination.page ?? DEFAULT_PAGE, 1)
    const pageSize = Math.min(Math.max(pagination.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)

    const baseWhere = await this.deals.buildDealWhere(tenantId, userId, {})
    const openStageFilter = { stage: { isWon: false, isLost: false, deletedAt: null } }
    const where = {
      ...baseWhere,
      AND: [
        ...(Array.isArray(baseWhere.AND) ? baseWhere.AND : baseWhere.AND ? [baseWhere.AND] : []),
        openStageFilter,
      ],
    }

    const deals = await this.prisma.deal.findMany({
      where,
      select: dealHealthSelect,
    })

    const entries = await this.computeForDeals(tenantId, deals as unknown as HealthDealRow[], now)

    let atRisk = entries.filter(
      (entry) => entry.health.status === 'AT_RISK' || entry.health.status === 'STALE',
    )

    if (atRisk.length > 0) {
      const snoozes = await this.prisma.dealReminderSnooze.findMany({
        where: {
          tenantId,
          userId,
          dealId: { in: atRisk.map((entry) => entry.deal.id) },
          deletedAt: null,
          snoozedUntil: { gt: now },
        },
        select: { dealId: true },
      })
      const snoozedDealIds = new Set(snoozes.map((snooze) => snooze.dealId))
      atRisk = atRisk.filter((entry) => !snoozedDealIds.has(entry.deal.id))
    }

    atRisk.sort((a, b) => {
      if (a.health.score !== b.health.score) {
        return a.health.score - b.health.score
      }
      const aDate = a.deal.expectedCloseDate
        ? a.deal.expectedCloseDate.getTime()
        : Number.MAX_SAFE_INTEGER
      const bDate = b.deal.expectedCloseDate
        ? b.deal.expectedCloseDate.getTime()
        : Number.MAX_SAFE_INTEGER
      return aDate - bDate
    })

    const total = atRisk.length
    const start = (page - 1) * pageSize
    const items = atRisk.slice(start, start + pageSize)

    return { items, total, page, pageSize }
  }

  /**
   * The daily sweep. Tenant-wide: the where is built from scratch and must
   * NOT call buildDealWhere / resolveVisibilityFilter — a sweep has no caller
   * visibility; scoping it to one user's visibility would produce reminders
   * only for that user's deals.
   */
  async runSweep(tenantId: string, actingUserId: string, now: Date): Promise<SweepResult> {
    const sweepDate = toUtcMidnight(now)

    const deals = await this.prisma.deal.findMany({
      where: {
        tenantId,
        deletedAt: null,
        stage: { isWon: false, isLost: false, deletedAt: null },
      },
      select: dealHealthSelect,
    })

    const activityMap = await this.resolveLastActivityAt(
      tenantId,
      deals.map((deal) => deal.id),
    )

    const ownerIds = Array.from(new Set(deals.map((deal) => deal.ownerId)))

    const [preferenceRows, snoozeRows] = await Promise.all([
      ownerIds.length > 0
        ? this.prisma.userReminderPreference.findMany({
            where: { tenantId, userId: { in: ownerIds }, deletedAt: null },
          })
        : Promise.resolve([]),
      deals.length > 0
        ? this.prisma.dealReminderSnooze.findMany({
            where: {
              tenantId,
              dealId: { in: deals.map((deal) => deal.id) },
              deletedAt: null,
              snoozedUntil: { gt: now },
            },
            select: { dealId: true, userId: true },
          })
        : Promise.resolve([]),
    ])

    const preferences = new Map<string, PreferenceRow>()
    for (const row of preferenceRows as unknown as PreferenceRow[]) {
      preferences.set(row.userId, row)
    }
    const snoozedKeys = new Set(
      (snoozeRows as unknown as SnoozeRow[]).map((snooze) => `${snooze.dealId}:${snooze.userId}`),
    )

    const isMondayUtc = sweepDate.getUTCDay() === 1

    const data: Array<{
      tenantId: string
      dealId: string
      userId: string
      reason: string
      healthStatus: string
      healthScore: number
      sweepDate: Date
      createdBy: string
      updatedBy: string
    }> = []
    let dealsEvaluated = 0

    for (const deal of deals as unknown as HealthDealRow[] & { ownerId: string }[]) {
      const lastActivityAt = activityMap.get(deal.id) ?? deal.updatedAt
      const health = scoreDealHealth(
        {
          stageIsWon: deal.stage.isWon,
          stageIsLost: deal.stage.isLost,
          stageProbability: deal.stage.probability,
          dealProbability: deal.probability,
          expectedCloseDate: deal.expectedCloseDate,
          lastActivityAt,
        },
        now,
      )
      if (!health) continue
      dealsEvaluated += 1

      const ownerId = deal.ownerId
      const preference = preferences.get(ownerId)
      const emailFrequency = preference?.emailFrequency ?? 'DAILY'
      const isSnoozed = snoozedKeys.has(`${deal.id}:${ownerId}`)

      // The three triggers from epics.md:1168.
      const reasons: string[] = []
      const daysSinceLastActivity = daysBetweenUtc(lastActivityAt, now)
      if (daysSinceLastActivity >= STALE_ACTIVITY_DAYS) {
        reasons.push('NO_ACTIVITY_7D')
      }
      if (deal.expectedCloseDate) {
        const daysUntilClose = daysBetweenUtc(now, deal.expectedCloseDate)
        if (daysUntilClose >= 0 && daysUntilClose <= CLOSING_SOON_DAYS) {
          reasons.push('CLOSING_SOON_3D')
        }
      }
      if (health.status !== 'HEALTHY') {
        reasons.push('AT_RISK')
      }

      for (const reason of reasons) {
        if (isSnoozed) continue
        if (emailFrequency === 'OFF') continue
        if (emailFrequency === 'WEEKLY' && !isMondayUtc) continue
        if (reason === 'NO_ACTIVITY_7D' && preference?.notifyNoActivity === false) continue
        if (reason === 'CLOSING_SOON_3D' && preference?.notifyClosingSoon === false) continue
        if (reason === 'AT_RISK' && preference?.notifyAtRisk === false) continue

        data.push({
          tenantId,
          dealId: deal.id,
          userId: ownerId,
          reason,
          healthStatus: health.status,
          healthScore: health.score,
          sweepDate,
          createdBy: actingUserId,
          updatedBy: actingUserId,
        })
      }
    }

    let remindersCreated = 0
    if (data.length > 0) {
      const result = await this.prisma.dealReminder.createMany({ data, skipDuplicates: true })
      remindersCreated = result.count
    }

    // The AuditInterceptor fires only for GraphQL mutations and drops the
    // entry when no id can be extracted — neither the lazy trigger (a Query)
    // nor the bulk write would ever be audited by it. NFR9 requires it.
    await this.audit.log({
      tenantId,
      userId: actingUserId,
      action: 'UPDATE',
      entity: 'DEAL',
      entityId: tenantId,
      details: {
        sweepDate: sweepDate.toISOString(),
        dealsEvaluated,
        remindersCreated,
      },
    })

    return { sweepDate, dealsEvaluated, remindersCreated }
  }

  /**
   * Lazy daily trigger: runs runSweep at most once per tenant per UTC day,
   * determined by whether any DealReminder row already exists for today's
   * sweepDate. Failures are caught and logged — the at-risk query must never
   * 500 because a sweep hiccuped.
   */
  async ensureSweptToday(tenantId: string, userId: string, now: Date): Promise<void> {
    try {
      const today = toUtcMidnight(now)
      const existing = await this.prisma.dealReminder.findFirst({
        where: { tenantId, sweepDate: today },
        select: { id: true },
      })
      if (existing) return
      await this.runSweep(tenantId, userId, now)
    } catch (error) {
      this.logger.error(
        `Deal health sweep failed for tenant ${tenantId}: ${(error as Error).message}`,
      )
    }
  }

  async snoozeDealReminder(
    tenantId: string,
    userId: string,
    dealId: string,
    days: number,
    now: Date = new Date(),
  ): Promise<Record<string, unknown>> {
    if (!(SNOOZE_DAYS as readonly number[]).includes(days)) {
      throw new BadRequestException('days must be one of 7, 14, 30')
    }

    // Verify deal access first — one call enforces tenant scope, soft delete
    // and visibility.
    await this.deals.findOne(tenantId, userId, dealId)

    const snoozedUntil = toUtcMidnight(now)
    snoozedUntil.setUTCDate(snoozedUntil.getUTCDate() + days)

    return this.prisma.dealReminderSnooze.upsert({
      where: { tenantId_dealId_userId: { tenantId, dealId, userId } },
      create: {
        tenantId,
        dealId,
        userId,
        snoozedUntil,
        createdBy: userId,
        updatedBy: userId,
      },
      update: {
        snoozedUntil,
        updatedBy: userId,
        deletedAt: null,
      },
    })
  }

  async unsnoozeDealReminder(tenantId: string, userId: string, dealId: string): Promise<boolean> {
    await this.deals.findOne(tenantId, userId, dealId)

    const result = await this.prisma.dealReminderSnooze.updateMany({
      where: { tenantId, dealId, userId, deletedAt: null },
      data: { deletedAt: new Date(), updatedBy: userId },
    })

    if (result.count === 0) {
      throw new NotFoundException('Snooze not found')
    }

    return true
  }

  /** The caller's preference row, or defaults when none exists — no side effects. */
  async myReminderPreferences(tenantId: string, userId: string): Promise<Record<string, unknown>> {
    const row = await this.prisma.userReminderPreference.findFirst({
      where: { tenantId, userId, deletedAt: null },
    })
    if (!row) {
      return { ...DEFAULT_PREFERENCES }
    }
    return row
  }

  async updateReminderPreferences(
    tenantId: string,
    userId: string,
    input: UpdateReminderPreferenceInput,
  ): Promise<Record<string, unknown>> {
    if (!isEmailFrequency(input.emailFrequency)) {
      throw new BadRequestException('emailFrequency must be one of DAILY, WEEKLY, OFF')
    }

    return this.prisma.userReminderPreference.upsert({
      where: { tenantId_userId: { tenantId, userId } },
      create: {
        tenantId,
        userId,
        emailFrequency: input.emailFrequency,
        notifyNoActivity: input.notifyNoActivity,
        notifyClosingSoon: input.notifyClosingSoon,
        notifyAtRisk: input.notifyAtRisk,
        createdBy: userId,
        updatedBy: userId,
      },
      update: {
        emailFrequency: input.emailFrequency,
        notifyNoActivity: input.notifyNoActivity,
        notifyClosingSoon: input.notifyClosingSoon,
        notifyAtRisk: input.notifyAtRisk,
        updatedBy: userId,
        deletedAt: null,
      },
    })
  }
}
