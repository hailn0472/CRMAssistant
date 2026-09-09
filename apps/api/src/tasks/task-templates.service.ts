import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import type { TaskPriority } from './task-due-status'
import { isTaskPriority } from './task-due-status'
import type { Prisma, TaskTemplate } from '@prisma/client'

export type CreateTaskTemplateInput = {
  name: string
  title: string
  description?: string | null
  defaultPriority?: string
  defaultDueInDays?: number | null
}

export type UpdateTaskTemplateInput = {
  name?: string
  title?: string
  description?: string | null
  defaultPriority?: string
  defaultDueInDays?: number | null
}

export type TaskTemplatePaginationInput = {
  page?: number
  pageSize?: number
}

export type TaskTemplateConnection = {
  items: TaskTemplate[]
  total: number
  page: number
  pageSize: number
}

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100
const MAX_NAME_LENGTH = 200
const MAX_TITLE_LENGTH = 200
const MAX_DESCRIPTION_LENGTH = 5000
const MAX_DUE_IN_DAYS = 365

function normalizeName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new BadRequestException('Task template name is required')
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new BadRequestException(
      `Task template name must be at most ${MAX_NAME_LENGTH} characters`,
    )
  }
  return trimmed
}

function normalizeTitle(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new BadRequestException('Task template title is required')
  }
  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new BadRequestException(
      `Task template title must be at most ${MAX_TITLE_LENGTH} characters`,
    )
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

function normalizeDefaultPriority(value: string | undefined): TaskPriority {
  if (value === undefined) return 'MEDIUM'
  if (!isTaskPriority(value)) {
    throw new BadRequestException('defaultPriority must be one of LOW, MEDIUM, HIGH, URGENT')
  }
  return value
}

function normalizeDefaultDueInDays(value: number | null | undefined): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isInteger(value) || value < 0 || value > MAX_DUE_IN_DAYS) {
    throw new BadRequestException('defaultDueInDays must be between 0 and 365')
  }
  return value
}

/**
 * Tenant-global task template catalogue (AC 37). Templates have no owner column,
 * so the read methods take no `userId` and
 * `resolveVisibilityFilter` is never called on them.
 */
@Injectable()
export class TaskTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Service-level audit write — see TasksService.writeAudit for why the
   * global AuditInterceptor never fires for GraphQL mutations in this repo.
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
      entity: 'TASK_TEMPLATE',
      entityId,
      details: { mutationName: action },
    })
  }

  async findMany(
    tenantId: string,
    pagination: TaskTemplatePaginationInput = {},
  ): Promise<TaskTemplateConnection> {
    const page = Math.max(pagination.page ?? DEFAULT_PAGE, 1)
    const pageSize = Math.min(Math.max(pagination.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)

    const where: Prisma.TaskTemplateWhereInput = { tenantId, deletedAt: null }

    const [items, total] = await Promise.all([
      this.prisma.taskTemplate.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.taskTemplate.count({ where }),
    ])

    return { items, total, page, pageSize }
  }

  async findOneForTenant(tenantId: string, id: string): Promise<TaskTemplate> {
    const template = await this.prisma.taskTemplate.findFirst({
      where: { id, tenantId, deletedAt: null },
    })
    if (!template) {
      throw new NotFoundException('Task template not found')
    }
    return template
  }

  async create(
    tenantId: string,
    userId: string,
    input: CreateTaskTemplateInput,
  ): Promise<TaskTemplate> {
    const name = normalizeName(input.name)
    const title = normalizeTitle(input.title)
    const description = normalizeDescription(input.description)
    const defaultPriority = normalizeDefaultPriority(input.defaultPriority)
    const defaultDueInDays = normalizeDefaultDueInDays(input.defaultDueInDays)

    // No @@unique([tenantId, name]) — soft delete + unique is a trap. Enforce
    // case-insensitive uniqueness over deletedAt: null rows (AC 14, 38).
    const existing = await this.prisma.taskTemplate.findFirst({
      where: { tenantId, name: { equals: name, mode: 'insensitive' }, deletedAt: null },
    })
    if (existing) {
      throw new ConflictException('Task template name already exists')
    }

    const template = await this.prisma.taskTemplate.create({
      data: {
        tenantId,
        name,
        title,
        description,
        defaultPriority,
        defaultDueInDays,
        createdBy: userId,
        updatedBy: userId,
      },
    })

    await this.writeAudit(tenantId, userId, 'CREATE', template.id)

    return template
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    input: UpdateTaskTemplateInput,
  ): Promise<TaskTemplate> {
    await this.findOneForTenant(tenantId, id)

    const data: Record<string, unknown> = { updatedBy: userId }

    if (input.name !== undefined) {
      const name = normalizeName(input.name)

      // Duplicate check excludes the row under edit (AC 38).
      const existing = await this.prisma.taskTemplate.findFirst({
        where: {
          tenantId,
          name: { equals: name, mode: 'insensitive' },
          deletedAt: null,
          id: { not: id },
        },
      })
      if (existing) {
        throw new ConflictException('Task template name already exists')
      }

      data.name = name
    }

    if (input.title !== undefined) {
      data.title = normalizeTitle(input.title)
    }

    if (input.description !== undefined) {
      data.description = normalizeDescription(input.description)
    }

    if (input.defaultPriority !== undefined) {
      data.defaultPriority = normalizeDefaultPriority(input.defaultPriority)
    }

    if (input.defaultDueInDays !== undefined) {
      data.defaultDueInDays = normalizeDefaultDueInDays(input.defaultDueInDays)
    }

    const result = await this.prisma.taskTemplate.updateMany({
      where: { id, tenantId, deletedAt: null },
      data,
    })

    if (result.count === 0) {
      throw new NotFoundException('Task template not found')
    }

    const template = await this.findOneForTenant(tenantId, id)

    await this.writeAudit(tenantId, userId, 'UPDATE', template.id)

    return template
  }

  async delete(tenantId: string, userId: string, id: string): Promise<boolean> {
    await this.findOneForTenant(tenantId, id)

    const result = await this.prisma.taskTemplate.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { deletedAt: new Date(), updatedBy: userId },
    })

    if (result.count === 0) {
      throw new NotFoundException('Task template not found')
    }

    await this.writeAudit(tenantId, userId, 'DELETE', id)

    return true
  }
}
