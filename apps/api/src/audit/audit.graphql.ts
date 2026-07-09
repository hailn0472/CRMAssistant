import { ForbiddenException, UnauthorizedException } from '@nestjs/common'

import { builder } from '../graphql/schema.builder'
import type { AuditService, AuditLogFilter, AuditLogListResult } from './audit.service'
import type { GraphqlContext } from '../graphql/graphql-context'

// Local user reference — follows pattern from contacts.graphql.ts (ContactOwner) and roles.graphql.ts (RoleUser)
const AuditLogUserRef = builder.objectRef<{
  id: string
  email: string
  firstName: string
  lastName: string
}>('AuditLogUser')

AuditLogUserRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    email: t.exposeString('email'),
    firstName: t.exposeString('firstName'),
    lastName: t.exposeString('lastName'),
  }),
})

const AuditLogRef = builder.objectRef<AuditLogListResult['items'][number]>('AuditLog').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    userId: t.exposeString('userId'),
    action: t.exposeString('action'),
    entity: t.exposeString('entity'),
    entityId: t.exposeString('entityId'),
    // details is Json? in Prisma — expose as String (JSON-serialized) to avoid needing a JSON scalar
    details: t.string({
      nullable: true,
      resolve: (log) => (log.details ? JSON.stringify(log.details) : null),
    }),
    ipAddress: t.exposeString('ipAddress', { nullable: true }),
    userAgent: t.exposeString('userAgent', { nullable: true }),
    createdAt: t.string({ resolve: (log) => log.createdAt.toISOString() }),
    user: t.field({
      type: AuditLogUserRef,
      nullable: true,
      resolve: async (parent) => {
        if (!prismaService) return null
        const user = await prismaService.user.findUnique({
          where: { id: parent.userId },
          select: { id: true, email: true, firstName: true, lastName: true },
        })
        return user
      },
    }),
  }),
})

const AuditLogFilterInputRef = builder.inputType('AuditLogFilterInput', {
  fields: (t) => ({
    userId: t.string(),
    action: t.string(),
    entity: t.string(),
    dateFrom: t.string(),
    dateTo: t.string(),
  }),
})

// Each module defines its own pagination input type (no shared type)
const AuditLogPaginationInputRef = builder.inputType('AuditLogPaginationInput', {
  fields: (t) => ({
    page: t.int(),
    pageSize: t.int(),
  }),
})

const AuditLogConnectionRef = builder
  .objectRef<AuditLogListResult>('AuditLogConnection')
  .implement({
    fields: (t) => ({
      items: t.field({ type: [AuditLogRef], resolve: (conn) => conn.items }),
      total: t.exposeInt('total'),
      page: t.exposeInt('page'),
      pageSize: t.exposeInt('pageSize'),
    }),
  })

// Module-level variable for DI bridge
let auditService: AuditService | undefined
let prismaService: import('../prisma/prisma.service').PrismaService | undefined

export function registerAuditGraphql(
  service: AuditService,
  prisma: import('../prisma/prisma.service').PrismaService,
): void {
  auditService = service
  prismaService = prisma
}

function requireUser(
  context: GraphqlContext,
): import('../auth/strategies/jwt.strategy').JwtPayload {
  if (!context.user) {
    throw new UnauthorizedException('Authentication required')
  }
  return context.user
}

function requireAdmin(
  context: GraphqlContext,
): import('../auth/strategies/jwt.strategy').JwtPayload {
  const user = requireUser(context)
  if (!user.roles || !user.roles.includes('ADMIN')) {
    throw new ForbiddenException('Only admins can view audit logs')
  }
  return user
}

builder.queryFields((t) => ({
  auditLogs: t.field({
    type: AuditLogConnectionRef,
    args: {
      filter: t.arg({ type: AuditLogFilterInputRef, required: false }),
      pagination: t.arg({ type: AuditLogPaginationInputRef, required: false }),
    },
    resolve: async (_parent, args, context) => {
      if (!auditService) throw new Error('AuditService not initialized')
      const user = requireAdmin(context)

      const filter: AuditLogFilter = {
        userId: args.filter?.userId ?? undefined,
        action: args.filter?.action ?? undefined,
        entity: args.filter?.entity ?? undefined,
        dateFrom: args.filter?.dateFrom ?? undefined,
        dateTo: args.filter?.dateTo ?? undefined,
      }

      return auditService.list(user.tenantId, filter, {
        page: args.pagination?.page ?? undefined,
        pageSize: args.pagination?.pageSize ?? undefined,
      })
    },
  }),
}))
