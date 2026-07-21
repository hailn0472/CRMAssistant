import { builder } from '../graphql/schema.builder'
import { requirePermission } from '../common/guards/permission-check'
import type { FacebookPageConnection, FacebookService } from './facebook.service'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'
import { UnauthorizedException } from '@nestjs/common'

// ──────────────────────────────────────────────
// Object Types
// ──────────────────────────────────────────────

const FacebookPageConnectionRef = builder
  .objectRef<FacebookPageConnection>('FacebookPageConnection')
  .implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      tenantId: t.exposeString('tenantId'),
      channel: t.exposeString('channel'),
      externalId: t.exposeString('externalId'),
      displayName: t.exposeString('displayName', { nullable: true }),
      status: t.exposeString('status'),
      createdAt: t.string({ resolve: (conn) => conn.createdAt.toISOString() }),
      updatedAt: t.string({ resolve: (conn) => conn.updatedAt.toISOString() }),
    }),
  })

// ──────────────────────────────────────────────
// Input Types
// ──────────────────────────────────────────────

const ConnectFacebookPageInputRef = builder.inputType('ConnectFacebookPageInput', {
  fields: (t) => ({
    pageId: t.string({ required: true }),
    accessToken: t.string({ required: true }),
    displayName: t.string(),
  }),
})

// ──────────────────────────────────────────────
// Module-Level State
// ──────────────────────────────────────────────

let facebookService: FacebookService | undefined

function getFacebookService(): FacebookService {
  if (!facebookService) throw new Error('FacebookService not initialized')
  return facebookService
}

function requireUser(context: GraphqlContext): JwtPayload {
  if (!context.user) {
    throw new UnauthorizedException('Authentication required')
  }
  return context.user
}

// ──────────────────────────────────────────────
// Queries
// ──────────────────────────────────────────────

builder.queryFields((t) => ({
  facebookPages: t.field({
    type: [FacebookPageConnectionRef],
    resolve: async (_parent, _args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'INBOX', 'READ')
      return getFacebookService().listPages(user.tenantId)
    },
  }),
}))

// ──────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────

builder.mutationFields((t) => ({
  connectFacebookPage: t.field({
    type: FacebookPageConnectionRef,
    args: { input: t.arg({ type: ConnectFacebookPageInputRef, required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'INBOX', 'WRITE')
      return getFacebookService().connectPage(user.tenantId, user.userId, {
        pageId: args.input.pageId,
        accessToken: args.input.accessToken,
        displayName: args.input.displayName ?? undefined,
      })
    },
  }),
  disconnectFacebookPage: t.field({
    type: 'Boolean',
    args: { pageId: t.arg.string({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'INBOX', 'WRITE')
      return getFacebookService().disconnectPage(user.tenantId, user.userId, args.pageId)
    },
  }),
}))

// ──────────────────────────────────────────────
// Registration
// ──────────────────────────────────────────────

export function registerFacebookGraphql(fs: FacebookService): void {
  facebookService = fs
}
