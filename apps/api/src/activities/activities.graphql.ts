import { UnauthorizedException } from '@nestjs/common'

/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types */

import { builder } from '../graphql/schema.builder'
import type { ActivityService } from './activities.service'
import type {
  ActivityLogPreferenceService,
  ActivityLogPreferenceInput,
} from './activity-log-preference.service'
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
}

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
  }),
})

const UpdateActivityLogPreferenceInputRef = builder.inputType('UpdateActivityLogPreferenceInput', {
  fields: (t) => ({
    logTaskCompleted: t.boolean(),
    logDealCreated: t.boolean(),
    logDealStageChanged: t.boolean(),
    logMessageSent: t.boolean(),
    logMessageReceived: t.boolean(),
  }),
})

// ─── Service Singletons ──────────────────────────────────────────────────

let activityService: ActivityService | undefined
let activityLogPreferenceService: ActivityLogPreferenceService | undefined

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

export function registerActivityGraphql(
  service: ActivityService,
  preferenceService: ActivityLogPreferenceService,
): void {
  activityService = service
  activityLogPreferenceService = preferenceService
}
