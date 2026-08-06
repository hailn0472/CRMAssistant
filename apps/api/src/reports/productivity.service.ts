import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { TimeEntriesService } from '../time-tracking/time-entries.service'
import { resolveVisibilityFilter } from '../common/guards/visibility-check'
import { parseDateOrThrow } from './forecast.service'
import { bucketKey, collapseToTopN, enumerateBuckets, percentageOf } from './productivity-buckets'
import type { ProductivityBucket } from './productivity-buckets'

// ─── Types ───────────────────────────────────────────────────────────────────

export type ProductivityReportInput = {
  userId?: string
  startDate: string
  endDate: string
  bucket?: ProductivityBucket
}

export type ProductivityTaskBucket = {
  taskId: string
  taskTitle: string
  totalSeconds: number
  percentage: number
}

export type ProductivityRelatedBucket = {
  kind: 'CONTACT' | 'DEAL' | 'NONE'
  id: string | null
  label: string
  totalSeconds: number
  percentage: number
}

export type ProductivityTimeBucket = {
  bucketStart: string
  totalSeconds: number
}

export type ProductivityReportResult = {
  userId: string
  startDate: string
  endDate: string
  bucket: ProductivityBucket
  totalSeconds: number
  entryCount: number
  trackedDays: number
  averageSecondsPerTrackedDay: number
  byTask: ProductivityTaskBucket[]
  byRelated: ProductivityRelatedBucket[]
  buckets: ProductivityTimeBucket[]
}

// AC 20: bounded by construction — silent truncation would render a report
// that reads as complete and is not (4.4 Minor M1 was exactly this class).
export const MAX_REPORT_ENTRIES = 20000

const MS_PER_DAY = 24 * 60 * 60 * 1000
const MAX_RANGE_DAYS = 366

// The narrow report select (AC 19): id/taskId/startTime/durationSeconds plus
// the task join for the byTask/byRelated breakdowns. Extra fields are
// harmless; a field missing from here is absent from the reduce.
const REPORT_ENTRY_SELECT = {
  id: true,
  taskId: true,
  startTime: true,
  durationSeconds: true,
  task: {
    select: {
      id: true,
      title: true,
      contactId: true,
      dealId: true,
      contact: { select: { firstName: true, lastName: true } },
      deal: { select: { title: true } },
    },
  },
} as const

type ReportEntry = Prisma.TimeEntryGetPayload<{ select: typeof REPORT_ENTRY_SELECT }>

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class ProductivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timeEntries: TimeEntriesService,
  ) {}

  /**
   * AC 15-22. One query, one in-memory reduce — no $queryRaw (raw SQL at this
   * boundary would bypass the service-layer tenant + visibility guards, the
   * only isolation this system has). durationSeconds on the row is the single
   * source of truth and is never recomputed from startTime/endTime (AC 22).
   */
  async productivityReport(
    tenantId: string,
    callerUserId: string,
    input: ProductivityReportInput,
  ): Promise<ProductivityReportResult> {
    const startDate = parseDateOrThrow(input.startDate, 'startDate')
    const endDate = parseDateOrThrow(input.endDate, 'endDate')

    if (endDate < startDate) {
      throw new BadRequestException('endDate must be >= startDate')
    }
    // AC 16: an unbounded productivity query over 10M rows is the NFR11
    // failure mode — startDate/endDate are required and capped at 366 days.
    if ((endDate.getTime() - startDate.getTime()) / MS_PER_DAY > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `Productivity report range must not exceed ${MAX_RANGE_DAYS} days`,
      )
    }

    const bucket = input.bucket ?? 'DAY'

    // AC 17: userId is optional and defaults to the caller. A supplied
    // different userId must sit inside the caller's visibility scope —
    // verified as a NON-ADMIN rule (ADMIN bypasses both requirePermission and
    // resolveVisibilityFilter, so an ADMIN-only test asserts nothing).
    const userId = input.userId ?? callerUserId
    if (userId !== callerUserId) {
      const visibilityFilter = await resolveVisibilityFilter(callerUserId, tenantId)
      if (visibilityFilter !== undefined) {
        const allowed =
          typeof visibilityFilter === 'string'
            ? visibilityFilter === userId
            : (visibilityFilter as { in: string[] }).in.includes(userId)
        if (!allowed) {
          throw new ForbiddenException(
            "You do not have permission to view this user's productivity report.",
          )
        }
      }
    }

    // AC 18: compose TimeEntriesService.buildTimeEntryWhere with the subject
    // and the date range — never a second hand-rolled predicate (finding
    // 3.7-F4 was a divergence of exactly this class).
    const scope = await this.timeEntries.buildTimeEntryWhere(tenantId, callerUserId, {
      userId,
      startFrom: input.startDate,
      startTo: input.endDate,
    })

    // AC 21: running entries are excluded — a running timer has
    // durationSeconds 0 and no end, so counting it would report zero for time
    // actively being spent. Entries whose parent task is soft-deleted are
    // INCLUDED (the time was really spent); the task join still reads the
    // title. This is a layered filter on the composed where, not a re-derived
    // scope.
    const andConditions = Array.isArray(scope.AND) ? scope.AND : scope.AND ? [scope.AND] : []
    andConditions.push({ endTime: { not: null } })
    const where: Prisma.TimeEntryWhereInput = { ...scope, AND: andConditions }

    // AC 19: fetch all rows in range (NOT through findMany — it clamps
    // pageSize!). AC 20: take MAX + 1 and throw when the extra row comes back.
    const entries = await this.prisma.timeEntry.findMany({
      where,
      select: REPORT_ENTRY_SELECT,
      take: MAX_REPORT_ENTRIES + 1,
    })

    if (entries.length > MAX_REPORT_ENTRIES) {
      throw new BadRequestException('Too many time entries in this range — narrow the date range.')
    }

    return this.reduceReport(entries, { userId, startDate, endDate, bucket })
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private reduceReport(
    entries: ReportEntry[],
    ctx: { userId: string; startDate: Date; endDate: Date; bucket: ProductivityBucket },
  ): ProductivityReportResult {
    let totalSeconds = 0
    const trackedDays = new Set<string>()
    const byTaskMap = new Map<string, { taskId: string; taskTitle: string; totalSeconds: number }>()
    const byRelatedMap = new Map<
      string,
      { kind: 'CONTACT' | 'DEAL' | 'NONE'; id: string | null; label: string; totalSeconds: number }
    >()
    const bucketsMap = new Map<string, number>()

    for (const entry of entries) {
      // AC 22: durationSeconds is the single source of truth — never
      // recompute from startTime/endTime.
      totalSeconds += entry.durationSeconds
      trackedDays.add(bucketKey(entry.startTime, 'DAY'))

      const task = entry.task
      const taskId = task.id
      const existingTask = byTaskMap.get(taskId)
      if (existingTask) {
        existingTask.totalSeconds += entry.durationSeconds
      } else {
        byTaskMap.set(taskId, {
          taskId,
          taskTitle: task.title,
          totalSeconds: entry.durationSeconds,
        })
      }

      // AC 24: byRelated buckets by the task's dealId first, then contactId,
      // then NONE ('Unlinked').
      let key: string
      let kind: 'CONTACT' | 'DEAL' | 'NONE'
      let id: string | null
      let label: string
      if (task.dealId && task.deal) {
        key = `deal:${task.dealId}`
        kind = 'DEAL'
        id = task.dealId
        label = task.deal.title
      } else if (task.contactId && task.contact) {
        key = `contact:${task.contactId}`
        kind = 'CONTACT'
        id = task.contactId
        label = `${task.contact.firstName} ${task.contact.lastName}`.trim()
      } else {
        key = 'none'
        kind = 'NONE'
        id = null
        label = 'Unlinked'
      }
      const existingRelated = byRelatedMap.get(key)
      if (existingRelated) {
        existingRelated.totalSeconds += entry.durationSeconds
      } else {
        byRelatedMap.set(key, { kind, id, label, totalSeconds: entry.durationSeconds })
      }

      const bucketStart = bucketKey(entry.startTime, ctx.bucket)
      bucketsMap.set(bucketStart, (bucketsMap.get(bucketStart) ?? 0) + entry.durationSeconds)
    }

    const entryCount = entries.length
    const trackedDayCount = trackedDays.size

    // byTask: sorted desc, capped at 8 + Other (AC 24), percentages rounded.
    const byTaskRows = Array.from(byTaskMap.values()).sort(
      (a, b) => b.totalSeconds - a.totalSeconds,
    )
    const byTask = collapseToTopN(byTaskRows, 8, 'Other').map((row) => ({
      taskId: row.taskId,
      taskTitle: row.taskTitle,
      totalSeconds: row.totalSeconds,
      percentage: percentageOf(row.totalSeconds, totalSeconds),
    }))

    const byRelated = Array.from(byRelatedMap.values())
      .sort((a, b) => b.totalSeconds - a.totalSeconds)
      .map((row) => ({
        kind: row.kind,
        id: row.id,
        label: row.label,
        totalSeconds: row.totalSeconds,
        percentage: percentageOf(row.totalSeconds, totalSeconds),
      }))

    // AC 23: dense, zero-filled bucket list — a day with no tracked time
    // renders as a zero bar rather than vanishing from the chart.
    const buckets = enumerateBuckets(ctx.startDate, ctx.endDate, ctx.bucket).map((key) => ({
      bucketStart: new Date(`${key}T00:00:00.000Z`).toISOString(),
      totalSeconds: bucketsMap.get(key) ?? 0,
    }))

    return {
      userId: ctx.userId,
      startDate: ctx.startDate.toISOString().slice(0, 10),
      endDate: ctx.endDate.toISOString().slice(0, 10),
      bucket: ctx.bucket,
      totalSeconds,
      entryCount,
      trackedDays: trackedDayCount,
      averageSecondsPerTrackedDay: trackedDayCount === 0 ? 0 : totalSeconds / trackedDayCount,
      byTask,
      byRelated,
      buckets,
    }
  }
}
