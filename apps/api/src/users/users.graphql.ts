import { ForbiddenException, UnauthorizedException } from '@nestjs/common'

import { builder } from '../graphql/schema.builder'
import type { UserListItem, UsersService } from './users.service'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

type UserGraphqlShape = Awaited<ReturnType<UsersService['findOne']>> | UserListItem

const UserRef = builder.objectRef<UserGraphqlShape>('User')

UserRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    tenantId: t.exposeString('tenantId'),
    email: t.exposeString('email'),
    firstName: t.exposeString('firstName'),
    lastName: t.exposeString('lastName'),
    avatar: t.exposeString('avatar', { nullable: true }),
    phone: t.exposeString('phone', { nullable: true }),
    jobTitle: t.exposeString('jobTitle', { nullable: true }),
    department: t.exposeString('department', { nullable: true }),
    role: t.exposeString('role'),
    isActive: t.exposeBoolean('isActive'),
    lastLoginAt: t.string({
      nullable: true,
      resolve: (user) => (user.lastLoginAt ? user.lastLoginAt.toISOString() : null),
    }),
    createdAt: t.string({ resolve: (user) => user.createdAt.toISOString() }),
    updatedAt: t.string({ resolve: (user) => user.updatedAt.toISOString() }),
  }),
})

const UserConnectionRef = builder
  .objectRef<Awaited<ReturnType<UsersService['findMany']>>>('UserConnection')
  .implement({
    fields: (t) => ({
      items: t.field({ type: [UserRef], resolve: (connection) => connection.items }),
      total: t.exposeInt('total'),
      page: t.exposeInt('page'),
      pageSize: t.exposeInt('pageSize'),
    }),
  })

const CreateUserInputRef = builder.inputType('CreateUserInput', {
  fields: (t) => ({
    email: t.string({ required: true }),
    firstName: t.string({ required: true }),
    lastName: t.string({ required: true }),
    role: t.string(),
    phone: t.string(),
    jobTitle: t.string(),
    department: t.string(),
  }),
})

const UpdateUserInputRef = builder.inputType('UpdateUserInput', {
  fields: (t) => ({
    email: t.string(),
    firstName: t.string(),
    lastName: t.string(),
    role: t.string(),
    phone: t.string(),
    jobTitle: t.string(),
    department: t.string(),
  }),
})

const UpdateProfileInputRef = builder.inputType('UpdateProfileInput', {
  fields: (t) => ({
    firstName: t.string(),
    lastName: t.string(),
    avatar: t.string(),
    phone: t.string(),
  }),
})

const UserFilterInputRef = builder.inputType('UserFilterInput', {
  fields: (t) => ({
    search: t.string(),
    role: t.string(),
    isActive: t.boolean(),
  }),
})

const UserPaginationInputRef = builder.inputType('UserPaginationInput', {
  fields: (t) => ({
    page: t.int(),
    pageSize: t.int(),
  }),
})

let usersService: UsersService | undefined

function getUsersService(): UsersService {
  if (!usersService) {
    throw new Error('UsersService is not initialized')
  }
  return usersService
}

const ADMIN_ROLES: string[] = ['ADMIN', 'MANAGER']

function requireUser(context: GraphqlContext): JwtPayload {
  if (!context.user) {
    throw new UnauthorizedException('Authentication required')
  }
  return context.user
}

function requireAdminOrManager(context: GraphqlContext): JwtPayload {
  const user = requireUser(context)
  if (!ADMIN_ROLES.includes(user.role)) {
    throw new ForbiddenException('Only admins and managers can perform this action')
  }
  return user
}

builder.queryFields((t) => ({
  me: t.field({
    type: UserRef,
    resolve: async (_parent, _args, context) => {
      const user = requireUser(context)
      return getUsersService().findMe(user.tenantId, user.userId)
    },
  }),
  user: t.field({
    type: UserRef,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      return getUsersService().findOne(user.tenantId, String(args.id))
    },
  }),
  users: t.field({
    type: UserConnectionRef,
    args: {
      filter: t.arg({ type: UserFilterInputRef }),
      pagination: t.arg({ type: UserPaginationInputRef }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      return getUsersService().findMany(
        user.tenantId,
        {
          search: args.filter?.search ?? undefined,
          role: args.filter?.role ?? undefined,
          isActive: args.filter?.isActive ?? undefined,
        },
        {
          page: args.pagination?.page ?? undefined,
          pageSize: args.pagination?.pageSize ?? undefined,
        },
      )
    },
  }),
}))

builder.mutationFields((t) => ({
  createUser: t.field({
    type: UserRef,
    args: { input: t.arg({ type: CreateUserInputRef, required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireAdminOrManager(context)
      return getUsersService().create(user.tenantId, user.userId, {
        email: args.input.email,
        firstName: args.input.firstName,
        lastName: args.input.lastName,
        role: args.input.role ?? undefined,
        phone: args.input.phone ?? undefined,
        jobTitle: args.input.jobTitle ?? undefined,
        department: args.input.department ?? undefined,
      })
    },
  }),
  updateUser: t.field({
    type: UserRef,
    args: {
      id: t.arg.id({ required: true }),
      input: t.arg({ type: UpdateUserInputRef, required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireAdminOrManager(context)
      return getUsersService().update(user.tenantId, user.userId, String(args.id), {
        email: args.input.email ?? undefined,
        firstName: args.input.firstName ?? undefined,
        lastName: args.input.lastName ?? undefined,
        role: args.input.role ?? undefined,
        phone: Object.prototype.hasOwnProperty.call(args.input, 'phone')
          ? args.input.phone
          : undefined,
        jobTitle: Object.prototype.hasOwnProperty.call(args.input, 'jobTitle')
          ? args.input.jobTitle
          : undefined,
        department: Object.prototype.hasOwnProperty.call(args.input, 'department')
          ? args.input.department
          : undefined,
      })
    },
  }),
  updateProfile: t.field({
    type: UserRef,
    args: { input: t.arg({ type: UpdateProfileInputRef, required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      return getUsersService().updateProfile(user.tenantId, user.userId, {
        firstName: args.input.firstName ?? undefined,
        lastName: args.input.lastName ?? undefined,
        avatar: Object.prototype.hasOwnProperty.call(args.input, 'avatar')
          ? args.input.avatar
          : undefined,
        phone: Object.prototype.hasOwnProperty.call(args.input, 'phone')
          ? args.input.phone
          : undefined,
      })
    },
  }),
  deactivateUser: t.field({
    type: UserRef,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireAdminOrManager(context)
      return getUsersService().deactivate(user.tenantId, user.userId, String(args.id))
    },
  }),
  reactivateUser: t.field({
    type: UserRef,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireAdminOrManager(context)
      return getUsersService().reactivate(user.tenantId, user.userId, String(args.id))
    },
  }),
  deactivateUsers: t.int({
    args: { ids: t.arg({ type: ['ID'], required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireAdminOrManager(context)
      return getUsersService().deactivateUsers(user.tenantId, user.userId, args.ids.map(String))
    },
  }),
  reactivateUsers: t.int({
    args: { ids: t.arg({ type: ['ID'], required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireAdminOrManager(context)
      return getUsersService().reactivateUsers(user.tenantId, user.userId, args.ids.map(String))
    },
  }),
  deleteUser: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireAdminOrManager(context)
      return getUsersService().delete(user.tenantId, user.userId, String(args.id))
    },
  }),
}))

export function registerUserGraphql(service: UsersService): void {
  usersService = service
}
