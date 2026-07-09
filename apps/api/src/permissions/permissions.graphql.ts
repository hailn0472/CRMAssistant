import { ForbiddenException, UnauthorizedException } from '@nestjs/common'

import { builder } from '../graphql/schema.builder'
import type { PermissionsService } from './permissions.service'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

const PermissionRef =
  builder.objectRef<Awaited<ReturnType<PermissionsService['getAllPermissions']>>[number]>(
    'Permission',
  )

PermissionRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    resource: t.exposeString('resource'),
    action: t.exposeString('action'),
    description: t.exposeString('description', { nullable: true }),
  }),
})

const PermissionCheckRef = builder.objectRef<{
  resource: string
  action: string
  granted: boolean
}>('PermissionCheck')

PermissionCheckRef.implement({
  fields: (t) => ({
    resource: t.exposeString('resource'),
    action: t.exposeString('action'),
    granted: t.exposeBoolean('granted'),
  }),
})

let permissionsService: PermissionsService | undefined

function getPermissionsService(): PermissionsService {
  if (!permissionsService) {
    throw new Error('PermissionsService is not initialized')
  }
  return permissionsService
}

function requireUser(context: GraphqlContext): JwtPayload {
  if (!context.user) {
    throw new UnauthorizedException('Authentication required')
  }
  return context.user
}

function requireAdmin(context: GraphqlContext): JwtPayload {
  const user = requireUser(context)
  if (!user.roles || !user.roles.includes('ADMIN')) {
    throw new ForbiddenException('Only admins can perform this action')
  }
  return user
}

builder.queryFields((t) => ({
  allPermissions: t.field({
    type: [PermissionRef],
    resolve: async (_parent, _args, context) => {
      requireUser(context)
      return getPermissionsService().getAllPermissions()
    },
  }),
  rolePermissions: t.field({
    type: [PermissionRef],
    args: { roleId: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      return getPermissionsService().getRolePermissions(user.tenantId, String(args.roleId))
    },
  }),
  myPermissions: t.field({
    type: [PermissionCheckRef],
    resolve: async (_parent, _args, context) => {
      const user = requireUser(context)

      // Use batch cache if available
      if (context.permissionCache && context.permissionCache.has(user.userId)) {
        return context.permissionCache.get(user.userId) ?? []
      }

      const perms = await getPermissionsService().getMyPermissions(user.tenantId, user.userId)

      // Populate cache
      if (context.permissionCache) {
        context.permissionCache.set(user.userId, perms)
      }

      return perms
    },
  }),
}))

builder.mutationFields((t) => ({
  assignPermissionToRole: t.field({
    type: PermissionRef,
    args: {
      roleId: t.arg.id({ required: true }),
      permissionId: t.arg.id({ required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireAdmin(context)
      const rp = await getPermissionsService().assignPermissionToRole(
        user.tenantId,
        user.userId,
        String(args.roleId),
        String(args.permissionId),
      )
      const perms = await getPermissionsService().getAllPermissions()
      const match = perms.find((p) => p.id === rp.permissionId)
      if (!match) {
        throw new Error('Assigned permission not found')
      }
      return match
    },
  }),
  removePermissionFromRole: t.boolean({
    args: {
      roleId: t.arg.id({ required: true }),
      permissionId: t.arg.id({ required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireAdmin(context)
      return getPermissionsService().removePermissionFromRole(
        user.tenantId,
        user.userId,
        String(args.roleId),
        String(args.permissionId),
      )
    },
  }),
  setRolePermissions: t.field({
    type: [PermissionRef],
    args: {
      roleId: t.arg.id({ required: true }),
      permissionIds: t.arg({ type: ['ID'], required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireAdmin(context)
      return getPermissionsService().setRolePermissions(
        user.tenantId,
        user.userId,
        String(args.roleId),
        args.permissionIds.map(String),
      )
    },
  }),
}))

export function registerPermissionGraphql(service: PermissionsService): void {
  permissionsService = service
}
