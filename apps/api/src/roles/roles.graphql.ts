import { ForbiddenException, UnauthorizedException } from '@nestjs/common'

import { builder } from '../graphql/schema.builder'
import type { RolesService } from './roles.service'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

const RoleRef = builder.objectRef<Awaited<ReturnType<RolesService['getUserRoles']>>[number]>('Role')

RoleRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    description: t.exposeString('description', { nullable: true }),
    isSystem: t.exposeBoolean('isSystem'),
  }),
})

const RoleWithUserCountRef =
  builder.objectRef<Awaited<ReturnType<RolesService['findMany']>>[number]>('RoleWithUserCount')

RoleWithUserCountRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    description: t.exposeString('description', { nullable: true }),
    isSystem: t.exposeBoolean('isSystem'),
    userCount: t.int({ resolve: (role) => role._count.userRoles }),
    createdAt: t.string({ resolve: (role) => role.createdAt.toISOString() }),
    updatedAt: t.string({ resolve: (role) => role.updatedAt.toISOString() }),
  }),
})

const CreateRoleInputRef = builder.inputType('CreateRoleInput', {
  fields: (t) => ({
    name: t.string({ required: true }),
    description: t.string(),
  }),
})

const UpdateRoleInputRef = builder.inputType('UpdateRoleInput', {
  fields: (t) => ({
    name: t.string(),
    description: t.string(),
  }),
})

const RoleUserRef = builder.objectRef<{
  id: string
  email: string
  firstName: string
  lastName: string
}>('RoleUser')

RoleUserRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    email: t.exposeString('email'),
    firstName: t.exposeString('firstName'),
    lastName: t.exposeString('lastName'),
  }),
})

let rolesService: RolesService | undefined

function getRolesService(): RolesService {
  if (!rolesService) {
    throw new Error('RolesService is not initialized')
  }
  return rolesService
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
  role: t.field({
    type: RoleWithUserCountRef,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      const role = await getRolesService().findOne(user.tenantId, String(args.id))
      const roleWithCount = await getRolesService().findMany(user.tenantId)
      const match = roleWithCount.find((r) => r.id === role.id)
      if (!match) {
        throw new Error('Role not found')
      }
      return match
    },
  }),
  roles: t.field({
    type: [RoleWithUserCountRef],
    resolve: async (_parent, _args, context) => {
      const user = requireUser(context)
      return getRolesService().findMany(user.tenantId)
    },
  }),
  userRoles: t.field({
    type: [RoleRef],
    args: { userId: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      return getRolesService().getUserRoles(user.tenantId, String(args.userId))
    },
  }),
  roleUsers: t.field({
    type: [RoleUserRef],
    args: { roleId: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      return getRolesService().getUsersForRole(user.tenantId, String(args.roleId))
    },
  }),
}))

builder.mutationFields((t) => ({
  createRole: t.field({
    type: RoleWithUserCountRef,
    args: { input: t.arg({ type: CreateRoleInputRef, required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireAdmin(context)
      const role = await getRolesService().create(user.tenantId, user.userId, {
        name: args.input.name,
        description: args.input.description ?? undefined,
      })
      const roles = await getRolesService().findMany(user.tenantId)
      const match = roles.find((r) => r.id === role.id)
      if (!match) {
        throw new Error('Created role not found')
      }
      return match
    },
  }),
  updateRole: t.field({
    type: RoleWithUserCountRef,
    args: {
      id: t.arg.id({ required: true }),
      input: t.arg({ type: UpdateRoleInputRef, required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireAdmin(context)
      await getRolesService().update(user.tenantId, user.userId, String(args.id), {
        name: args.input.name ?? undefined,
        description: Object.prototype.hasOwnProperty.call(args.input, 'description')
          ? args.input.description ?? undefined
          : undefined,
      })
      const roles = await getRolesService().findMany(user.tenantId)
      const match = roles.find((r) => r.id === String(args.id))
      if (!match) {
        throw new Error('Role not found')
      }
      return match
    },
  }),
  deleteRole: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireAdmin(context)
      return getRolesService().delete(user.tenantId, user.userId, String(args.id))
    },
  }),
  assignRoleToUser: t.field({
    type: RoleRef,
    args: {
      userId: t.arg.id({ required: true }),
      roleId: t.arg.id({ required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireAdmin(context)
      await getRolesService().assignRoleToUser(
        user.tenantId,
        user.userId,
        String(args.userId),
        String(args.roleId),
      )
      const userRoles = await getRolesService().getUserRoles(user.tenantId, String(args.userId))
      const assigned = userRoles.find((r) => r.id === String(args.roleId))
      if (!assigned) {
        throw new Error('Role assignment not found')
      }
      return assigned
    },
  }),
  removeRoleFromUser: t.boolean({
    args: {
      userId: t.arg.id({ required: true }),
      roleId: t.arg.id({ required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireAdmin(context)
      return getRolesService().removeRoleFromUser(
        user.tenantId,
        user.userId,
        String(args.userId),
        String(args.roleId),
      )
    },
  }),
}))

export function registerRoleGraphql(service: RolesService): void {
  rolesService = service
}
