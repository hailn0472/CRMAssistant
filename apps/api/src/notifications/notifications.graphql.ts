import { UnauthorizedException } from '@nestjs/common'

/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types */

import { builder } from '../graphql/schema.builder'
import type { NotificationsService } from './notifications.service'
import type { NotificationPubSubService } from './notification-pubsub.service'
import { NOTIFICATION_TYPES, type NotificationType } from './notification-types'
import { PUBSUB_NOTIFICATION_CREATED } from './notification-pubsub.service'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

// ─── Audit comment ─────────────────────────────────────────
// No MUTATION_AUDIT_MAP entries and no AuditService calls in this file
// (Story 4.8 arbitration). Every notification is derived from an
// already-audited mutation (assignTask, addDealComment, the sweep's
// audit.log), so no audit row is written for the notification itself —
// the Activity derived-record carve-out applies.

// ─── NotificationType Enum ─────────────────────────────────

const NotificationTypeRef = builder.enumType('NotificationType', {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  values: NOTIFICATION_TYPES as any,
})

// ─── Notification Type ─────────────────────────────────────

type NotificationShape = {
  id: string
  type: string
  title: string
  body: string | null
  dealId: string | null
  taskId: string | null
  reportExportId: string | null
  readAt: Date | null
  createdAt: Date
}

const NotificationRef = builder.objectRef<NotificationShape>('Notification')

NotificationRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    type: t.field({
      type: NotificationTypeRef,
      resolve: (n) => n.type as NotificationType,
    }),
    title: t.exposeString('title'),
    body: t.string({
      nullable: true,
      resolve: (n) => n.body ?? null,
    }),
    dealId: t.string({
      nullable: true,
      resolve: (n) => n.dealId ?? null,
    }),
    taskId: t.string({
      nullable: true,
      resolve: (n) => n.taskId ?? null,
    }),
    reportExportId: t.string({
      nullable: true,
      resolve: (n) => n.reportExportId ?? null,
    }),
    readAt: t.string({
      nullable: true,
      resolve: (n) => (n.readAt ? n.readAt.toISOString() : null),
    }),
    createdAt: t.string({ resolve: (n) => n.createdAt.toISOString() }),
  }),
})

// ─── NotificationConnection Type ───────────────────────────

const NotificationConnectionRef = builder
  .objectRef<{
    items: NotificationShape[]
    total: number
    page: number
    pageSize: number
  }>('NotificationConnection')
  .implement({
    fields: (t) => ({
      items: t.field({ type: [NotificationRef], resolve: (c) => c.items }),
      total: t.exposeInt('total'),
      page: t.exposeInt('page'),
      pageSize: t.exposeInt('pageSize'),
    }),
  })

// ─── Input Types ───────────────────────────────────────────

const NotificationFilterInputRef = builder.inputType('NotificationFilterInput', {
  fields: (t) => ({
    unreadOnly: t.boolean(),
  }),
})

const NotificationPaginationInputRef = builder.inputType('NotificationPaginationInput', {
  fields: (t) => ({
    page: t.int(),
    pageSize: t.int(),
  }),
})

// ─── Service Singletons ────────────────────────────────────

let notificationsService: NotificationsService | undefined
let notificationPubSub: NotificationPubSubService | undefined

function getNotificationsService(): NotificationsService {
  if (!notificationsService) throw new Error('NotificationsService is not initialized')
  return notificationsService
}

function getNotificationPubSub(): NotificationPubSubService {
  if (!notificationPubSub) throw new Error('NotificationPubSubService is not initialized')
  return notificationPubSub
}

function requireUser(context: GraphqlContext): JwtPayload {
  if (!context.user) {
    throw new UnauthorizedException('Authentication required')
  }
  return context.user
}

// ─── Query Fields ──────────────────────────────────────────

builder.queryFields((t) => ({
  notifications: t.field({
    type: NotificationConnectionRef,
    args: {
      filter: t.arg({ type: NotificationFilterInputRef }),
      pagination: t.arg({ type: NotificationPaginationInputRef }),
    },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      // Self-scoped — no requirePermission (AC 42-43)
      return getNotificationsService().findMany(
        user.tenantId,
        user.userId,
        (args.filter ?? {}) as Parameters<NotificationsService['findMany']>[2],
        (args.pagination ?? {}) as Parameters<NotificationsService['findMany']>[3],
      )
    },
  }),

  unreadNotificationCount: t.field({
    type: 'Int',
    resolve: async (_parent, _args, context: GraphqlContext) => {
      const user = requireUser(context)
      return getNotificationsService().countUnread(user.tenantId, user.userId)
    },
  }),
}))

// ─── Mutation Fields ──────────────────────────────────────

builder.mutationFields((t) => ({
  markNotificationRead: t.field({
    type: NotificationRef,
    args: {
      id: t.arg.id({ required: true }),
    },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      return getNotificationsService().markRead(user.tenantId, user.userId, args.id)
    },
  }),

  markAllNotificationsRead: t.field({
    type: 'Int',
    resolve: async (_parent, _args, context: GraphqlContext) => {
      const user = requireUser(context)
      return getNotificationsService().markAllRead(user.tenantId, user.userId)
    },
  }),
}))

// ─── Subscriptions ────────────────────────────────────────

builder.subscriptionField('onNotificationReceived', (t) =>
  t.field({
    type: NotificationRef,
    subscribe: async (_root, _args, context) => {
      const user = requireUser(context)
      const pubsub = getNotificationPubSub()
      return {
        [Symbol.asyncIterator]: async function* () {
          // The channel is scoped to the caller's own id, so no
          // resolveVisibilityFilter is applied and none is needed — a subscriber can
          // only ever reach their own channel, and every payload is by construction a
          // notification addressed to them. Recipient-scoping is strictly stronger
          // than visibility-scoping: a notification about a deal the user can no
          // longer see is still a notification they were sent.
          // (architecture.md:955 constraint 2 mandates resolveVisibilityFilter inside
          // subscribe; this is the documented exception, mirroring onTaskAssigned.)
          const channel = `${PUBSUB_NOTIFICATION_CREATED}:${user.tenantId}:${user.userId}`
          for await (const notification of pubsub.subscribe<NotificationShape>(channel)) {
            yield notification
          }
        },
      }
    },
    resolve: (payload: unknown) => payload as NotificationShape,
  }),
)

// ─── Module Registration ──────────────────────────────────

export function registerNotificationsGraphql(
  svc: NotificationsService,
  pubSub: NotificationPubSubService,
): void {
  notificationsService = svc
  notificationPubSub = pubSub
}
