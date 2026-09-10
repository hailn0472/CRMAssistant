import { builder } from '../graphql/schema.builder'
import { requirePermission } from '../common/guards/permission-check'
import type { FacebookPageConnection, FacebookService } from './facebook.service'
import type { FacebookHistorySyncService } from './facebook-history-sync.service'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'
import {
  BadRequestException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'

const logger = new Logger('FacebookGraphql')

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
let facebookHistorySyncService: FacebookHistorySyncService | undefined

function getFacebookService(): FacebookService {
  if (!facebookService) throw new Error('FacebookService not initialized')
  return facebookService
}

function getFacebookHistorySyncService(): FacebookHistorySyncService {
  if (!facebookHistorySyncService) throw new Error('FacebookHistorySyncService not initialized')
  return facebookHistorySyncService
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
      const connection = await getFacebookService().connectPage(user.tenantId, user.userId, {
        pageId: args.input.pageId,
        accessToken: args.input.accessToken,
        displayName: args.input.displayName ?? undefined,
      })

      // Reconnect trigger (Story 8A.4, AC #1) — best-effort, fire-and-forget.
      // Wired here rather than inside FacebookService to avoid a DI cycle
      // (FacebookHistorySyncService already depends on FacebookService).
      void getFacebookHistorySyncService()
        .syncConnection(connection.id)
        .catch((err) => logger.error('Facebook history sync on reconnect failed', err))

      return connection
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
  syncFacebookHistory: t.field({
    type: 'Boolean',
    args: { connectionId: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'INBOX', 'WRITE')

      const connection = await getFacebookService().findTenantConnectionById(
        user.tenantId,
        String(args.connectionId),
      )
      if (!connection) {
        throw new NotFoundException('Facebook page connection not found')
      }
      // Surface a clear error instead of a misleading `true` for a connection
      // that `syncConnection` would silently no-op on (non-ACTIVE).
      if (connection.status !== 'ACTIVE') {
        throw new BadRequestException('Facebook page connection is not active')
      }

      await getFacebookHistorySyncService().syncConnection(connection.id)
      return true
    },
  }),
}))

// ──────────────────────────────────────────────
// Registration
// ──────────────────────────────────────────────

export function registerFacebookGraphql(fs: FacebookService): void {
  facebookService = fs
}

export function registerFacebookHistorySync(service: FacebookHistorySyncService): void {
  facebookHistorySyncService = service
}
