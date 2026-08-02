import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { resolveVisibilityFilter } from '../common/guards/visibility-check'
import { ContactsService } from '../contacts/contacts.service'
import { DealsService } from '../deals/deals.service'
import { TaskTemplatesService } from './task-templates.service'
import { TaskPubSubService, PUBSUB_TASK_ASSIGNED } from './task-pubsub.service'
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

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100
const MAX_TITLE_LENGTH = 200
const MAX_DESCRIPTION_LENGTH = 5000

// The select must cover EVERY field the Pothos Task ref exposes (including the
// three nested refs) or the resolver crashes at query time — Story 3.4
// Critical, re-flagged on 3.5, 3.6 and 3.7. Walk it against tasks.graphql.ts
// before opening the PR.
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

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly deals: DealsService,
    private readonly taskTemplates: TaskTemplatesService,
    private readonly taskPubSub: TaskPubSubService,
    private readonly audit: AuditService,
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
      },
      select: taskListSelect,
    })

    const createdTask = await this.findOne(tenantId, userId, task.id)

    if (assignedTo !== userId) {
      this.taskPubSub.publish(`${PUBSUB_TASK_ASSIGNED}:${tenantId}:${assignedTo}`, createdTask)
    }

    await this.writeAudit(tenantId, userId, 'CREATE', createdTask.id)

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

  async findMany(
    tenantId: string,
    userId: string,
    filter: TaskFilterInput = {},
    pagination: TaskPaginationInput = {},
    now: Date = new Date(),
  ): Promise<TaskConnection> {
    const page = Math.max(pagination.page ?? DEFAULT_PAGE, 1)
    const pageSize = Math.min(Math.max(pagination.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)

    const where = await this.buildTaskWhere(tenantId, userId, filter, now)

    const [items, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
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

    return updatedTask
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

    const result = await this.prisma.task.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { status: 'COMPLETED', completedAt: now, updatedBy: userId },
    })

    if (result.count === 0) {
      throw new NotFoundException('Task not found')
    }

    const updatedTask = await this.findOne(tenantId, userId, id)

    await this.writeAudit(tenantId, userId, 'UPDATE', updatedTask.id)

    return updatedTask
  }

  async delete(tenantId: string, userId: string, id: string): Promise<boolean> {
    // Verify task exists and is visible
    await this.findOne(tenantId, userId, id)

    const result = await this.prisma.task.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { deletedAt: new Date(), updatedBy: userId },
    })

    if (result.count === 0) {
      throw new NotFoundException('Task not found')
    }

    await this.writeAudit(tenantId, userId, 'DELETE', id)

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
