import { UnauthorizedException } from '@nestjs/common'

import { builder } from '../graphql/schema.builder'
import type { ActivityService } from './activities.service'
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
  },
})

type ActivityTypeValue = 'EMAIL_SENT' | 'CALL_MADE' | 'MEETING_SCHEDULED' | 'NOTE_ADDED' | 'DEAL_CREATED' | 'CONTACT_CREATED' | 'CONTACT_UPDATED'

// Activity GraphQL type
type ActivityShape = {
  id: string
  contactId: string
  type: ActivityTypeValue
  title: string
  description: string | null
  createdAt: string
  createdBy: string
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

const ContactTimelineResultRef = builder.objectRef<ContactTimelineResultShape>('ContactTimelineResult')

ContactTimelineResultRef.implement({
  fields: (t) => ({
    edges: t.field({ type: [ActivityEdgeRef], resolve: (result) => result.edges }),
    pageInfo: t.field({ type: PageInfoRef, resolve: (result) => result.pageInfo }),
    totalCount: t.exposeInt('totalCount'),
  }),
})

let activityService: ActivityService | undefined

function getActivityService(): ActivityService {
  if (!activityService) {
    throw new Error('ActivityService is not initialized')
  }
  return activityService
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

      const result = await getActivityService().log({
        tenantId: user.tenantId,
        contactId: String(args.contactId),
        type: 'NOTE_ADDED',
        title: args.title,
        description: args.description ?? null,
        createdBy: user.userId,
      })
      return {
        id: result.id,
        contactId: result.contactId,
        type: result.type as ActivityTypeValue,
        title: result.title,
        description: result.description,
        createdAt: result.createdAt.toISOString(),
        createdBy: result.createdBy,
      }
    },
  }),
}))

export function registerActivityGraphql(service: ActivityService): void {
  activityService = service
}
