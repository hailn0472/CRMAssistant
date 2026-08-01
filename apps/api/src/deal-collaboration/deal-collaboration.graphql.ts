import { UnauthorizedException } from '@nestjs/common'

/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types */

import { builder } from '../graphql/schema.builder'
import { requirePermission } from '../common/guards/permission-check'
import { PUBSUB_DEAL_COMMENT_ADDED } from './deal-comments.service'
import type { DealDocumentsService } from './deal-documents.service'
import type { DealCommentsService } from './deal-comments.service'
import type { DealsService } from '../deals/deals.service'
import type { DealPubSubService } from '../deals/deal-pubsub.service'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

// ─── MentionUser Type ──────────────────────────────────
// Shared shape for uploader / author / mentioned users (five fields).

type MentionUserShape = {
  id: string
  firstName: string
  lastName: string
  email: string
  avatar?: string | null
}

const MentionUserRef = builder.objectRef<MentionUserShape>('MentionUser')

MentionUserRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    firstName: t.exposeString('firstName'),
    lastName: t.exposeString('lastName'),
    email: t.exposeString('email'),
    avatar: t.string({
      nullable: true,
      resolve: (user) => user.avatar ?? null,
    }),
  }),
})

// ─── DealDocument Type ─────────────────────────────────

type DealDocumentShape = {
  id: string
  dealId: string
  fileName: string
  fileSize: number
  mimeType: string
  uploadedBy: string
  createdAt: Date
  uploader: MentionUserShape
}

const DealDocumentRef = builder.objectRef<DealDocumentShape>('DealDocument')

DealDocumentRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    dealId: t.exposeID('dealId'),
    fileName: t.exposeString('fileName'),
    fileSize: t.exposeInt('fileSize'),
    mimeType: t.exposeString('mimeType'),
    uploadedBy: t.exposeID('uploadedBy'),
    createdAt: t.string({ resolve: (doc) => doc.createdAt.toISOString() }),
    uploader: t.field({
      type: MentionUserRef,
      resolve: (doc) => doc.uploader as unknown as MentionUserShape,
    }),
  }),
})

// ─── DealComment Type ──────────────────────────────────

type DealCommentShape = {
  id: string
  dealId: string
  userId: string
  comment: string
  createdAt: Date
  author: MentionUserShape
  mentions: Array<{ mentionedUser: MentionUserShape }>
}

const DealCommentRef = builder.objectRef<DealCommentShape>('DealComment')

DealCommentRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    dealId: t.exposeID('dealId'),
    userId: t.exposeID('userId'),
    comment: t.exposeString('comment'),
    createdAt: t.string({ resolve: (comment) => comment.createdAt.toISOString() }),
    author: t.field({
      type: MentionUserRef,
      resolve: (comment) => comment.author as unknown as MentionUserShape,
    }),
    mentionedUsers: t.field({
      type: [MentionUserRef],
      resolve: (comment) =>
        (comment.mentions ?? []).map(
          (mention) => mention.mentionedUser as unknown as MentionUserShape,
        ),
    }),
  }),
})

// ─── DealCommentConnection Type ────────────────────────

type DealCommentConnectionShape = {
  items: DealCommentShape[]
  total: number
  page: number
  pageSize: number
}

const DealCommentConnectionRef =
  builder.objectRef<DealCommentConnectionShape>('DealCommentConnection')

DealCommentConnectionRef.implement({
  fields: (t) => ({
    items: t.field({ type: [DealCommentRef], resolve: (connection) => connection.items }),
    total: t.exposeInt('total'),
    page: t.exposeInt('page'),
    pageSize: t.exposeInt('pageSize'),
  }),
})

// ─── Inputs ────────────────────────────────────────────

const AddDealCommentInputRef = builder.inputType('AddDealCommentInput', {
  fields: (t) => ({
    dealId: t.string({ required: true }),
    comment: t.string({ required: true }),
  }),
})

const DealCommentPaginationInputRef = builder.inputType('DealCommentPaginationInput', {
  fields: (t) => ({
    page: t.int(),
    pageSize: t.int(),
  }),
})

// ─── Service Singletons ────────────────────────────────

let dealDocumentsService: DealDocumentsService | undefined
let dealCommentsService: DealCommentsService | undefined
let dealsService: DealsService | undefined
let dealPubSub: DealPubSubService | undefined

function getDealDocumentsService(): DealDocumentsService {
  if (!dealDocumentsService) {
    throw new Error('DealDocumentsService is not initialized')
  }
  return dealDocumentsService
}

function getDealCommentsService(): DealCommentsService {
  if (!dealCommentsService) {
    throw new Error('DealCommentsService is not initialized')
  }
  return dealCommentsService
}

function getDealsService(): DealsService {
  if (!dealsService) {
    throw new Error('DealsService is not initialized')
  }
  return dealsService
}

function getDealPubSub(): DealPubSubService {
  if (!dealPubSub) {
    throw new Error('DealPubSubService is not initialized')
  }
  return dealPubSub
}

function requireUser(context: GraphqlContext): JwtPayload {
  if (!context.user) {
    throw new UnauthorizedException('Authentication required')
  }
  return context.user
}

// ─── Queries ───────────────────────────────────────────
// Permission gates reuse the existing DEAL resource (AC 34): reading a deal's
// documents/comments is reading the deal; attaching a file or commenting is
// editing the deal. No new resource, no seed change.

builder.queryFields((t) => ({
  dealDocuments: t.field({
    type: [DealDocumentRef],
    args: { dealId: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'DEAL', 'READ')
      return getDealDocumentsService().findManyForDeal(
        user.tenantId,
        user.userId,
        String(args.dealId),
      ) as unknown as DealDocumentShape[]
    },
  }),

  dealComments: t.field({
    type: DealCommentConnectionRef,
    args: {
      dealId: t.arg.id({ required: true }),
      pagination: t.arg({ type: DealCommentPaginationInputRef }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'DEAL', 'READ')
      return getDealCommentsService().findManyForDeal(
        user.tenantId,
        user.userId,
        String(args.dealId),
        {
          page: args.pagination?.page ?? undefined,
          pageSize: args.pagination?.pageSize ?? undefined,
        },
      ) as unknown as DealCommentConnectionShape
    },
  }),

  dealDocumentDownloadUrl: t.string({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'DEAL', 'READ')
      return getDealDocumentsService().createDownloadUrl(
        user.tenantId,
        user.userId,
        String(args.id),
      )
    },
  }),

  dealMentionCandidates: t.field({
    type: [MentionUserRef],
    args: {
      dealId: t.arg.id({ required: true }),
      search: t.arg.string(),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      // Gated on DEAL:READ, NOT USER:READ — SALES_REP has DEAL:* but no
      // USER:READ grant, so driving the mention picker off the existing users
      // query would make @mentions silently unusable for the primary persona.
      await requirePermission(context, 'DEAL', 'READ')
      return getDealCommentsService().mentionCandidates(
        user.tenantId,
        user.userId,
        String(args.dealId),
        args.search ?? undefined,
      ) as unknown as MentionUserShape[]
    },
  }),
}))

// ─── Mutations ─────────────────────────────────────────

builder.mutationFields((t) => ({
  deleteDealDocument: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'DEAL', 'UPDATE')
      return getDealDocumentsService().delete(user.tenantId, user.userId, String(args.id))
    },
  }),

  addDealComment: t.field({
    type: DealCommentRef,
    args: { input: t.arg({ type: AddDealCommentInputRef, required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'DEAL', 'UPDATE')
      return getDealCommentsService().add(user.tenantId, user.userId, {
        dealId: args.input.dealId,
        comment: args.input.comment,
      }) as unknown as DealCommentShape
    },
  }),

  deleteDealComment: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'DEAL', 'UPDATE')
      return getDealCommentsService().delete(
        user.tenantId,
        user.userId,
        String(args.id),
        user.roles,
      )
    },
  }),
}))

// ─── Subscriptions ─────────────────────────────────────

builder.subscriptionField('onDealCommentAdded', (t) =>
  t.field({
    type: DealCommentRef,
    args: { dealId: t.arg.id({ required: true }) },
    subscribe: async (_root, args, context) => {
      const user = requireUser(context)
      // Resolve access inside `subscribe`, once: DealsService.findOne applies
      // tenant scope AND resolveVisibilityFilter. No inline per-event filter is
      // needed because access was resolved for the specific deal at subscribe
      // time — this follows onNewMessage, not the tenant-wide onDealUpdated
      // firehose. Do not "fix" this.
      await getDealsService().findOne(user.tenantId, user.userId, String(args.dealId))
      return getDealPubSub().subscribe(
        `${PUBSUB_DEAL_COMMENT_ADDED}:${user.tenantId}:${String(args.dealId)}`,
      )
    },
    resolve: (payload: unknown) => payload as DealCommentShape,
  }),
)

// ─── Registration ──────────────────────────────────────

export function registerDealCollaborationGraphql(
  documentsService: DealDocumentsService,
  commentsService: DealCommentsService,
  dealsSvc: DealsService,
  pubSubService: DealPubSubService,
): void {
  dealDocumentsService = documentsService
  dealCommentsService = commentsService
  dealsService = dealsSvc
  dealPubSub = pubSubService
}
