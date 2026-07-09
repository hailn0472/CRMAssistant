import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

export type AuditAction =
  | 'ROLE_CREATED'
  | 'ROLE_UPDATED'
  | 'ROLE_DELETED'
  | 'ROLE_ASSIGNED'
  | 'ROLE_REMOVED'
  | 'PERMISSION_ASSIGNED'
  | 'PERMISSION_REMOVED'
  | 'ROLE_PERMISSIONS_SET'
  | 'TEAM_CREATED'
  | 'TEAM_UPDATED'
  | 'TEAM_DELETED'
  | 'TEAM_MEMBERS_SET'
  | 'VISIBILITY_FILTER_APPLIED'
  | 'TWO_FACTOR_ENABLED'
  | 'TWO_FACTOR_DISABLED'
  | 'TWO_FACTOR_BACKUP_CODES_REGENERATED'
  | 'TENANT_SETTINGS_UPDATED'
  | 'SHARE_CREATED'
  | 'SHARE_UPDATED'
  | 'SHARE_REVOKED'
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'PERMISSION_CHANGE'
  | 'API_KEY_CREATED'
  | 'API_KEY_REVOKED'
  | 'API_KEY_ROTATED'

export type AuditLogFilter = {
  userId?: string
  action?: string
  entity?: string
  dateFrom?: string
  dateTo?: string
}

export type PaginationInput = {
  page?: number
  pageSize?: number
}

export type AuditLogListResult = {
  items: Array<{
    id: string
    tenantId: string
    userId: string
    action: string
    entity: string
    entityId: string
    details: Record<string, unknown> | null
    ipAddress: string | null
    userAgent: string | null
    createdAt: Date
  }>
  total: number
  page: number
  pageSize: number
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: {
    tenantId: string
    userId: string
    action: AuditAction
    entity: string
    entityId: string
    details?: Record<string, unknown>
    ipAddress?: string | null
    userAgent?: string | null
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        details: input.details ? (input.details as Prisma.InputJsonValue) : undefined,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    })
  }

  async list(
    tenantId: string,
    filter: AuditLogFilter,
    pagination: PaginationInput,
  ): Promise<AuditLogListResult> {
    const page = Math.max(1, pagination.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, pagination.pageSize ?? 20))
    const skip = Math.min((page - 1) * pageSize, 10000) // cap max skip to prevent deep-scan abuse

    const where: Prisma.AuditLogWhereInput = { tenantId }

    if (filter.userId) where.userId = filter.userId
    if (filter.action) where.action = filter.action
    if (filter.entity) where.entity = filter.entity
    if (filter.dateFrom || filter.dateTo) {
      where.createdAt = {}
      if (filter.dateFrom) {
        const d = new Date(filter.dateFrom)
        if (!isNaN(d.getTime())) where.createdAt.gte = d
      }
      if (filter.dateTo) {
        const d = new Date(filter.dateTo)
        if (!isNaN(d.getTime())) where.createdAt.lte = d
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ])

    return {
      items: items.map((item) => ({
        ...item,
        details: item.details as Record<string, unknown> | null,
      })),
      total,
      page,
      pageSize,
    }
  }

  async cleanup(retentionDays?: number): Promise<number> {
    const daysRaw = retentionDays ?? parseInt(process.env.AUDIT_LOG_RETENTION_DAYS ?? '90', 10)
    const days = !isNaN(daysRaw) && daysRaw > 0 ? daysRaw : 90
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)

    const result = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    })
    return result.count
  }
}
