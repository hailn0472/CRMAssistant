import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { ActivityService } from '../activities/activities.service'
import { ActivityLogPreferenceService } from '../activities/activity-log-preference.service'
import { resolveVisibilityFilter } from '../common/guards/visibility-check'
import { ContactsService } from '../contacts/contacts.service'
import { DealsService } from '../deals/deals.service'
import { TaskTemplatesService } from './task-templates.service'
import { TaskPubSubService, PUBSUB_TASK_ASSIGNED, PUBSUB_TASK_CHANGED } from './task-pubsub.service'
import { CalendarSyncService } from '../calendar/calendar-sync.service'
import type { CalendarTaskInput } from '../calendar/calendar-sync.service'
import { isTaskPriority, isTaskStatus, toUtcMidnight } from './task-due-status'
import type { TaskPriority, TaskStatus } from './task-due-status'
import type { Prisma } from '@prisma/client'

export type CreateTaskInput = {
  title: string
  description?: string | null
  status?: string
  priority?: string
  dueDate?: string | null
  assignedTo?: string
  contactId?: string
  dealId?: string
  // Story 4.6: recurrence fields (AC 41-43)
  isRecurring?: boolean
  recurrencePattern?: string
  recurrenceEndDate?: string | null
}

export type UpdateTaskInput = {
  title?: string | null
  description?: string | null
  status?: string
  priority?: string
  dueDate?: string | null
  assignedTo?: string
  contactId?: string | null
  dealId?: string | null
  // Story 4.6: recurrence fields (AC 41-43)
  isRecurring?: boolean
  recurrencePattern?: string | null
  recurrenceEndDate?: string | null
}

export type TaskFilterInput = {
  search?: string
  status?: string
  priority?: string
  assignedTo?: string
  contactId?: string
  dealId?: string
  dueDateFrom?: string
  dueDateTo?: string
  overdueOnly?: boolean
}

export type TaskPaginationInput = {
  page?: number
  pageSize?: number
}

export type TaskConnection = {
  items: TaskListItem[]
  total: number
  page: number
  pageSize: number
}

export type CreateTaskFromTemplateOverrides = {
  assignedTo?: string
  contactId?: string
  dealId?: string
  dueDate?: string
  title?: string
}

export type TaskStats = {
  openTasks: number
  dueToday: number
  overdue: number
  completedThisWeek: number
}

// Story 4.4 (AC 12): explicit sort vocabulary — a plain const tuple is the
// single source for the Pothos enum and the service-side orderBy mapping. A
// client-supplied free-text column name would be an injection surface, so the
// enum value is the ONLY thing that can reach `orderBy`.
export const TASK_SORT_FIELDS = ['DUE_DATE', 'PRIORITY', 'CREATED_AT', 'TITLE'] as const
export type TaskSortField = (typeof TASK_SORT_FIELDS)[number]
export type TaskSortDirection = 'ASC' | 'DESC'

export type TaskSortInput = {
  field: TaskSortField
  direction: TaskSortDirection
}

const OPEN_STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS']
const MS_PER_DAY = 24 * 60 * 60 * 1000

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100
const MAX_TITLE_LENGTH = 200
const MAX_DESCRIPTION_LENGTH = 5000

// The select must cover EVERY field the Pothos Task ref exposes (including the
// three nested refs) or the resolver crashes at query time — Story 3.4
// Critical, re-flagged on 3.5, 3.6 and 3.7. Walk it against tasks.graphql.ts
// before opening the PR.
// Story 4.6 (AC 44): +4 fields for recurrence — MUST stay in sync with
// TaskGraphqlShape in tasks.graphql.ts.
const taskListSelect = {
  id: true,
  tenantId: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueDate: true,
  assignedTo: true,
  contactId: true,
  dealId: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  isRecurring: true,
  recurrencePattern: true,
  recurrenceEndDate: true,
  parentTaskId: true,
  assignee: {
    select: { id: true, firstName: true, lastName: true, email: true, avatar: true },
  },
  contact: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  deal: {
    select: { id: true, title: true },
  },
} as const

export type TaskListItem = Prisma.TaskGetPayload<{ select: typeof taskListSelect }>

function normalizeTitle(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new BadRequestException('Title is required')
  }
  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new BadRequestException(`Title must be at most ${MAX_TITLE_LENGTH} characters`)
  }
  return trimmed
}

function normalizeDescription(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
    throw new BadRequestException(
      `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters`,
    )
  }
  return trimmed || null
}

function normalizeStatus(value: string | undefined, fallback: TaskStatus): TaskStatus {
  if (value === undefined) return fallback
  if (!isTaskStatus(value)) {
    throw new BadRequestException('status must be one of TODO, IN_PROGRESS, COMPLETED, CANCELLED')
  }
  return value
}

function normalizePriority(value: string | undefined, fallback: TaskPriority): TaskPriority {
  if (value === undefined) return fallback
  if (!isTaskPriority(value)) {
    throw new BadRequestException('priority must be one of LOW, MEDIUM, HIGH, URGENT')
  }
  return value
}

// Story 4.6 (AC 37): recurrence pattern normalizer
function normalizeRecurrencePattern(
  value: string | undefined,
): 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | null {
  if (value === undefined || value === null) return null
  const valid = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']
  if (!valid.includes(value)) {
    throw new BadRequestException('recurrencePattern must be one of DAILY, WEEKLY, MONTHLY, YEARLY')
  }
  return value as 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
}

// Story 4.6: recurrence end date normalizer
function normalizeRecurrenceEndDate(value: string | null | undefined): Date | null {
  if (value === undefined || value === null) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('recurrenceEndDate is not a valid date')
  }
  return toUtcMidnight(parsed)
}

function normalizeDueDate(value: string | null | undefined): Date | null {
  if (value === undefined || value === null) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('dueDate is not a valid date')
  }
  // dueDate is date-only semantics (AC 5) — normalise to UTC midnight.
  return toUtcMidnight(parsed)
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

/**
 * Story 4.4 (AC 12): exhaustive enum → Prisma orderBy mapping. Never passes a
 * client string through to orderBy; the default ordering is preserved
 * byte-for-byte when `sort` is omitted so every existing caller is unaffected.
 */
function buildTaskOrderBy(sort: TaskSortInput | undefined): Prisma.TaskOrderByWithRelationInput[] {
  if (!sort) {
    return [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }]
  }
  const direction: 'asc' | 'desc' = sort.direction === 'ASC' ? 'asc' : 'desc'
  switch (sort.field) {
    case 'DUE_DATE':
      return [{ dueDate: { sort: direction, nulls: 'last' } }, { createdAt: 'desc' }]
    case 'PRIORITY':
      return [{ priority: direction }, { createdAt: 'desc' }]
    case 'CREATED_AT':
      return [{ createdAt: direction }]
    case 'TITLE':
      return [{ title: direction }]
    default:
      // Unreachable for a typed enum value; a garbage value must never reach
      // Prisma's orderBy (AC 12).
      throw new BadRequestException(
        'sort.field must be one of DUE_DATE, PRIORITY, CREATED_AT, TITLE',
      )
  }
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly deals: DealsService,
    private readonly taskTemplates: TaskTemplatesService,
    private readonly taskPubSub: TaskPubSubService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly activityLogPreference: ActivityLogPreferenceService,
    private readonly calendarSync: CalendarSyncService,
  ) {}

  /**
   * Service-level audit write. The global AuditInterceptor (registered via
   * APP_INTERCEPTOR) does NOT wrap GraphQL resolvers in this repo — the
   * hand-built Pothos schema (builder.toSchema() → GraphQLModule.forRoot)
   * bypasses the NestJS resolver map, so intercept() never fires for
   * mutations (verified on the dev stack; NFR9 audit rows for createTask
   * etc. were missing). Writing here, synchronously inside the mutation,
   * is the only path that actually produces AuditLog rows.
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
      entity: 'TASK',
      entityId,
      details: { mutationName: action },
    })
  }

  /**
   * Story 4.3: best-effort calendar push hook (AC 23). `syncTaskSafe` itself
   * swallows its failures (mirroring ActivityService.logSafe); this guard is
   * belt and braces so that even a misbehaving sync engine can never fail the
   * task mutation. Called AFTER the audit write and outside any $transaction.
   */
  private async syncCalendarSafe(task: CalendarTaskInput): Promise<void> {
    try {
      await this.calendarSync.syncTaskSafe(task)
    } catch {
      // Swallowed — the mutation must succeed (AC 23).
    }
  }

  /** Story 4.3: best-effort remote removal + link cleanup (AC 23). */
  private async removeCalendarSafe(task: CalendarTaskInput): Promise<void> {
    try {
      await this.calendarSync.removeTaskFromCalendarSafe(task)
    } catch {
      // Swallowed — the mutation must succeed (AC 23).
    }
  }

  /**
   * Story 4.4 (AC 19): best-effort onTaskChanged publish on the tenant-wide
   * channel. Publishing must never fail a mutation — same discipline as
   * syncCalendarSafe / logSafe.
   */
  private publishTaskChanged(tenantId: string, payload: unknown): void {
    try {
      this.taskPubSub.publish(`${PUBSUB_TASK_CHANGED}:${tenantId}`, payload)
    } catch {
      // Swallowed — the mutation must succeed (AC 19).
    }
  }

  async create(tenantId: string, userId: string, input: CreateTaskInput): Promise<TaskListItem> {
    const title = normalizeTitle(input.title)
    const description = normalizeDescription(input.description)
    const status = normalizeStatus(input.status, 'TODO')
    const priority = normalizePriority(input.priority, 'MEDIUM')
    const dueDate = normalizeDueDate(input.dueDate)
    const assignedTo = input.assignedTo ?? userId

    // Validate the assignee when assigning to someone other than the caller (AC 32).
    if (input.assignedTo && input.assignedTo !== userId) {
      const assignee = await this.prisma.user.findFirst({
        where: { id: input.assignedTo, tenantId, deletedAt: null, isActive: true },
      })
      if (!assignee) {
        throw new BadRequestException('Assignee not found in this tenant')
      }
    }

    // Related-record access is verified through the owning service — both
    // already enforce tenant scope, soft delete and visibility (AC 31).
    if (input.contactId) {
      await this.contacts.findOne(tenantId, userId, input.contactId)
    }
    if (input.dealId) {
      await this.deals.findOne(tenantId, userId, input.dealId)
    }

    // Story 4.6: recurrence fields (AC 41-43) — pass through to prisma
    const isRecurring = input.isRecurring ?? false
    const recurrencePattern = isRecurring
      ? normalizeRecurrencePattern(input.recurrencePattern)
      : null
    const recurrenceEndDate = isRecurring
      ? normalizeRecurrenceEndDate(input.recurrenceEndDate)
      : null

    const task = await this.prisma.task.create({
      data: {
        tenantId,
        title,
        description,
        status,
        priority,
        dueDate,
        assignedTo,
        contactId: input.contactId ?? null,
        dealId: input.dealId ?? null,
        createdBy: userId,
        updatedBy: userId,
        isRecurring,
        recurrencePattern,
        recurrenceEndDate,
      },
      select: taskListSelect,
    })

    const createdTask = await this.findOne(tenantId, userId, task.id)

    if (assignedTo !== userId) {
      this.taskPubSub.publish(`${PUBSUB_TASK_ASSIGNED}:${tenantId}:${assignedTo}`, createdTask)
    }

    await this.writeAudit(tenantId, userId, 'CREATE', createdTask.id)

    // Story 4.3: best-effort calendar push (AC 22-23) — after the audit
    // write, outside any $transaction, and never failing the mutation
    // (syncTaskSafe swallows its own failures). A task without a dueDate is
    // not eligible (AC 22).
    if (createdTask.dueDate) {
      await this.syncCalendarSafe(createdTask)
    }

    // Story 4.4 (AC 14): tenant-wide change notification, after every other
    // side effect, never failing the mutation.
    this.publishTaskChanged(tenantId, createdTask)

    return createdTask
  }

  async findOne(tenantId: string, userId: string, id: string): Promise<TaskListItem> {
    const task = await this.prisma.task.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: taskListSelect,
    })

    if (!task) {
      throw new NotFoundException('Task not found')
    }

    // Apply data visibility filter — assignedTo is the visibility column.
    const visibilityFilter = await resolveVisibilityFilter(userId, tenantId)

    let hasAccess = true
    if (visibilityFilter !== undefined) {
      if (typeof visibilityFilter === 'string') {
        hasAccess = task.assignedTo === visibilityFilter
      } else {
        const allowedIds = (visibilityFilter as { in: string[] }).in
        hasAccess = allowedIds.includes(task.assignedTo)
      }
    }

    if (!hasAccess) {
      throw new NotFoundException('Task not found')
    }

    return task
  }

  /// Aggregate counters for the tasks workspace summary cards. Scoped with
  /// the same visibility rules as findMany so the totals always match what
  /// the user can actually list. Day-boundary math mirrors resolveDueStatus
  /// (toUtcMidnight) so "due today"/"overdue" never disagree with the badges
  /// rendered per-row in the table.
  async getStats(tenantId: string, userId: string, now: Date = new Date()): Promise<TaskStats> {
    const visibilityFilter = await resolveVisibilityFilter(userId, tenantId)

    const scope: Prisma.TaskWhereInput = { tenantId, deletedAt: null }
    if (visibilityFilter !== undefined) {
      scope.assignedTo = visibilityFilter as Prisma.TaskWhereInput['assignedTo']
    }

    const todayStart = toUtcMidnight(now)
    const todayEnd = new Date(todayStart.getTime() + MS_PER_DAY)
    const sevenDaysAgo = new Date(now.getTime() - 7 * MS_PER_DAY)

    const [openTasks, dueToday, overdue, completedThisWeek] = await Promise.all([
      this.prisma.task.count({ where: { ...scope, status: { in: OPEN_STATUSES } } }),
      this.prisma.task.count({
        where: {
          ...scope,
          status: { in: OPEN_STATUSES },
          dueDate: { gte: todayStart, lt: todayEnd },
        },
      }),
      this.prisma.task.count({
        where: { ...scope, status: { in: OPEN_STATUSES }, dueDate: { lt: todayStart } },
      }),
      this.prisma.task.count({
        where: { ...scope, status: 'COMPLETED', completedAt: { gte: sevenDaysAgo } },
      }),
    ])

    return { openTasks, dueToday, overdue, completedThisWeek }
  }

  async findMany(
    tenantId: string,
    userId: string,
    filter: TaskFilterInput = {},
    pagination: TaskPaginationInput = {},
    sort?: TaskSortInput,
    now: Date = new Date(),
  ): Promise<TaskConnection> {
    const page = Math.max(pagination.page ?? DEFAULT_PAGE, 1)
    const pageSize = Math.min(Math.max(pagination.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)

    const where = await this.buildTaskWhere(tenantId, userId, filter, now)

    const [items, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        orderBy: buildTaskOrderBy(sort),
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: taskListSelect,
      }),
      this.prisma.task.count({ where }),
    ])

    return {
      items: items as TaskListItem[],
      total,
      page,
      pageSize,
    }
  }

  async buildTaskWhere(
    tenantId: string,
    userId: string,
    filter: TaskFilterInput = {},
    now: Date = new Date(),
  ): Promise<Prisma.TaskWhereInput> {
    const search = filter.search?.trim()

    const visibilityFilter = await resolveVisibilityFilter(userId, tenantId)

    const where: Prisma.TaskWhereInput = {
      tenantId,
      deletedAt: null,
    }

    const andConditions: Prisma.TaskWhereInput[] = []

    // Apply visibility filter — resolveVisibilityFilter returns
    // Prisma.ContactWhereInput['ownerId'] but is resource-agnostic; cast at the
    // call site exactly as deals.service.ts casts to DealWhereInput['ownerId'].
    if (visibilityFilter !== undefined) {
      andConditions.push({
        assignedTo: visibilityFilter as Prisma.TaskWhereInput['assignedTo'],
      })
    }

    if (search) {
      andConditions.push({
        title: { contains: search, mode: 'insensitive' },
      })
    }

    if (filter.status) {
      andConditions.push({ status: filter.status as TaskStatus })
    }

    if (filter.priority) {
      andConditions.push({ priority: filter.priority as TaskPriority })
    }

    if (filter.assignedTo) {
      andConditions.push({ assignedTo: filter.assignedTo })
    }

    if (filter.contactId) {
      andConditions.push({ contactId: filter.contactId })
    }

    if (filter.dealId) {
      andConditions.push({ dealId: filter.dealId })
    }

    if (filter.dueDateFrom || filter.dueDateTo) {
      const dateFilter: Prisma.DateTimeFilter = {}
      if (filter.dueDateFrom) {
        dateFilter.gte = new Date(filter.dueDateFrom)
      }
      if (filter.dueDateTo) {
        const endDate = new Date(filter.dueDateTo)
        endDate.setHours(23, 59, 59, 999)
        dateFilter.lte = endDate
      }
      andConditions.push({ dueDate: dateFilter })
    }

    if (filter.overdueOnly) {
      andConditions.push({
        dueDate: { lt: toUtcMidnight(now) },
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      })
    }

    if (andConditions.length > 0) {
      where.AND = andConditions
    }

    return where
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    input: UpdateTaskInput,
    now: Date = new Date(),
  ): Promise<TaskListItem> {
    // Verify task exists and is visible
    const currentTask = await this.findOne(tenantId, userId, id)

    if (input.title !== undefined && input.title !== null) {
      normalizeTitle(input.title)
    }

    const data: Record<string, unknown> = { updatedBy: userId }

    if (input.title !== undefined) {
      if (input.title === null) {
        throw new BadRequestException('title cannot be cleared')
      }
      data.title = normalizeTitle(input.title)
    }

    if (input.description !== undefined) {
      data.description = normalizeDescription(input.description)
    }

    if (input.status !== undefined) {
      const status = normalizeStatus(input.status, 'TODO')
      data.status = status
      // A reopened task must not keep its completion timestamp (AC 34).
      if (status !== 'COMPLETED' && currentTask.status === 'COMPLETED') {
        data.completedAt = null
      }
      // ...and the mirror case: updateTask is a second, independent completion
      // path alongside completeTask. Without this, a task completed via
      // updateTask(status: COMPLETED) is COMPLETED with completedAt = null,
      // which breaks every "when was this done" read (reports, timeline).
      if (status === 'COMPLETED' && currentTask.status !== 'COMPLETED') {
        data.completedAt = now
      }
    }

    if (input.priority !== undefined) {
      data.priority = normalizePriority(input.priority, 'MEDIUM')
    }

    if (input.dueDate !== undefined) {
      data.dueDate = normalizeDueDate(input.dueDate)
    }

    if (input.assignedTo !== undefined) {
      data.assignedTo = input.assignedTo
    }

    if (input.contactId !== undefined) {
      if (input.contactId !== null) {
        await this.contacts.findOne(tenantId, userId, input.contactId)
      }
      data.contactId = input.contactId
    }

    if (input.dealId !== undefined) {
      if (input.dealId !== null) {
        await this.deals.findOne(tenantId, userId, input.dealId)
      }
      data.dealId = input.dealId
    }

    // Story 4.6 (AC 37): recurrence fields — reject setting isRecurring on an occurrence
    if (
      input.isRecurring !== undefined ||
      input.recurrencePattern !== undefined ||
      input.recurrenceEndDate !== undefined
    ) {
      if (currentTask.parentTaskId !== null) {
        throw new BadRequestException('A recurring occurrence cannot itself recur')
      }
      if (input.isRecurring !== undefined) {
        data.isRecurring = input.isRecurring
      }
      if (input.recurrencePattern !== undefined) {
        data.recurrencePattern = normalizeRecurrencePattern(input.recurrencePattern ?? undefined)
      }
      if (input.recurrenceEndDate !== undefined) {
        data.recurrenceEndDate = normalizeRecurrenceEndDate(input.recurrenceEndDate)
      }
    }

    // Story 4.6 (AC 21-22): block completion via updateTask when open
    // dependencies exist. Only fires on status transition TO COMPLETED.
    if (input.status === 'COMPLETED' && currentTask.status !== 'COMPLETED') {
      await this.assertDependenciesResolved(tenantId, userId, id)
    }

    const result = await this.prisma.task.updateMany({
      where: { id, tenantId, deletedAt: null },
      data,
    })

    if (result.count === 0) {
      throw new NotFoundException('Task not found')
    }

    const updatedTask = await this.findOne(tenantId, userId, id)

    // Publish when the update reassigns the task to a different user.
    if (input.assignedTo !== undefined && input.assignedTo !== currentTask.assignedTo) {
      this.taskPubSub.publish(
        `${PUBSUB_TASK_ASSIGNED}:${tenantId}:${input.assignedTo}`,
        updatedTask,
      )
    }

    await this.writeAudit(tenantId, userId, 'UPDATE', updatedTask.id)

    // Story 4.2: updateTask(status: COMPLETED) is a second, independent
    // completion path that bypasses complete()'s idempotency guard (AC 20) —
    // log TASK_COMPLETED here, guarded so the two paths cannot double-fire.
    if (currentTask.status !== 'COMPLETED' && input.status === 'COMPLETED') {
      await this.logTaskCompleted(tenantId, userId, updatedTask)
    }

    // Story 4.3: calendar hooks (AC 22-23) — after the audit write, outside
    // any $transaction, never failing the mutation. Delete the remote event
    // when dueDate became null or the status became COMPLETED/CANCELLED;
    // push when title/description/dueDate changed.
    const dueDateChanged =
      (updatedTask.dueDate ?? null)?.getTime() !== (currentTask.dueDate ?? null)?.getTime()
    const dueDateCleared = currentTask.dueDate !== null && updatedTask.dueDate === null
    const becameClosed = updatedTask.status === 'COMPLETED' || updatedTask.status === 'CANCELLED'
    if (becameClosed || dueDateCleared) {
      await this.removeCalendarSafe(updatedTask)
    } else if (
      dueDateChanged ||
      updatedTask.title !== currentTask.title ||
      updatedTask.description !== currentTask.description
    ) {
      if (updatedTask.dueDate) {
        await this.syncCalendarSafe(updatedTask)
      }
    }

    // Story 4.4 (AC 14): tenant-wide change notification, after every other
    // side effect, never failing the mutation.
    this.publishTaskChanged(tenantId, updatedTask)

    return updatedTask
  }

  async assign(
    tenantId: string,
    userId: string,
    id: string,
    assigneeId: string,
  ): Promise<TaskListItem> {
    // Verify task exists and is visible
    const currentTask = await this.findOne(tenantId, userId, id)

    // Verify the assignee is an active, non-deleted user in the same tenant.
    const assignee = await this.prisma.user.findFirst({
      where: { id: assigneeId, tenantId, deletedAt: null, isActive: true },
    })
    if (!assignee) {
      throw new BadRequestException('Assignee not found in this tenant')
    }

    const result = await this.prisma.task.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { assignedTo: assigneeId, updatedBy: userId },
    })

    if (result.count === 0) {
      throw new NotFoundException('Task not found')
    }

    const updatedTask = await this.findOne(tenantId, userId, id)

    if (assigneeId !== currentTask.assignedTo) {
      this.taskPubSub.publish(`${PUBSUB_TASK_ASSIGNED}:${tenantId}:${assigneeId}`, updatedTask)
    }

    await this.writeAudit(tenantId, userId, 'UPDATE', updatedTask.id)

    // Story 4.3: calendar hooks (AC 23) — delete from the previous assignee's
    // calendar, create on the new assignee's. Best-effort, after the audit
    // write, outside any $transaction.
    if (assigneeId !== currentTask.assignedTo) {
      await this.removeCalendarSafe(currentTask)
      if (updatedTask.dueDate) {
        await this.syncCalendarSafe(updatedTask)
      }
    }

    // Story 4.4 (AC 14): tenant-wide change notification, after every other
    // side effect, never failing the mutation.
    this.publishTaskChanged(tenantId, updatedTask)

    return updatedTask
  }

  /**
   * Story 4.6 (AC 21): blocking validation helper. Checks that all open
   * dependencies of the given task are resolved before allowing completion.
   * Called from both `complete()` and `update()` — the two independent
   * completion paths (AC 22).
   *
   * No new constructor dependency — direct prisma query, matching the
   * existing pattern for task-level checks (Trap T8 avoidance).
   */
  private async assertDependenciesResolved(
    tenantId: string,
    userId: string,
    taskId: string,
  ): Promise<void> {
    const openDependencies = await this.prisma.taskDependency.findMany({
      where: {
        tenantId,
        taskId,
        dependsOnTask: {
          deletedAt: null,
          status: { in: OPEN_STATUSES },
        },
      },
      select: {
        dependsOnTask: {
          select: { id: true, title: true, assignedTo: true },
        },
      },
    })

    if (openDependencies.length === 0) return

    // AC 23: visibility filter to only name blockers the caller can see
    const visibilityFilter = await resolveVisibilityFilter(userId, tenantId)

    const visibleBlockers: string[] = []
    let hiddenCount = 0

    for (const dep of openDependencies) {
      const blocker = dep.dependsOnTask
      let canSee = true
      if (visibilityFilter !== undefined) {
        if (typeof visibilityFilter === 'string') {
          canSee = blocker.assignedTo === visibilityFilter
        } else {
          canSee = (visibilityFilter as { in: string[] }).in.includes(blocker.assignedTo)
        }
      }
      if (canSee && visibleBlockers.length < 3) {
        visibleBlockers.push(`"${blocker.title}"`)
      } else if (!canSee) {
        hiddenCount++
      }
    }

    const parts = [...visibleBlockers]
    if (hiddenCount > 0) {
      parts.push(`${hiddenCount} more`)
    }

    throw new ConflictException(`Cannot complete: blocked by ${parts.join(', ')}`)
  }

  async complete(
    tenantId: string,
    userId: string,
    id: string,
    now: Date = new Date(),
  ): Promise<TaskListItem> {
    // Verify task exists and is visible
    const currentTask = await this.findOne(tenantId, userId, id)

    // Idempotent: completing an already-completed task returns it unchanged
    // without a second completedAt stamp (AC 33).
    if (currentTask.status === 'COMPLETED') {
      return currentTask
    }

    // Story 4.6 (AC 21-22): block completion when open dependencies exist.
    // Placed AFTER the idempotent short-circuit so re-completing an
    // already-completed task remains idempotent even if it has since
    // acquired blockers.
    await this.assertDependenciesResolved(tenantId, userId, id)

    const result = await this.prisma.task.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { status: 'COMPLETED', completedAt: now, updatedBy: userId },
    })

    if (result.count === 0) {
      throw new NotFoundException('Task not found')
    }

    const updatedTask = await this.findOne(tenantId, userId, id)

    await this.writeAudit(tenantId, userId, 'UPDATE', updatedTask.id)

    // Story 4.3: delete the remote event and the link row (AC 23). Best-effort.
    await this.removeCalendarSafe(updatedTask)

    // Story 4.2: auto-log the completion (AC 19). Uses logSafe — a logging
    // failure never fails the task mutation.
    await this.logTaskCompleted(tenantId, userId, updatedTask)

    // Story 4.4 (AC 14): tenant-wide change notification, after every other
    // side effect, never failing the mutation.
    this.publishTaskChanged(tenantId, updatedTask)

    return updatedTask
  }

  /**
   * Auto-log TASK_COMPLETED (AC 19-22). Contact resolution, in order:
   * Task.contactId → Task.dealId → Deal.contactId → skip silently, log
   * nothing (AC 21 — a task attached to neither has nowhere to log and the
   * task mutation must still succeed). Suppressed when the acting user's
   * `logTaskCompleted` preference is off (AC 22).
   */
  private async logTaskCompleted(
    tenantId: string,
    userId: string,
    task: TaskListItem,
  ): Promise<void> {
    if (!(await this.activityLogPreference.isEnabled(tenantId, userId, 'logTaskCompleted'))) {
      return
    }

    let contactId = task.contactId
    if (!contactId && task.dealId) {
      try {
        const deal = await this.deals.findOne(tenantId, userId, task.dealId)
        contactId = deal?.contactId ?? null
      } catch {
        // Deal gone or no longer visible — nothing to log; the task mutation
        // must still succeed (AC 21).
        return
      }
    }

    if (!contactId) {
      // Task attached to neither a contact nor a deal has nowhere to log.
      return
    }

    await this.activity.logSafe({
      tenantId,
      contactId,
      type: 'TASK_COMPLETED',
      title: `Task completed: ${task.title}`,
      metadata: {
        taskId: task.id,
        priority: task.priority,
        dueDate: task.dueDate ? task.dueDate.toISOString() : null,
        assignedTo: task.assignedTo,
      },
      source: 'TASK',
      sourceId: task.id,
      dedupeKey: `TASK_COMPLETED:${task.id}`,
      createdBy: userId,
    })
  }

  async delete(tenantId: string, userId: string, id: string): Promise<boolean> {
    // Verify task exists and is visible
    const currentTask = await this.findOne(tenantId, userId, id)

    const result = await this.prisma.task.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { deletedAt: new Date(), updatedBy: userId },
    })

    if (result.count === 0) {
      throw new NotFoundException('Task not found')
    }

    await this.writeAudit(tenantId, userId, 'DELETE', id)

    // Story 4.3: delete the remote event and the link row (AC 23). Best-effort.
    await this.removeCalendarSafe(currentTask)

    // Story 4.4 (AC 14): the delete payload is the pre-delete row — the client
    // only needs the id to invalidate.
    this.publishTaskChanged(tenantId, currentTask)

    return true
  }

  async createFromTemplate(
    tenantId: string,
    userId: string,
    templateId: string,
    overrides: CreateTaskFromTemplateOverrides = {},
    now: Date = new Date(),
  ): Promise<TaskListItem> {
    const template = await this.taskTemplates.findOneForTenant(tenantId, templateId)

    const dueDate =
      template.defaultDueInDays === null
        ? null
        : toUtcMidnight(addDays(now, template.defaultDueInDays))

    return this.create(tenantId, userId, {
      title: overrides.title ?? template.title,
      description: template.description ?? null,
      priority: template.defaultPriority,
      dueDate: overrides.dueDate ?? (dueDate ? dueDate.toISOString() : null),
      assignedTo: overrides.assignedTo,
      contactId: overrides.contactId,
      dealId: overrides.dealId,
    })
  }
}
