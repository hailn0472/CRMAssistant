import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common'
import { GqlExecutionContext } from '@nestjs/graphql'
import { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'
import type { Request } from 'express'

import { AuditService } from '../../audit/audit.service'

/**
 * Maps mutation names to audit action and entity.
 * Convention: mutation names follow camelCase like `createContact`.
 * Exported for the spec — the interceptor itself reads it as module state.
 */
export const MUTATION_AUDIT_MAP: Record<string, { action: string; entity: string }> = {
  // Contact mutations
  createContact: { action: 'CREATE', entity: 'CONTACT' },
  updateContact: { action: 'UPDATE', entity: 'CONTACT' },
  deleteContact: { action: 'DELETE', entity: 'CONTACT' },

  // User mutations
  createUser: { action: 'CREATE', entity: 'USER' },
  updateUser: { action: 'UPDATE', entity: 'USER' },
  deactivateUser: { action: 'DELETE', entity: 'USER' },
  reactivateUser: { action: 'UPDATE', entity: 'USER' },
  deleteUser: { action: 'DELETE', entity: 'USER' },

  // Role mutations
  createRole: { action: 'CREATE', entity: 'ROLE' },
  updateRole: { action: 'UPDATE', entity: 'ROLE' },
  deleteRole: { action: 'DELETE', entity: 'ROLE' },

  // Permission mutations
  assignPermissionToRole: { action: 'UPDATE', entity: 'PERMISSION' },
  removePermissionFromRole: { action: 'UPDATE', entity: 'PERMISSION' },
  setRolePermissions: { action: 'UPDATE', entity: 'PERMISSION' },

  // Sharing mutations
  createSharingRule: { action: 'CREATE', entity: 'SHARING_RULE' },
  updateSharingRule: { action: 'UPDATE', entity: 'SHARING_RULE' },
  revokeSharingRule: { action: 'DELETE', entity: 'SHARING_RULE' },

  // API key mutations
  createApiKey: { action: 'API_KEY_CREATED', entity: 'API_KEY' },
  revokeApiKey: { action: 'API_KEY_REVOKED', entity: 'API_KEY' },
  rotateApiKey: { action: 'API_KEY_ROTATED', entity: 'API_KEY' },

  // Product mutations
  createProduct: { action: 'CREATE', entity: 'PRODUCT' },
  updateProduct: { action: 'UPDATE', entity: 'PRODUCT' },

  // Line-item mutations
  addLineItemToDeal: { action: 'UPDATE', entity: 'DEAL' },
  updateLineItem: { action: 'UPDATE', entity: 'DEAL' },
  removeLineItem: { action: 'UPDATE', entity: 'DEAL' },

  // Competitor mutations
  createCompetitor: { action: 'CREATE', entity: 'COMPETITOR' },
  updateCompetitor: { action: 'UPDATE', entity: 'COMPETITOR' },
  deleteCompetitor: { action: 'DELETE', entity: 'COMPETITOR' },

  // Deal-competitor / win-loss mutations (deal edits, not catalog management)
  addCompetitorToDeal: { action: 'UPDATE', entity: 'DEAL' },
  removeCompetitorFromDeal: { action: 'UPDATE', entity: 'DEAL' },
  recordWinLoss: { action: 'UPDATE', entity: 'DEAL' },

  // Deal document / comment mutations (Story 3.6)
  deleteDealDocument: { action: 'DELETE', entity: 'DEAL' },
  addDealComment: { action: 'UPDATE', entity: 'DEAL' },
  deleteDealComment: { action: 'DELETE', entity: 'DEAL' },

  // Deal health / reminder mutations (Story 3.7)
  snoozeDealReminder: { action: 'UPDATE', entity: 'DEAL' },
  unsnoozeDealReminder: { action: 'UPDATE', entity: 'DEAL' },
  updateReminderPreferences: { action: 'UPDATE', entity: 'USER' },

  // Task mutations (Story 4.1)
  createTask: { action: 'CREATE', entity: 'TASK' },
  createTaskFromTemplate: { action: 'CREATE', entity: 'TASK' },
  updateTask: { action: 'UPDATE', entity: 'TASK' },
  assignTask: { action: 'UPDATE', entity: 'TASK' },
  completeTask: { action: 'UPDATE', entity: 'TASK' },
  deleteTask: { action: 'DELETE', entity: 'TASK' },
  createTaskTemplate: { action: 'CREATE', entity: 'TASK_TEMPLATE' },
  updateTaskTemplate: { action: 'UPDATE', entity: 'TASK_TEMPLATE' },
  deleteTaskTemplate: { action: 'DELETE', entity: 'TASK_TEMPLATE' },

  // Task dependency mutations (Story 4.6). Decorative for GraphQL — the
  // interceptor never fires — but kept for documentation parity; the services
  // write the rows themselves (AC 16f, AC 17).
  addTaskDependency: { action: 'CREATE', entity: 'TASK_DEPENDENCY' },
  removeTaskDependency: { action: 'DELETE', entity: 'TASK_DEPENDENCY' },
  runRecurringTaskGeneration: { action: 'CREATE', entity: 'TASK' },

  // Activity-log preferences (Story 4.2). Decorative for GraphQL — the
  // interceptor never fires for mutations in this repo (AC 42) — but kept for
  // consistency; the service writes the row itself (AC 41).
  updateActivityLogPreferences: { action: 'UPDATE', entity: 'USER' },

  // Calendar mutations (Story 4.3). Also decorative for GraphQL — the
  // interceptor never fires — but kept for consistency; the services write
  // the rows themselves (AC 37-38). There is no double write.
  connectCalendar: { action: 'CREATE', entity: 'CALENDAR_CONNECTION' },
  disconnectCalendar: { action: 'DELETE', entity: 'CALENDAR_CONNECTION' },
  syncTaskToCalendar: { action: 'UPDATE', entity: 'TASK' },
  syncCalendar: { action: 'UPDATE', entity: 'CALENDAR_CONNECTION' },
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const gqlCtx = GqlExecutionContext.create(context)
    const info = gqlCtx.getInfo()
    const ctx = gqlCtx.getContext()
    const request: Request = ctx.req
    const args = gqlCtx.getArgs()

    const mutationName = info?.fieldName
    if (!mutationName || info?.parentType?.name !== 'Mutation') {
      return next.handle()
    }

    const auditMeta = MUTATION_AUDIT_MAP[mutationName]
    if (!auditMeta) {
      return next.handle()
    }

    const ipAddress =
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      request.socket?.remoteAddress ??
      null
    const userAgent = (request.headers['user-agent'] as string) ?? null

    return next.handle().pipe(
      tap({
        next: (result) => {
          this.logAudit(ctx, auditMeta, result, ipAddress, userAgent, args).catch(() => {
            // Audit logging must never break the mutation flow
          })
        },
        error: () => {
          // Audit failed mutations too — important for security forensics
          this.logAudit(ctx, auditMeta, null, ipAddress, userAgent, args).catch(() => {})
        },
      }),
    )
  }

  private async logAudit(
    ctx: { user?: { userId?: string; tenantId?: string } },
    meta: { action: string; entity: string },
    result: unknown,
    ipAddress: string | null,
    userAgent: string | null,
    args?: Record<string, unknown>,
  ): Promise<void> {
    if (!ctx.user?.userId || !ctx.user?.tenantId) return

    const entityId = this.extractEntityId(result)
    const fallbackId = typeof args?.id === 'string' ? args.id : null
    const resolvedId = entityId ?? fallbackId ?? 'unknown'

    // For CRUD actions, skip audit if we can't determine which resource was affected
    if (resolvedId === 'unknown' && ['CREATE', 'UPDATE', 'DELETE'].includes(meta.action)) {
      return
    }

    await this.auditService.log({
      tenantId: ctx.user.tenantId,
      userId: ctx.user.userId,
      action: meta.action as Parameters<AuditService['log']>[0]['action'],
      entity: meta.entity,
      entityId: resolvedId,
      ipAddress,
      userAgent,
      details: entityId
        ? { mutationName: meta.action }
        : { mutationName: meta.action, note: 'no id in result, used args' },
    })
  }

  private extractEntityId(result: unknown): string | null {
    if (typeof result !== 'object' || result === null) return null
    const obj = result as Record<string, unknown>
    if (typeof obj.id === 'string') return obj.id
    return null
  }
}
