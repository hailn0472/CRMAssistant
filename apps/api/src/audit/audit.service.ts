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
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        details: input.details ? (input.details as Prisma.InputJsonValue) : undefined,
      },
    })
  }
}
