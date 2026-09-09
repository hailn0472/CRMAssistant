import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import { Prisma } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { TasksService } from '../tasks/tasks.service'
import { resolveVisibilityFilter } from '../common/guards/visibility-check'

// ─── Types ───────────────────────────────────────────────────────────────────

export type CreateTimeEntryInput = {
  taskId: string
  durationSeconds: number
  description?: string | null
  startTime?: string
}

export type UpdateTimeEntryInput = {
  durationSeconds?: number
  description?: string | null
  startTime?: string
}

export type TimeEntryFilterInput = {
  taskId?: string
  userId?: string
  startFrom?: string
  startTo?: string
  runningOnly?: boolean
}

export type TimeEntryPaginationInput = {
  page?: number
  pageSize?: number
}

export type TimeEntryConnection = {
  items: TimeEntryItem[]
  total: number
  page: number
  pageSize: number
}

// The select must cover EVERY field the Pothos TimeEntry ref exposes
// (including the nested task ref) or the resolver crashes at query time —
// Story 3.4 Critical, re-flagged on every story since. Walk it against
// time-tracking.graphql.ts before opening the PR. Extra fields in a select
// are harmless; only missing fields crash.
export const TIME_ENTRY_SELECT = {
  id: true,
  tenantId: true,
  taskId: true,
  userId: true,
  startTime: true,
  endTime: true,
  durationSeconds: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
  task: { select: { id: true, title: true } },
} as const

export type TimeEntryItem = Prisma.TimeEntryGetPayload<{ select: typeof TIME_ENTRY_SELECT }>

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100
const MIN_MANUAL_DURATION_SECONDS = 1
const MAX_MANUAL_DURATION_SECONDS = 86400 // 24h cap — a fat-fingered entry must not poison a report

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class TimeEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Service-level audit write. The global AuditInterceptor does NOT wrap
   * GraphQL resolvers (builder.toSchema() bypasses the NestJS resolver map)
   * — writing here is the only path that produces AuditLog rows (AC 29).
   * MUTATION_AUDIT_MAP is decorative; do not rely on it.
   */
  private writeAudit(
    tenantId: string,
    userId: string,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    entityId: string,
  ): Promise<void> {
    return this.audit.log({
      tenantId,
      userId,
      action,
      entity: 'TIME_ENTRY',
      entityId,
      details: { mutationName: action },
    })
  }

  /**
   * AC 6-7: one active timer per user, enforced in code inside a Serializable
   * interactive transaction. Postgres SSI aborts the loser of a concurrent
   * double-start with SQLSTATE 40001, surfaced by Prisma as P2034 — map that
   * to the same honest ConflictException so two racing clients never end up
   * with two running timers.
   */
  async startTimer(tenantId: string, userId: string, taskId: string): Promise<TimeEntryItem> {
    // Prove the task exists AND is visible to this user (AC 7) — findOne
    // throws NotFoundException for missing, soft-deleted, cross-tenant and
    // not-visible tasks alike.
    await this.tasks.findOne(tenantId, userId, taskId)

    const now = new Date()
    try {
      const created = await this.prisma.$transaction(
        async (tx) => {
          const running = await tx.timeEntry.findFirst({
            where: { tenantId, userId, endTime: null, deletedAt: null },
            select: { id: true },
          })
          if (running) {
            throw new ConflictException(
              'A timer is already running. Stop it before starting a new one.',
            )
          }
          return tx.timeEntry.create({
            data: {
              tenantId,
              taskId,
              userId,
              startTime: now,
              endTime: null,
              durationSeconds: 0,
              createdBy: userId,
              updatedBy: userId,
            },
            select: TIME_ENTRY_SELECT,
          })
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      await this.writeAudit(tenantId, userId, 'CREATE', created.id)
      return created
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2034') {
        throw new ConflictException(
          'A timer is already running. Stop it before starting a new one.',
        )
      }
      throw error
    }
  }

  /**
   * AC 8: sets endTime = now and durationSeconds from the real interval.
   * updateMany is scoped by the CALLER's userId and endTime: null — stopping
   * an already-stopped entry or another user's entry is a NotFoundException,
   * not silent idempotency.
   */
  async stopTimer(tenantId: string, userId: string, timeEntryId: string): Promise<TimeEntryItem> {
    const running = await this.prisma.timeEntry.findFirst({
      where: { id: timeEntryId, tenantId, userId, endTime: null, deletedAt: null },
      select: TIME_ENTRY_SELECT,
    })
    if (!running) {
      throw new NotFoundException('Running time entry not found')
    }

    const endTime = new Date()
    const durationSeconds = Math.max(
      0,
      Math.round((endTime.getTime() - running.startTime.getTime()) / 1000),
    )

    const result = await this.prisma.timeEntry.updateMany({
      where: { id: timeEntryId, tenantId, userId, endTime: null, deletedAt: null },
      data: { endTime, durationSeconds, updatedBy: userId },
    })

    if (result.count === 0) {
      throw new NotFoundException('Running time entry not found')
    }

    const stopped = await this.prisma.timeEntry.findFirst({
      where: { id: timeEntryId, tenantId },
      select: TIME_ENTRY_SELECT,
    })

    await this.writeAudit(tenantId, userId, 'UPDATE', timeEntryId)
    return stopped!
  }

  /**
   * AC 9: manual entry. durationSeconds must be an integer in [1, 86400];
   * startTime defaults to now - durationSeconds; endTime is always written as
   * startTime + durationSeconds so the three columns never disagree.
   */
  async createTimeEntry(
    tenantId: string,
    userId: string,
    input: CreateTimeEntryInput,
  ): Promise<TimeEntryItem> {
    await this.tasks.findOne(tenantId, userId, input.taskId)

    this.validateDuration(input.durationSeconds)

    const startTime = input.startTime
      ? this.parseStartTime(input.startTime)
      : new Date(Date.now() - input.durationSeconds * 1000)
    const endTime = new Date(startTime.getTime() + input.durationSeconds * 1000)

    const created = await this.prisma.timeEntry.create({
      data: {
        tenantId,
        taskId: input.taskId,
        userId,
        startTime,
        endTime,
        durationSeconds: input.durationSeconds,
        description: input.description ?? null,
        createdBy: userId,
        updatedBy: userId,
      },
      select: TIME_ENTRY_SELECT,
    })

    await this.writeAudit(tenantId, userId, 'CREATE', created.id)
    return created
  }

  /**
   * AC 10: house mutation shape — findOne for visibility, then updateMany
   * scoped { id, tenantId, deletedAt: null }, then re-read, then audit.
   * Editing a RUNNING entry's duration/startTime is rejected (stop it first);
   * when durationSeconds or startTime changes on a stopped entry, endTime is
   * recomputed.
   */
  async updateTimeEntry(
    tenantId: string,
    userId: string,
    id: string,
    input: UpdateTimeEntryInput,
  ): Promise<TimeEntryItem> {
    const current = await this.findOne(tenantId, userId, id)

    if (input.durationSeconds !== undefined) {
      this.validateDuration(input.durationSeconds)
    }

    if (
      current.endTime === null &&
      (input.durationSeconds !== undefined || input.startTime !== undefined)
    ) {
      throw new BadRequestException(
        'Cannot edit the duration of a running time entry. Stop the timer first.',
      )
    }

    const data: Prisma.TimeEntryUpdateManyMutationInput = { updatedBy: userId }

    let startTime = current.startTime
    if (input.startTime !== undefined) {
      startTime = this.parseStartTime(input.startTime)
      data.startTime = startTime
    }
    if (input.durationSeconds !== undefined) {
      data.durationSeconds = input.durationSeconds
    }
    if (input.durationSeconds !== undefined || input.startTime !== undefined) {
      const durationSeconds = input.durationSeconds ?? current.durationSeconds
      data.endTime = new Date(startTime.getTime() + durationSeconds * 1000)
    }
    if (input.description !== undefined) {
      data.description = input.description
    }

    const result = await this.prisma.timeEntry.updateMany({
      where: { id, tenantId, deletedAt: null },
      data,
    })

    if (result.count === 0) {
      throw new NotFoundException('Time entry not found')
    }

    const updated = await this.prisma.timeEntry.findFirst({
      where: { id, tenantId },
      select: TIME_ENTRY_SELECT,
    })

    await this.writeAudit(tenantId, userId, 'UPDATE', id)
    return updated!
  }

  /** AC 10: soft delete — deletedAt is set, never a hard delete. */
  async deleteTimeEntry(tenantId: string, userId: string, id: string): Promise<boolean> {
    await this.findOne(tenantId, userId, id)

    const result = await this.prisma.timeEntry.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { deletedAt: new Date(), updatedBy: userId },
    })

    if (result.count === 0) {
      throw new NotFoundException('Time entry not found')
    }

    await this.writeAudit(tenantId, userId, 'DELETE', id)
    return true
  }

  /** Visibility oracle — same role TasksService.findOne plays for tasks. */
  async findOne(tenantId: string, userId: string, id: string): Promise<TimeEntryItem> {
    const entry = await this.prisma.timeEntry.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: TIME_ENTRY_SELECT,
    })

    if (!entry) {
      throw new NotFoundException('Time entry not found')
    }

    // AC 11: visibility scopes on TimeEntry.userId — a time entry is a record
    // about a person, so OWN must mean MY hours, not "the task is visible".
    const visibilityFilter = await resolveVisibilityFilter(userId, tenantId)

    let hasAccess = true
    if (visibilityFilter !== undefined) {
      if (typeof visibilityFilter === 'string') {
        hasAccess = entry.userId === visibilityFilter
      } else {
        hasAccess = (visibilityFilter as { in: string[] }).in.includes(entry.userId)
      }
    }

    if (!hasAccess) {
      throw new NotFoundException('Time entry not found')
    }

    return entry
  }

  /**
   * Public for use by other internal aggregates instead of
   * re-deriving the scope — a second implementation of "which entries may I
   * see" is a guaranteed divergence (finding 3.7-F4 was exactly this class).
   * Unknown/empty filter values are ignored, never rejected.
   */
  async buildTimeEntryWhere(
    tenantId: string,
    userId: string,
    filter: TimeEntryFilterInput = {},
  ): Promise<Prisma.TimeEntryWhereInput> {
    const visibilityFilter = await resolveVisibilityFilter(userId, tenantId)

    const where: Prisma.TimeEntryWhereInput = {
      tenantId,
      deletedAt: null,
    }

    const andConditions: Prisma.TimeEntryWhereInput[] = []

    // resolveVisibilityFilter returns Prisma.ContactWhereInput['ownerId'] but
    // is resource-agnostic; cast at the call site exactly as TasksService
    // casts to TaskWhereInput['assignedTo'].
    if (visibilityFilter !== undefined) {
      andConditions.push({
        userId: visibilityFilter as Prisma.TimeEntryWhereInput['userId'],
      })
    }

    if (filter.taskId) {
      andConditions.push({ taskId: filter.taskId })
    }

    if (filter.userId) {
      andConditions.push({ userId: filter.userId })
    }

    if (filter.startFrom || filter.startTo) {
      const dateFilter: Prisma.DateTimeFilter = {}
      if (filter.startFrom) {
        dateFilter.gte = new Date(filter.startFrom)
      }
      if (filter.startTo) {
        // startTo is inclusive of the whole final day — the day is the UTC
        // day (all bucketing is UTC, AC 23; the timer widget's "Today" total
        // queries todayUtc()). setUTCHours, NOT setHours: setHours truncates
        // the bound by the server's UTC offset — on UTC+7 a startTo of
        // 2026-08-05 would cut at 16:59:59.999Z and drop the day's last 7
        // hours (T5 trap). Mirrors buildTaskWhere's intent without its bug.
        const endDate = new Date(filter.startTo)
        endDate.setUTCHours(23, 59, 59, 999)
        dateFilter.lte = endDate
      }
      andConditions.push({ startTime: dateFilter })
    }

    if (filter.runningOnly) {
      andConditions.push({ endTime: null })
    }

    if (andConditions.length > 0) {
      where.AND = andConditions
    }

    return where
  }

  /**
   * AC 13: house connection shape, page 1 / size 20, clamped at 100.
   * Ordering startTime desc + id desc — the tiebreaker keeps offset
   * pagination stable for entries created in a burst sharing a timestamp.
   */
  async findMany(
    tenantId: string,
    userId: string,
    filter: TimeEntryFilterInput = {},
    pagination: TimeEntryPaginationInput = {},
  ): Promise<TimeEntryConnection> {
    const page = Math.max(pagination.page ?? DEFAULT_PAGE, 1)
    const pageSize = Math.min(Math.max(pagination.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)

    const where = await this.buildTimeEntryWhere(tenantId, userId, filter)

    const [items, total] = await Promise.all([
      this.prisma.timeEntry.findMany({
        where,
        orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: TIME_ENTRY_SELECT,
      }),
      this.prisma.timeEntry.count({ where }),
    ])

    return {
      items: items as TimeEntryItem[],
      total,
      page,
      pageSize,
    }
  }

  /** AC 14: the caller's single running entry — drives the widget's
   * "a timer is already running elsewhere" state. */
  async findActive(tenantId: string, userId: string): Promise<TimeEntryItem | null> {
    return this.prisma.timeEntry.findFirst({
      where: { tenantId, userId, endTime: null, deletedAt: null },
      select: TIME_ENTRY_SELECT,
    })
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private validateDuration(durationSeconds: number): void {
    if (
      !Number.isInteger(durationSeconds) ||
      durationSeconds < MIN_MANUAL_DURATION_SECONDS ||
      durationSeconds > MAX_MANUAL_DURATION_SECONDS
    ) {
      throw new BadRequestException('durationSeconds must be an integer between 1 and 86400')
    }
  }

  private parseStartTime(value: string): Date {
    const parsed = new Date(value)
    if (isNaN(parsed.getTime())) {
      throw new BadRequestException('Invalid startTime')
    }
    return parsed
  }
}
