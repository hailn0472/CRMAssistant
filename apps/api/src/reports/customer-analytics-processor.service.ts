/**
 * Story 6.7 daily customer analytics processor (Contract C16–C25).
 *
 * Runs once per day at 02:00 UTC (six-field Nest cron). For every active
 * contact of every tenant it materializes the current Contact analytics
 * fields and one CustomerAnalyticsSnapshot row (unique per contact/day) using
 * fixed per-batch aggregate queries — never per-contact queries, never
 * unbounded findMany. Churn-prevention tasks are created through the internal
 * TasksService automation path on LOW/MEDIUM → HIGH transitions only, with a
 * deterministic automationKey that makes reruns/concurrent instances
 * idempotent.
 *
 * Clock, batch size, concurrency and retry attempts are injectable so unit
 * tests can drive deterministic runs (Contract C16).
 */
import { Injectable, Logger, Optional } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import type { ActivityType } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { TasksService } from '../tasks/tasks.service'
import {
  calculateChurnRiskScore,
  calculateDealWinRate,
  calculateEngagementRisk,
  calculateEngagementScore,
  calculateInactivityRisk,
  calculateLifetimeValue,
  calculateWinRateRisk,
  categorizeChurnRisk,
  QUALIFYING_ACTIVITY_TYPES,
  toUtcMidnight,
  type CustomerChurnRisk,
} from './customer-analytics-score'

export const DEFAULT_BATCH_SIZE = 500
export const DEFAULT_CONCURRENCY = 4
export const DEFAULT_RETRY_ATTEMPTS = 3
const TENANT_BATCH_SIZE = 1000
const MS_PER_DAY = 86_400_000
const AUTOMATION_SOURCE = 'CHURN_RISK'

export type CustomerAnalyticsProcessorResult = {
  tenants: number
  contactsSucceeded: number
  contactsFailed: number
  tasksCreated: number
  taskFailures: number
}

// Hand-duplicated from report-schedule-processor.service.ts (same helper —
// not exported there). Bounded workers over a fixed work list.
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let index = 0
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      for (;;) {
        const current = index++
        if (current >= items.length) return
        results[current] = await worker(items[current]!)
      }
    },
  )
  await Promise.all(workers)
  return results
}

const CONTACT_ROW_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  ownerId: true,
  createdAt: true,
} as const

type ContactRow = {
  id: string
  firstName: string
  lastName: string
  email: string
  ownerId: string
  createdAt: Date
}

type BatchAggregates = {
  lastActivityByContact: Map<string, Date>
  qualifyingCountByContact: Map<string, number>
  wonValueByContact: Map<string, number[]>
  wonCountByContact: Map<string, number>
  lostCountByContact: Map<string, number>
}

@Injectable()
export class CustomerAnalyticsProcessor {
  private readonly logger = new Logger(CustomerAnalyticsProcessor.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasksService: TasksService,
    // Injectable clock/bounds for deterministic tests; defaults to system.
    @Optional() private readonly clock: () => Date = () => new Date(),
    @Optional() private readonly batchSize: number = DEFAULT_BATCH_SIZE,
    @Optional() private readonly concurrency: number = DEFAULT_CONCURRENCY,
    @Optional() private readonly retryAttempts: number = DEFAULT_RETRY_ATTEMPTS,
  ) {}

  /** Daily 02:00 UTC recalculation (six-field Nest cron). */
  @Cron('0 0 2 * * *')
  async runDailyProcessing(): Promise<CustomerAnalyticsProcessorResult> {
    const now = this.clock()
    const snapshotDate = toUtcMidnight(now)
    const summary: CustomerAnalyticsProcessorResult = {
      tenants: 0,
      contactsSucceeded: 0,
      contactsFailed: 0,
      tasksCreated: 0,
      taskFailures: 0,
    }

    for await (const tenantIds of this.readTenantIdBatches()) {
      summary.tenants += tenantIds.length
      await mapWithConcurrency(tenantIds, this.concurrency, async (tenantId) => {
        try {
          await this.processTenant(tenantId, snapshotDate, now, summary)
        } catch (error) {
          this.logger.error(
            `Customer analytics tenant ${tenantId} failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        }
      })
    }

    this.logger.log(
      `Customer analytics run complete: ${summary.tenants} tenant(s), ` +
        `${summary.contactsSucceeded} succeeded, ${summary.contactsFailed} failed, ` +
        `${summary.tasksCreated} task(s) created, ${summary.taskFailures} task failure(s)`,
    )
    return summary
  }

  private async *readTenantIdBatches(): AsyncGenerator<string[]> {
    let offset = 0
    for (;;) {
      const tenants = await this.prisma.tenant.findMany({
        select: { id: true },
        orderBy: { id: 'asc' },
        skip: offset,
        take: TENANT_BATCH_SIZE,
      })
      if (tenants.length === 0) return
      yield tenants.map((t) => t.id)
      offset += tenants.length
    }
  }

  private async processTenant(
    tenantId: string,
    snapshotDate: Date,
    now: Date,
    summary: CustomerAnalyticsProcessorResult,
  ): Promise<void> {
    let offset = 0
    for (;;) {
      // Stable (createdAt, id) order — deterministic across runs (B1).
      const contacts = await this.prisma.contact.findMany({
        where: { tenantId, deletedAt: null },
        select: CONTACT_ROW_SELECT,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: offset,
        take: this.batchSize,
      })
      if (contacts.length === 0) return

      const batchIds = contacts.map((c) => c.id)
      // Load the batch aggregates ONCE — the fixed 4 queries are per-batch,
      // never per contact (C18). Each contact then materializes from the map.
      // C20/R2-F2: a failed aggregate load loses the WHOLE batch's inputs —
      // count every contact in it as failed, log tenant + deterministic batch
      // metadata (offset/count, never contact ids/names/PII), advance the
      // offset and continue with the next batch. The batch's contacts are
      // NOT processed per-contact (no double counting).
      let aggregates: BatchAggregates
      try {
        aggregates = await this.loadBatchAggregates(tenantId, batchIds, snapshotDate)
      } catch (error) {
        summary.contactsFailed += contacts.length
        this.logger.error(
          `Customer analytics batch failed [tenant=${tenantId}, offset=${offset}, count=${contacts.length}]: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        offset += contacts.length
        continue
      }
      const batchResults = await mapWithConcurrency(contacts, this.concurrency, (contact) =>
        this.processContact(tenantId, contact, aggregates, snapshotDate, now, summary),
      )
      // processContact() already counted failures in the summary on error;
      // successes are counted here exactly once per contact.
      summary.contactsSucceeded += batchResults.filter((r) => r).length

      offset += contacts.length
    }
  }

  /**
   * Materialize one contact/day from the pre-loaded batch aggregates. Each
   * contact is written in a short transaction (current fields + unique
   * snapshot upsert). Task creation happens OUTSIDE the transaction so
   * notification/pub-sub side effects never hold a DB transaction (C19, C20).
   */
  private async processContact(
    tenantId: string,
    contact: ContactRow,
    aggregates: BatchAggregates,
    snapshotDate: Date,
    now: Date,
    summary: CustomerAnalyticsProcessorResult,
  ): Promise<boolean> {
    try {
      const lastActivity = aggregates.lastActivityByContact.get(contact.id) ?? null
      const engagementCount = aggregates.qualifyingCountByContact.get(contact.id) ?? 0
      const wonValues = aggregates.wonValueByContact.get(contact.id) ?? []
      const wonCount = aggregates.wonCountByContact.get(contact.id) ?? 0
      const lostCount = aggregates.lostCountByContact.get(contact.id) ?? 0

      const lifetimeValue = calculateLifetimeValue(wonValues)
      const dealWinRate = calculateDealWinRate(wonCount, lostCount)
      const engagementScore = calculateEngagementScore(engagementCount)
      const inactivityRisk = calculateInactivityRisk(lastActivity, contact.createdAt, snapshotDate)
      const churnRiskScore = calculateChurnRiskScore({
        inactivityRisk,
        winRateRisk: calculateWinRateRisk(dealWinRate),
        engagementRisk: calculateEngagementRisk(engagementScore),
      })
      const churnRisk = categorizeChurnRisk(churnRiskScore)

      // Short per-contact transaction: current Contact fields + snapshot
      // upsert. Never spans the tenant or notification side effects. Every
      // write is tenant-scoped + active-only — never id-only (F3).
      const snapshot = await this.withRetry(async () => {
        return this.prisma.$transaction(async (tx) => {
          await tx.contact.update({
            where: { id: contact.id, tenantId, deletedAt: null },
            data: {
              lifetimeValue,
              churnRisk,
              churnRiskScore,
              lastActivityDate: lastActivity,
              analyticsCalculatedAt: now,
            },
          })
          return tx.customerAnalyticsSnapshot.upsert({
            where: {
              tenantId_contactId_snapshotDate: {
                tenantId,
                contactId: contact.id,
                snapshotDate,
              },
            },
            create: {
              tenantId,
              contactId: contact.id,
              snapshotDate,
              acquisitionCohort: contact.createdAt.toISOString().slice(0, 7),
              lifetimeValue,
              churnRiskScore,
              churnRisk,
              lastActivityDate: lastActivity,
              inactivityRisk,
              dealWinRate,
              engagementScore,
              wonDealCount: wonCount,
              lostDealCount: lostCount,
              qualifyingActivityCount: engagementCount,
            },
            update: {
              lifetimeValue,
              churnRiskScore,
              churnRisk,
              lastActivityDate: lastActivity,
              inactivityRisk,
              dealWinRate,
              engagementScore,
              wonDealCount: wonCount,
              lostDealCount: lostCount,
              qualifyingActivityCount: engagementCount,
              updatedBy: 'system',
            },
          })
        })
      })

      await this.maybeCreateChurnTask(
        tenantId,
        contact,
        snapshotDate,
        churnRisk,
        churnRiskScore,
        lastActivity,
        snapshot.id,
        summary,
      )
      return true
    } catch (error) {
      summary.contactsFailed += 1
      this.logger.error(
        `Customer analytics contact failed [tenant=${tenantId}, contact=${contact.id}]: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return false
    }
  }

  /**
   * C18: exactly four aggregate queries per contact batch — latest activity,
   * qualifying 90-day engagement count, won deals grouped by
   * (contactId, currency) with sum+count, lost deals count. Every query is
   * tenant-scoped, restricted to the batch parent ids and applies the
   * active/deleted constraints. No N+1, no unbounded reads.
   */
  private async loadBatchAggregates(
    tenantId: string,
    contactIds: string[],
    snapshotDate: Date,
  ): Promise<BatchAggregates> {
    const windowStart = new Date(snapshotDate.getTime() - 90 * MS_PER_DAY)
    const windowEndExclusive = new Date(snapshotDate.getTime() + MS_PER_DAY)

    const [latestGroups, engagementGroups, wonCurrencyGroups, lostGroups] = await Promise.all([
      this.prisma.activity.groupBy({
        by: ['contactId'],
        where: { tenantId, contactId: { in: contactIds } },
        _max: { createdAt: true },
      }),
      this.prisma.activity.groupBy({
        by: ['contactId'],
        where: {
          tenantId,
          contactId: { in: contactIds },
          type: { in: QUALIFYING_ACTIVITY_TYPES as unknown as ActivityType[] },
          createdAt: { gte: windowStart, lt: windowEndExclusive },
        },
        _count: { _all: true },
      }),
      this.prisma.deal.groupBy({
        by: ['contactId', 'currency'],
        where: {
          tenantId,
          contactId: { in: contactIds },
          deletedAt: null,
          stage: { isWon: true, deletedAt: null },
        },
        _sum: { value: true },
        _count: { _all: true },
      }),
      this.prisma.deal.groupBy({
        by: ['contactId'],
        where: {
          tenantId,
          contactId: { in: contactIds },
          deletedAt: null,
          stage: { isLost: true, deletedAt: null },
        },
        _count: { _all: true },
      }),
    ])

    const lastActivityByContact = new Map<string, Date>()
    for (const group of latestGroups) {
      const createdAt = group._max?.createdAt
      if (createdAt) lastActivityByContact.set(group.contactId, createdAt)
    }

    const qualifyingCountByContact = new Map<string, number>()
    for (const group of engagementGroups) {
      qualifyingCountByContact.set(group.contactId, group._count?._all ?? 0)
    }

    const wonValueByContact = new Map<string, number[]>()
    const wonCountByContact = new Map<string, number>()
    for (const group of wonCurrencyGroups) {
      const value = group._sum?.value
      if (typeof value === 'number') {
        const values = wonValueByContact.get(group.contactId) ?? []
        values.push(value)
        wonValueByContact.set(group.contactId, values)
      }
      wonCountByContact.set(
        group.contactId,
        (wonCountByContact.get(group.contactId) ?? 0) + (group._count?._all ?? 0),
      )
    }

    const lostCountByContact = new Map<string, number>()
    for (const group of lostGroups) {
      lostCountByContact.set(group.contactId, group._count?._all ?? 0)
    }

    return {
      lastActivityByContact,
      qualifyingCountByContact,
      wonValueByContact,
      wonCountByContact,
      lostCountByContact,
    }
  }

  /**
   * C21–C23: a churn-prevention task is created only on a transition into
   * HIGH (no previous snapshot, or previous snapshot not HIGH) and only when
   * today's snapshot does not already carry a linked task. The deterministic
   * automationKey (CHURN_RISK:<contactId>:<YYYY-MM-DD>) makes concurrent
   * instances/reruns idempotent via the Task unique constraint. An inactive
   * owner fails task creation safely (logged, retried next run) — never
   * reassigned to a different user.
   */
  private async maybeCreateChurnTask(
    tenantId: string,
    contact: ContactRow,
    snapshotDate: Date,
    churnRisk: CustomerChurnRisk,
    churnRiskScore: number,
    lastActivity: Date | null,
    snapshotId: string,
    summary: CustomerAnalyticsProcessorResult,
  ): Promise<void> {
    if (churnRisk !== 'HIGH') return

    const previous = await this.prisma.customerAnalyticsSnapshot.findFirst({
      where: {
        tenantId,
        contactId: contact.id,
        snapshotDate: { lt: snapshotDate },
        deletedAt: null,
      },
      orderBy: { snapshotDate: 'desc' },
      select: { churnRisk: true },
    })
    if (previous && previous.churnRisk === 'HIGH') {
      return // sustained HIGH — no new task (even if the old one is done)
    }

    // Idempotency marker on today's snapshot — a rerun must not re-create.
    // findFirst keeps the read tenant-scoped + active-only (F3) — the id is
    // unique but never read bare.
    const linked = await this.prisma.customerAnalyticsSnapshot.findFirst({
      where: { id: snapshotId, tenantId, deletedAt: null },
      select: { churnPreventionTaskId: true },
    })
    if (linked?.churnPreventionTaskId) return

    const owner = await this.prisma.user.findFirst({
      where: { id: contact.ownerId, tenantId, deletedAt: null, isActive: true },
      select: { id: true },
    })
    if (!owner) {
      summary.taskFailures += 1
      this.logger.warn(
        `Churn prevention task skipped — owner inactive [tenant=${tenantId}, contact=${contact.id}]`,
      )
      return
    }

    try {
      const automationKey = `CHURN_RISK:${contact.id}:${snapshotDate.toISOString().slice(0, 10)}`
      const task = await this.tasksService.createAutomatedTask(tenantId, {
        title: `Follow up with ${contact.firstName} ${contact.lastName} — high churn risk`,
        description: this.buildTaskDescription(churnRiskScore, lastActivity, contact.id),
        priority: 'HIGH',
        assignedTo: contact.ownerId,
        contactId: contact.id,
        dueDate: new Date(snapshotDate.getTime() + MS_PER_DAY),
        automationSource: AUTOMATION_SOURCE,
        automationKey,
      })
      await this.prisma.customerAnalyticsSnapshot.update({
        where: { id: snapshotId, tenantId, deletedAt: null },
        data: { churnPreventionTaskId: task.id, updatedBy: 'system' },
      })
      summary.tasksCreated += 1
    } catch (error) {
      summary.taskFailures += 1
      this.logger.warn(
        `Churn prevention task creation failed [tenant=${tenantId}, contact=${contact.id}]: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  /**
   * C21: score/last-activity summary + contact link intent for the task
   * description — deterministic, concise, no secrets/PII. Last activity is
   * the ISO UTC instant, or an explicit "no activity" marker when null.
   */
  private buildTaskDescription(
    churnRiskScore: number,
    lastActivity: Date | null,
    contactId: string,
  ): string {
    const lastActivityText = lastActivity ? lastActivity.toISOString() : 'No activity recorded'
    return (
      `Automated follow-up: contact moved to HIGH churn risk ` +
      `(score ${churnRiskScore.toFixed(1)}). ` +
      `Last activity: ${lastActivityText}. ` +
      `Open /contacts/${contactId} to re-engage the customer.`
    )
  }

  /** Bounded retry for transient P2034 transaction conflicts (C20, B6). */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown
    for (let attempt = 0; attempt < this.retryAttempts; attempt++) {
      try {
        return await fn()
      } catch (error) {
        lastError = error
        if (error instanceof PrismaClientKnownRequestError && error.code === 'P2034') {
          continue
        }
        throw error
      }
    }
    throw lastError
  }
}
