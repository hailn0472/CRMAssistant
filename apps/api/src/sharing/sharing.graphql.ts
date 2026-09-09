import { BadRequestException, UnauthorizedException } from '@nestjs/common'

import { builder } from '../graphql/schema.builder'
import { requirePermission } from '../common/guards/permission-check'
import type { SharingService } from './sharing.service'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

const VALID_RESOURCE_TYPES = ['CONTACT', 'TASK'] as const
const VALID_ACCESS_LEVELS = ['READ', 'EDIT', 'FULL'] as const

function validateResourceType(value: string): 'CONTACT' | 'TASK' {
  if (!VALID_RESOURCE_TYPES.includes(value as (typeof VALID_RESOURCE_TYPES)[number])) {
    throw new BadRequestException(`Invalid resource type: ${value}`)
  }
  return value as 'CONTACT' | 'TASK'
}

function validateAccessLevel(value: string): 'READ' | 'EDIT' | 'FULL' {
  if (!VALID_ACCESS_LEVELS.includes(value as (typeof VALID_ACCESS_LEVELS)[number])) {
    throw new BadRequestException(`Invalid access level: ${value}`)
  }
  return value as 'READ' | 'EDIT' | 'FULL'
}

const SharingRuleRef = builder.objectRef<{
  id: string
  tenantId: string
  resourceType: string
  resourceId: string
  sharedWithUserId: string | null
  sharedWithTeamId: string | null
  accessLevel: string
  sharedBy: string
  createdAt: Date
  updatedAt: Date
}>('SharingRule')

SharingRuleRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    resourceType: t.exposeString('resourceType'),
    resourceId: t.exposeID('resourceId'),
    sharedWithUserId: t.exposeID('sharedWithUserId', { nullable: true }),
    sharedWithTeamId: t.exposeID('sharedWithTeamId', { nullable: true }),
    accessLevel: t.exposeString('accessLevel'),
    sharedBy: t.exposeString('sharedBy'),
    createdAt: t.string({ resolve: (rule) => rule.createdAt.toISOString() }),
    updatedAt: t.string({ resolve: (rule) => rule.updatedAt.toISOString() }),
  }),
})

let sharingService: SharingService | undefined

function getSharingService(): SharingService {
  if (!sharingService) {
    throw new Error('SharingService is not initialized')
  }
  return sharingService
}

function requireUser(context: GraphqlContext): JwtPayload {
  if (!context.user) {
    throw new UnauthorizedException('Authentication required')
  }
  return context.user
}

builder.queryFields((t) => ({
  sharingRules: t.field({
    type: [SharingRuleRef],
    args: {
      resourceType: t.arg.string({ required: true }),
      resourceId: t.arg.id({ required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      return getSharingService().getSharingRules(
        user.tenantId,
        user.userId,
        args.resourceType as 'CONTACT' | 'TASK',
        String(args.resourceId),
      )
    },
  }),
  sharedWithMe: t.field({
    type: [SharingRuleRef],
    args: {
      resourceType: t.arg.string(),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      return getSharingService().getSharedWithMe(
        user.tenantId,
        user.userId,
        args.resourceType ? (args.resourceType as 'CONTACT' | 'TASK') : undefined,
      )
    },
  }),
}))

builder.mutationFields((t) => ({
  shareRecord: t.field({
    type: SharingRuleRef,
    args: {
      resourceType: t.arg.string({ required: true }),
      resourceId: t.arg.id({ required: true }),
      sharedWithUserId: t.arg.id(),
      sharedWithTeamId: t.arg.id(),
      accessLevel: t.arg.string({ required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      const resourceType = validateResourceType(args.resourceType)
      await requirePermission(context, resourceType, 'UPDATE')
      return getSharingService().create(user.tenantId, user.userId, {
        resourceType,
        resourceId: String(args.resourceId),
        sharedWithUserId: args.sharedWithUserId ?? undefined,
        sharedWithTeamId: args.sharedWithTeamId ?? undefined,
        accessLevel: validateAccessLevel(args.accessLevel),
      })
    },
  }),
  unshareRecord: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'CONTACT', 'UPDATE')
      return getSharingService().unshare(user.tenantId, user.userId, String(args.id))
    },
  }),
  updateSharingAccess: t.field({
    type: SharingRuleRef,
    args: {
      id: t.arg.id({ required: true }),
      accessLevel: t.arg.string({ required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'CONTACT', 'UPDATE')
      return getSharingService().updateAccess(user.tenantId, user.userId, String(args.id), {
        accessLevel: validateAccessLevel(args.accessLevel),
      })
    },
  }),
}))

export function registerSharingGraphql(service: SharingService): void {
  sharingService = service
}
