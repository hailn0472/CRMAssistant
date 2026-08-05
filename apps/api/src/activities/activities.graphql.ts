import { UnauthorizedException } from '@nestjs/common'

/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types */

import { builder } from '../graphql/schema.builder'
import { requirePermission } from '../common/guards/permission-check'
import { resolveVisibilityFilter } from '../common/guards/visibility-check'
import { resolveSharedRecordIds } from '../common/guards/sharing-check'
import { getTasksService } from '../tasks/tasks.graphql'
import { filterActivityFeedEvents } from './activity-feed-visibility'
import { PUBSUB_ACTIVITY_LOGGED } from './activity-pubsub.service'
import type { ActivityService, ActivityFeedItem } from './activities.service'
import type {
  ActivityLogPreferenceService,
  ActivityLogPreferenceInput,
} from './activity-log-preference.service'
import type { ActivityPubSubService } from './activity-pubsub.service'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

// GraphQL enum for ActivityType (values match Prisma ActivityType)
const ActivityTypeEnum = builder.enumType('ActivityType', {
  values: {
    EMAIL_SENT: { value: 'EMAIL_SENT' as const },
    CALL_MADE: { value: 'CALL_MADE' as const },
    MEETING_SCHEDULED: { value: 'MEETING_SCHEDULED' as const },
    NOTE_ADDED: { value: 'NOTE_ADDED' as const },
    DEAL_CREATED: { value: 'DEAL_CREATED' as const },
    CONTACT_CREATED: { value: 'CONTACT_CREATED' as const },
    CONTACT_UPDATED: { value: 'CONTACT_UPDATED' as const },
    CONTACT_OWNER_CHANGED: { value: 'CONTACT_OWNER_CHANGED' as const },
    // Story 4.2 auto-logged types (AC 36)
    TASK_COMPLETED: { value: 'TASK_COMPLETED' as const },
    DEAL_STAGE_CHANGED: { value: 'DEAL_STAGE_CHANGED' as const },
    MESSAGE_RECEIVED: { value: 'MESSAGE_RECEIVED' as const },
    MESSAGE_SENT: { value: 'MESSAGE_SENT' as const },
  },
})

type ActivityTypeValue =
  | 'EMAIL_SENT'
  | 'CALL_MADE'
  | 'MEETING_SCHEDULED'
  | 'NOTE_ADDED'
  | 'DEAL_CREATED'
  | 'CONTACT_CREATED'
  | 'CONTACT_UPDATED'
  | 'CONTACT_OWNER_CHANGED'
  | 'TASK_COMPLETED'
  | 'DEAL_STAGE_CHANGED'
  | 'MESSAGE_RECEIVED'
  | 'MESSAGE_SENT'

// Activity GraphQL type
type ActivityShape = {
  id: string
  contactId: string
  type: ActivityTypeValue
  title: string
  description: string | null
  createdAt: string
  createdBy: string
  source: string | null
  // Story 4.4 (AC 10): exposed by the feed select; nullable so
  // contactTimeline (which does not select them) keeps working.
  sourceId?: string | null
  contact?: ActivityContactShape | null
}

// Story 4.4 (AC 10): the nested contact identity for the feed. There is no
// @pothos/plugin-prisma, so this is a hand-written objectRef — the shape to
// copy is TaskContact/TaskDeal in tasks.graphql.ts.
type ActivityContactShape = {
  id: string
  firstName: string
  lastName: string
}

const ActivityContactRef = builder.objectRef<ActivityContactShape>('ActivityContact')

ActivityContactRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    firstName: t.exposeString('firstName'),
    lastName: t.exposeString('lastName'),
  }),
})

const ActivityRef = builder.objectRef<ActivityShape>('Activity')

ActivityRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    contactId: t.exposeID('contactId'),
    type: t.field({
      type: ActivityTypeEnum,
      resolve: (parent) => parent.type,
    }),
    title: t.exposeString('title'),
    description: t.exposeString('description', { nullable: true }),
    createdAt: t.exposeString('createdAt'),
    createdBy: t.exposeString('createdBy'),
    // Story 4.2: auto-vs-manual discriminator (AC 3). `metadata` is
    // deliberately NOT exposed — no JSON scalar is registered in this schema
    // (AC 5).
    source: t.exposeString('source', { nullable: true }),
    // Story 4.4 (AC 10): `sourceId` powers the Timeline view's source links
    // (TASK → /tasks/:id, DEAL → /deals/:id). Nullable so contactTimeline
    // payloads (which never select it) resolve to null instead of crashing.
    sourceId: t.exposeString('sourceId', { nullable: true }),
    contact: t.field({
      type: ActivityContactRef,
      nullable: true,
      resolve: (parent) =>
        'contact' in parent && parent.contact ? (parent.contact as ActivityContactShape) : null,
    }),
  }),
})

// Edge type for connection
type ActivityEdgeShape = {
  cursor: string
  node: ActivityShape
}

const ActivityEdgeRef = builder.objectRef<ActivityEdgeShape>('ActivityEdge')

ActivityEdgeRef.implement({
  fields: (t) => ({
    cursor: t.exposeString('cursor'),
    node: t.field({ type: ActivityRef, resolve: (edge) => edge.node }),
  }),
})

// PageInfo type
type PageInfoShape = {
  hasNextPage: boolean
  endCursor: string | null
}

const PageInfoRef = builder.objectRef<PageInfoShape>('ActivityPageInfo')

PageInfoRef.implement({
  fields: (t) => ({
    hasNextPage: t.exposeBoolean('hasNextPage'),
    endCursor: t.exposeString('endCursor', { nullable: true }),
  }),
})

// Timeline connection result
type ContactTimelineResultShape = {
  edges: ActivityEdgeShape[]
  pageInfo: PageInfoShape
  totalCount: number
}

const ContactTimelineResultRef =
  builder.objectRef<ContactTimelineResultShape>('ContactTimelineResult')

ContactTimelineResultRef.implement({
  fields: (t) => ({
    edges: t.field({ type: [ActivityEdgeRef], resolve: (result) => result.edges }),
    pageInfo: t.field({ type: PageInfoRef, resolve: (result) => result.pageInfo }),
    totalCount: t.exposeInt('totalCount'),
  }),
})

// ─── ActivityLogPreference Type (AC 37) ──────────────────────────────────

type ActivityLogPreferenceShape = {
  logTaskCompleted: boolean
  logDealCreated: boolean
  logDealStageChanged: boolean
  logMessageSent: boolean
  logMessageReceived: boolean
  logMeetingScheduled: boolean
}

const ActivityLogPreferenceRef =
  builder.objectRef<ActivityLogPreferenceShape>('ActivityLogPreference')

ActivityLogPreferenceRef.implement({
  fields: (t) => ({
    logTaskCompleted: t.exposeBoolean('logTaskCompleted'),
    logDealCreated: t.exposeBoolean('logDealCreated'),
    logDealStageChanged: t.exposeBoolean('logDealStageChanged'),
    logMessageSent: t.exposeBoolean('logMessageSent'),
    logMessageReceived: t.exposeBoolean('logMessageReceived'),
    // Story 4.3 (AC 8): MEETING_SCHEDULED preference gate.
    logMeetingScheduled: t.exposeBoolean('logMeetingScheduled'),
  }),
})

const UpdateActivityLogPreferenceInputRef = builder.inputType('UpdateActivityLogPreferenceInput', {
  fields: (t) => ({
    logTaskCompleted: t.boolean(),
    logDealCreated: t.boolean(),
    logDealStageChanged: t.boolean(),
    logMessageSent: t.boolean(),
    logMessageReceived: t.boolean(),
    logMeetingScheduled: t.boolean(),
  }),
})

// ─── Story 4.4: tenant-wide feed (AC 7, 10, 11, 13) ──────────────────────

const ActivityFeedFilterInputRef = builder.inputType('ActivityFeedFilterInput', {
  fields: (t) => ({
    // Reuses the existing ActivityType enum — never declare a second one.
    type: t.field({ type: ActivityTypeEnum }),
    source: t.string(),
    contactId: t.string(),
    createdBy: t.string(),
    createdFrom: t.string(),
    createdTo: t.string(),
    search: t.string(),
  }),
})

const ActivityFeedPaginationInputRef = builder.inputType('ActivityFeedPaginationInput', {
  fields: (t) => ({
    page: t.int(),
    pageSize: t.int(),
  }),
})

const ActivityFeedConnectionRef = builder
  .objectRef<{
    items: ActivityShape[]
    total: number
    page: number
    pageSize: number
  }>('ActivityFeedConnection')
  .implement({
    fields: (t) => ({
      items: t.field({ type: [ActivityRef], resolve: (connection) => connection.items }),
      total: t.exposeInt('total'),
      page: t.exposeInt('page'),
      pageSize: t.exposeInt('pageSize'),
    }),
  })

const ActivityFeedStatsRef = builder
  .objectRef<{
    todayCount: number
    weekCount: number
    tasksDueToday: number
    overdueTasks: number
  }>('ActivityFeedStats')
  .implement({
    fields: (t) => ({
      todayCount: t.exposeInt('todayCount'),
      weekCount: t.exposeInt('weekCount'),
      tasksDueToday: t.exposeInt('tasksDueToday'),
      overdueTasks: t.exposeInt('overdueTasks'),
    }),
  })

function mapFeedItem(item: ActivityFeedItem): ActivityShape {
  return {
    id: item.id,
    contactId: item.contactId,
    type: item.type as ActivityTypeValue,
    title: item.title,
    description: item.description,
    createdAt: item.createdAt.toISOString(),
    createdBy: item.createdBy,
    source: item.source,
    sourceId: item.sourceId ?? null,
    contact: item.contact ?? null,
  }
}

// ─── Service Singletons ──────────────────────────────────────────────────

let activityService: ActivityService | undefined
let activityLogPreferenceService: ActivityLogPreferenceService | undefined
let activityPubSub: ActivityPubSubService | undefined

function getActivityService(): ActivityService {
  if (!activityService) {
    throw new Error('ActivityService is not initialized')
  }
  return activityService
}

function getActivityLogPreferenceService(): ActivityLogPreferenceService {
  if (!activityLogPreferenceService) {
    throw new Error('ActivityLogPreferenceService is not initialized')
  }
  return activityLogPreferenceService
}

function getActivityPubSub(): ActivityPubSubService {
  if (!activityPubSub) {
    throw new Error('ActivityPubSubService is not initialized')
  }
  return activityPubSub
}

function requireUser(context: GraphqlContext): JwtPayload {
  if (!context.user) {
    throw new UnauthorizedException('Authentication required')
  }
  return context.user
}

// --- Queries ---
builder.queryFields((t) => ({
  contactTimeline: t.field({
    type: ContactTimelineResultRef,
    args: {
      contactId: t.arg.id({ required: true }),
      first: t.arg.int({ required: false }),
      after: t.arg.string({ required: false }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)

      // Security: verify user has access to this contact
      await getActivityService().checkContactAccess(
        user.tenantId,
        user.userId,
        String(args.contactId),
      )

      const result = await getActivityService().findByContact(
        user.tenantId,
        String(args.contactId),
        {
          first: args.first ?? undefined,
          after: args.after ?? undefined,
          includeTotalCount: true, // compute totalCount in same transaction as data
        },
      )

      const contactId = String(args.contactId)
      return {
        edges: result.edges.map((edge) => ({
          cursor: edge.cursor,
          node: { ...edge.node, contactId, type: edge.node.type as ActivityTypeValue },
        })),
        pageInfo: result.pageInfo,
        totalCount: result.totalCount,
      }
    },
  }),
  // Story 4.2 (AC 37-38): gated by requireUser ONLY — no requirePermission.
  // Reads exactly one row scoped to the caller's own userId; the settings-nav
  // precedent for per-user preferences is explicit ("every user manages their
  // own preferences").
  myActivityLogPreferences: t.field({
    type: ActivityLogPreferenceRef,
    resolve: async (_parent, _args, context) => {
      const user = requireUser(context)
      return getActivityLogPreferenceService().findMine(
        user.tenantId,
        user.userId,
      ) as unknown as ActivityLogPreferenceShape
    },
  }),
  // Story 4.4 (AC 4-13): tenant-wide, visibility-scoped feed. Gated by
  // CONTACT:READ — activities are contact-derived records and CONTACT is an
  // existing resource (AC 13). No ACTIVITY resource exists (T8).
  activityFeed: t.field({
    type: ActivityFeedConnectionRef,
    args: {
      filter: t.arg({ type: ActivityFeedFilterInputRef }),
      pagination: t.arg({ type: ActivityFeedPaginationInputRef }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'CONTACT', 'READ')

      const result = await getActivityService().findFeed(
        user.tenantId,
        user.userId,
        {
          type: args.filter?.type ?? undefined,
          source: args.filter?.source ?? undefined,
          contactId: args.filter?.contactId ?? undefined,
          createdBy: args.filter?.createdBy ?? undefined,
          createdFrom: args.filter?.createdFrom ?? undefined,
          createdTo: args.filter?.createdTo ?? undefined,
          search: args.filter?.search ?? undefined,
        },
        {
          page: args.pagination?.page ?? undefined,
          pageSize: args.pagination?.pageSize ?? undefined,
        },
      )

      return {
        items: result.items.map(mapFeedItem),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      }
    },
  }),
  // Story 4.4 (AC 11): composed in the resolver — getFeedStats returns the
  // activity counters, TasksService.getStats (same visibility scope, same
  // toUtcMidnight day maths) the task counters. Composing here avoids the
  // ActivitiesModule → TasksModule cycle (T8b).
  activityFeedStats: t.field({
    type: ActivityFeedStatsRef,
    resolve: async (_parent, _args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'CONTACT', 'READ')

      const [activityStats, taskStats] = await Promise.all([
        getActivityService().getFeedStats(user.tenantId, user.userId),
        getTasksService().getStats(user.tenantId, user.userId),
      ])

      return {
        todayCount: activityStats.todayCount,
        weekCount: activityStats.weekCount,
        tasksDueToday: taskStats.dueToday,
        overdueTasks: taskStats.overdue,
      }
    },
  }),
}))

// --- Mutations ---
builder.mutationFields((t) => ({
  addContactNote: t.field({
    type: ActivityRef,
    args: {
      contactId: t.arg.id({ required: true }),
      title: t.arg.string({ required: true }),
      description: t.arg.string({ required: false }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)

      // Security: verify user has access to this contact
      await getActivityService().checkContactAccess(
        user.tenantId,
        user.userId,
        String(args.contactId),
      )

      // Story 4.2 (AC 43): manual notes go through addContactNote so the
      // service writes the AuditLog row itself (the global AuditInterceptor
      // never fires for GraphQL mutations — AC 42).
      const result = await getActivityService().addContactNote({
        tenantId: user.tenantId,
        contactId: String(args.contactId),
        title: args.title,
        description: args.description ?? null,
        userId: user.userId,
      })
      return {
        id: result.id,
        contactId: result.contactId,
        type: result.type as ActivityTypeValue,
        title: result.title,
        description: result.description,
        createdAt: result.createdAt.toISOString(),
        createdBy: result.createdBy,
        source: result.source,
      }
    },
  }),
  // Story 4.2 (AC 37-38, AC 41): requireUser only; the service writes the
  // audit row (action UPDATE / entity USER) — see AC 42 for why the
  // MUTATION_AUDIT_MAP entry alone is not enough.
  updateActivityLogPreferences: t.field({
    type: ActivityLogPreferenceRef,
    args: { input: t.arg({ type: UpdateActivityLogPreferenceInputRef, required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      return getActivityLogPreferenceService().updateMine(
        user.tenantId,
        user.userId,
        args.input as ActivityLogPreferenceInput,
      ) as unknown as ActivityLogPreferenceShape
    },
  }),
}))

// ─── Subscriptions ────────────────────────────────────────

// Story 4.4 (AC 14-17): tenant-wide onActivityLogged. The visibility filter
// (AC 15) is resolved ONCE at subscribe time — resolveVisibilityFilter and
// resolveSharedRecordIds run before the iterator starts, and every event is
// compared in memory against those pre-resolved values. ZERO database reads
// per event. contactOwnerId is transport-internal; ActivityRef never exposes
// it (AC 16).
builder.subscriptionField('onActivityLogged', (t) =>
  t.field({
    type: ActivityRef,
    subscribe: async (_root, _args, context) => {
      const user = requireUser(context)
      const visibility = await resolveVisibilityFilter(user.userId, user.tenantId)
      const sharedContactIds = await resolveSharedRecordIds(user.userId, user.tenantId, 'CONTACT')
      const channel = `${PUBSUB_ACTIVITY_LOGGED}:${user.tenantId}`
      return filterActivityFeedEvents(
        getActivityPubSub().subscribe<ActivityShape & { contactOwnerId: string | null }>(channel),
        visibility,
        sharedContactIds,
      )
    },
    resolve: (payload: unknown) => {
      const { contactOwnerId: _contactOwnerId, ...rest } = payload as ActivityShape & {
        contactOwnerId: string | null
      }
      void _contactOwnerId
      return rest as ActivityShape
    },
  }),
)

export function registerActivityGraphql(
  service: ActivityService,
  preferenceService: ActivityLogPreferenceService,
  pubSubService: ActivityPubSubService,
): void {
  activityService = service
  activityLogPreferenceService = preferenceService
  activityPubSub = pubSubService
}
