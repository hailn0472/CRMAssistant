import { ForbiddenException, UnauthorizedException } from '@nestjs/common'

import { builder } from '../graphql/schema.builder'
import type { ApiKeyService } from './api-key.service'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from './strategies/jwt.strategy'

const ApiKeyRef = builder.objectRef<{
  id: string
  name: string
  keyPrefix: string
  permissions: string[] | null
  expiresAt: Date | null
  lastUsedAt: Date | null
  isRevoked: boolean
  createdAt: Date
  updatedAt: Date
}>('ApiKey')

ApiKeyRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    keyPrefix: t.exposeString('keyPrefix'),
    permissions: t.stringList({
      nullable: true,
      resolve: (key) => key.permissions,
    }),
    expiresAt: t.string({
      nullable: true,
      resolve: (key) => key.expiresAt?.toISOString() ?? null,
    }),
    lastUsedAt: t.string({
      nullable: true,
      resolve: (key) => key.lastUsedAt?.toISOString() ?? null,
    }),
    isRevoked: t.exposeBoolean('isRevoked'),
    createdAt: t.string({ resolve: (key) => key.createdAt.toISOString() }),
    updatedAt: t.string({ resolve: (key) => key.updatedAt.toISOString() }),
  }),
})

const CreateApiKeyResultRef = builder.objectRef<{
  id: string
  name: string
  keyPrefix: string
  fullKey: string
  permissions: string[] | null
  expiresAt: Date | null
}>('CreateApiKeyResult')

CreateApiKeyResultRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    keyPrefix: t.exposeString('keyPrefix'),
    fullKey: t.exposeString('fullKey'),
    permissions: t.stringList({
      nullable: true,
      resolve: (key) => key.permissions,
    }),
    expiresAt: t.string({
      nullable: true,
      resolve: (key) => key.expiresAt?.toISOString() ?? null,
    }),
  }),
})

const RotateApiKeyResultRef = builder.objectRef<{
  id: string
  fullKey: string
  keyPrefix: string
}>('RotateApiKeyResult')

RotateApiKeyResultRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    fullKey: t.exposeString('fullKey'),
    keyPrefix: t.exposeString('keyPrefix'),
  }),
})

const CreateApiKeyInputRef = builder.inputType('CreateApiKeyInput', {
  fields: (t) => ({
    name: t.string({ required: true }),
    permissions: t.stringList(),
  }),
})

let apiKeyService: ApiKeyService | undefined

export function registerApiKeyGraphql(service: ApiKeyService): void {
  apiKeyService = service
}

function getApiKeyService(): ApiKeyService {
  if (!apiKeyService) {
    throw new Error('ApiKeyService is not initialized')
  }
  return apiKeyService
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
    throw new ForbiddenException('Only admins can manage API keys')
  }
  return user
}

builder.queryFields((t) => ({
  apiKeys: t.field({
    type: [ApiKeyRef],
    resolve: async (_parent, _args, context) => {
      const user = requireUser(context)
      return getApiKeyService().listApiKeys(user.tenantId, user.userId)
    },
  }),
}))

builder.mutationFields((t) => ({
  createApiKey: t.field({
    type: CreateApiKeyResultRef,
    args: { input: t.arg({ type: CreateApiKeyInputRef, required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireAdmin(context)

      // Validate that scoped permissions are a subset of the user's own permissions
      if (args.input.permissions && args.input.permissions.length > 0) {
        const userPerms = user.permissions ?? []
        for (const perm of args.input.permissions) {
          if (!userPerms.includes(perm)) {
            throw new ForbiddenException(`Permission "${perm}" is not assigned to your account`)
          }
        }
      }

      return getApiKeyService().createApiKey({
        tenantId: user.tenantId,
        userId: user.userId,
        name: args.input.name,
        permissions: args.input.permissions ?? null,
      })
    },
  }),
  revokeApiKey: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireAdmin(context)
      return getApiKeyService().revokeApiKey(String(args.id), user.tenantId)
    },
  }),
  rotateApiKey: t.field({
    type: RotateApiKeyResultRef,
    nullable: true,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireAdmin(context)
      const result = await getApiKeyService().rotateApiKey(String(args.id), user.tenantId)
      if (!result) return null
      return { id: result.id, fullKey: result.fullKey, keyPrefix: result.keyPrefix }
    },
  }),
}))
