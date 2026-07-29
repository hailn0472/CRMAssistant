import { UnauthorizedException, ForbiddenException } from '@nestjs/common'

/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types */

import { builder } from '../graphql/schema.builder'
import { requirePermission } from '../common/guards/permission-check'
import type { DealsService } from './deals.service'
import type { DealStageService } from './deal-stages.service'
import type { DealPubSubService } from './deal-pubsub.service'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'
import { resolveVisibilityFilter } from '../common/guards/visibility-check'

// ─── DealStage Type ──────────────────────────────────────

type DealStageGraphqlShape = {
  id: string
  name: string
  order: number
  probability: number
  isWon: boolean
  isLost: boolean
  color: string
}

const DealStageRef = builder.objectRef<DealStageGraphqlShape>('DealStage')

DealStageRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    order: t.exposeInt('order'),
    probability: t.exposeInt('probability'),
    isWon: t.exposeBoolean('isWon'),
    isLost: t.exposeBoolean('isLost'),
    color: t.exposeString('color'),
  }),
})

// ─── Deal Type ───────────────────────────────────────────

type OwnerShape = {
  id: string
  firstName: string
  lastName: string
  email: string
  avatar?: string | null
}

const OwnerRef = builder.objectRef<OwnerShape>('DealOwner')

OwnerRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    firstName: t.exposeString('firstName'),
    lastName: t.exposeString('lastName'),
    email: t.exposeString('email'),
    avatar: t.string({
      nullable: true,
      resolve: (owner) => owner.avatar ?? null,
    }),
  }),
})

type ContactShape = {
  id: string
  firstName: string
  lastName: string
  email: string
}

const ContactRef = builder.objectRef<ContactShape>('DealContact')

ContactRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    firstName: t.exposeString('firstName'),
    lastName: t.exposeString('lastName'),
    email: t.exposeString('email'),
  }),
})

type StageShape = {
  id: string
  name: string
  color: string
  probability: number
  isWon: boolean
  isLost: boolean
}

const StageInfoRef = builder.objectRef<StageShape>('DealStageInfo')

StageInfoRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    color: t.exposeString('color'),
    probability: t.exposeInt('probability'),
    isWon: t.exposeBoolean('isWon'),
    isLost: t.exposeBoolean('isLost'),
  }),
})

type DealGraphqlShape = {
  id: string
  title: string
  value: number
  currency: string
  probability: number
  stageId: string
  contactId: string
  ownerId: string
  expectedCloseDate: Date | null
  actualCloseDate: Date | null
  createdAt: Date
  updatedAt: Date
  stage?: StageShape | null
  contact?: ContactShape | null
  owner?: OwnerShape | null
}

const DealRef = builder.objectRef<DealGraphqlShape>('Deal')

DealRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    title: t.exposeString('title'),
    value: t.exposeFloat('value'),
    currency: t.exposeString('currency'),
    probability: t.exposeInt('probability'),
    stageId: t.exposeID('stageId'),
    contactId: t.exposeID('contactId'),
    ownerId: t.exposeID('ownerId'),
    expectedCloseDate: t.string({
      nullable: true,
      resolve: (deal) => deal.expectedCloseDate?.toISOString() ?? null,
    }),
    actualCloseDate: t.string({
      nullable: true,
      resolve: (deal) => deal.actualCloseDate?.toISOString() ?? null,
    }),
    stage: t.field({
      type: StageInfoRef,
      nullable: true,
      resolve: (deal) => {
        if ('stage' in deal && deal.stage) {
          return deal.stage as unknown as StageShape
        }
        return null
      },
    }),
    contact: t.field({
      type: ContactRef,
      nullable: true,
      resolve: (deal) => {
        if ('contact' in deal && deal.contact) {
          return deal.contact as unknown as ContactShape
        }
        return null
      },
    }),
    owner: t.field({
      type: OwnerRef,
      nullable: true,
      resolve: (deal) => {
        if ('owner' in deal && deal.owner) {
          return deal.owner as unknown as OwnerShape
        }
        return null
      },
    }),
    createdAt: t.string({ resolve: (deal) => deal.createdAt.toISOString() }),
    updatedAt: t.string({ resolve: (deal) => deal.updatedAt.toISOString() }),
  }),
})

// ─── DealConnection Type ─────────────────────────────────

const DealConnectionRef = builder
  .objectRef<{
    items: DealGraphqlShape[]
    total: number
    page: number
    pageSize: number
  }>('DealConnection')
  .implement({
    fields: (t) => ({
      items: t.field({ type: [DealRef], resolve: (connection) => connection.items }),
      total: t.exposeInt('total'),
      page: t.exposeInt('page'),
      pageSize: t.exposeInt('pageSize'),
    }),
  })

// ─── Input Types ─────────────────────────────────────────

const CreateDealInputRef = builder.inputType('CreateDealInput', {
  fields: (t) => ({
    title: t.string({ required: true }),
    value: t.float(),
    currency: t.string(),
    stageId: t.string({ required: true }),
    contactId: t.string({ required: true }),
    ownerId: t.string(),
    expectedCloseDate: t.string(),
  }),
})

const UpdateDealInputRef = builder.inputType('UpdateDealInput', {
  fields: (t) => ({
    title: t.string(),
    value: t.float(),
    currency: t.string(),
    probability: t.int(),
    stageId: t.string(),
    contactId: t.string(),
    expectedCloseDate: t.string(),
    actualCloseDate: t.string(),
  }),
})

const DealFilterInputRef = builder.inputType('DealFilterInput', {
  fields: (t) => ({
    search: t.string(),
    stageId: t.string(),
    contactId: t.string(),
    ownerId: t.string(),
    expectedCloseDateFrom: t.string(),
    expectedCloseDateTo: t.string(),
  }),
})

const DealPaginationInputRef = builder.inputType('DealPaginationInput', {
  fields: (t) => ({
    page: t.int(),
    pageSize: t.int(),
  }),
})

// ─── Service Singletons ──────────────────────────────────

let dealsService: DealsService | undefined
let dealStagesService: DealStageService | undefined
let dealPubSub: DealPubSubService | undefined

function getDealsService(): DealsService {
  if (!dealsService) {
    throw new Error('DealsService is not initialized')
  }
  return dealsService
}

function getDealStagesService(): DealStageService {
  if (!dealStagesService) {
    throw new Error('DealStageService is not initialized')
  }
  return dealStagesService
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

function isAdmin(context: GraphqlContext): boolean {
  const user = requireUser(context)
  if (!user.roles.includes('ADMIN')) {
    throw new ForbiddenException('Admin access required')
  }
  return true
}

// ─── DealStageSummary Type ───────────────────────────────

type DealStageSummaryShape = {
  stageId: string
  count: number
  totalValue: number
}

const DealStageSummaryRef = builder.objectRef<DealStageSummaryShape>('DealStageSummary')

DealStageSummaryRef.implement({
  fields: (t) => ({
    stageId: t.exposeID('stageId'),
    count: t.exposeInt('count'),
    totalValue: t.exposeFloat('totalValue'),
  }),
})

// ─── Queries ─────────────────────────────────────────────

builder.queryFields((t) => ({
  deal: t.field({
    type: DealRef,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      return getDealsService().findOne(
        user.tenantId,
        user.userId,
        String(args.id),
      ) as unknown as DealGraphqlShape
    },
  }),
  deals: t.field({
    type: DealConnectionRef,
    args: {
      filter: t.arg({ type: DealFilterInputRef }),
      pagination: t.arg({ type: DealPaginationInputRef }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      return getDealsService().findMany(
        user.tenantId,
        user.userId,
        {
          search: args.filter?.search ?? undefined,
          stageId: args.filter?.stageId ?? undefined,
          contactId: args.filter?.contactId ?? undefined,
          ownerId: args.filter?.ownerId ?? undefined,
          expectedCloseDateFrom: args.filter?.expectedCloseDateFrom ?? undefined,
          expectedCloseDateTo: args.filter?.expectedCloseDateTo ?? undefined,
        },
        {
          page: args.pagination?.page ?? undefined,
          pageSize: args.pagination?.pageSize ?? undefined,
        },
      )
    },
  }),
  dealStages: t.field({
    type: [DealStageRef],
    resolve: async (_parent, _args, context) => {
      const user = requireUser(context)
      return getDealStagesService().findMany(user.tenantId)
    },
  }),
  dealPipelineSummary: t.field({
    type: [DealStageSummaryRef],
    args: {
      filter: t.arg({ type: DealFilterInputRef }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      return getDealsService().pipelineSummary(user.tenantId, user.userId, {
        search: args.filter?.search ?? undefined,
        stageId: args.filter?.stageId ?? undefined,
        contactId: args.filter?.contactId ?? undefined,
        ownerId: args.filter?.ownerId ?? undefined,
        expectedCloseDateFrom: args.filter?.expectedCloseDateFrom ?? undefined,
        expectedCloseDateTo: args.filter?.expectedCloseDateTo ?? undefined,
      })
    },
  }),
}))

// ─── Mutations ───────────────────────────────────────────

builder.mutationFields((t) => ({
  createDeal: t.field({
    type: DealRef,
    args: { input: t.arg({ type: CreateDealInputRef, required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'DEAL', 'CREATE')
      return getDealsService().create(user.tenantId, user.userId, {
        title: args.input.title,
        value: args.input.value ?? undefined,
        currency: args.input.currency ?? undefined,
        stageId: args.input.stageId,
        contactId: args.input.contactId,
        ownerId: args.input.ownerId ?? undefined,
        expectedCloseDate: args.input.expectedCloseDate ?? undefined,
      }) as unknown as DealGraphqlShape
    },
  }),
  updateDeal: t.field({
    type: DealRef,
    args: {
      id: t.arg.id({ required: true }),
      input: t.arg({ type: UpdateDealInputRef, required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'DEAL', 'UPDATE')
      return getDealsService().update(user.tenantId, user.userId, String(args.id), {
        title: args.input.title ?? undefined,
        value: args.input.value ?? undefined,
        currency: args.input.currency ?? undefined,
        probability: args.input.probability ?? undefined,
        stageId: args.input.stageId ?? undefined,
        contactId: args.input.contactId ?? undefined,
        expectedCloseDate: args.input.expectedCloseDate ?? undefined,
        actualCloseDate: args.input.actualCloseDate ?? undefined,
      }) as unknown as DealGraphqlShape
    },
  }),
  deleteDeal: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'DEAL', 'DELETE')
      return getDealsService().delete(user.tenantId, user.userId, String(args.id))
    },
  }),
  moveDealToStage: t.field({
    type: DealRef,
    args: {
      dealId: t.arg.id({ required: true }),
      stageId: t.arg.id({ required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'DEAL', 'UPDATE')
      return getDealsService().moveToStage(
        user.tenantId,
        user.userId,
        String(args.dealId),
        String(args.stageId),
      ) as unknown as DealGraphqlShape
    },
  }),
  // Admin-only stage mutations
  createDealStage: t.field({
    type: DealStageRef,
    args: {
      name: t.arg.string({ required: true }),
      color: t.arg.string(),
      probability: t.arg.int(),
      isWon: t.arg.boolean(),
      isLost: t.arg.boolean(),
    },
    resolve: async (_parent, args, context) => {
      isAdmin(context)
      const user = requireUser(context)
      return getDealStagesService().create(user.tenantId, {
        name: args.name,
        color: args.color ?? undefined,
        probability: args.probability ?? undefined,
        isWon: args.isWon ?? undefined,
        isLost: args.isLost ?? undefined,
      })
    },
  }),
  updateDealStage: t.field({
    type: DealStageRef,
    args: {
      id: t.arg.id({ required: true }),
      name: t.arg.string(),
      color: t.arg.string(),
      probability: t.arg.int(),
      isWon: t.arg.boolean(),
      isLost: t.arg.boolean(),
    },
    resolve: async (_parent, args, context) => {
      isAdmin(context)
      const user = requireUser(context)
      return getDealStagesService().update(user.tenantId, String(args.id), {
        name: args.name ?? undefined,
        color: args.color ?? undefined,
        probability: args.probability ?? undefined,
        isWon: args.isWon ?? undefined,
        isLost: args.isLost ?? undefined,
      })
    },
  }),
  deleteDealStage: t.boolean({
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      isAdmin(context)
      const user = requireUser(context)
      await getDealStagesService().delete(user.tenantId, String(args.id))
      return true
    },
  }),
  reorderDealStages: t.field({
    type: [DealStageRef],
    args: {
      stageIds: t.arg.idList({ required: true }),
    },
    resolve: async (_parent, args, context) => {
      isAdmin(context)
      const user = requireUser(context)
      return getDealStagesService().reorder(user.tenantId, args.stageIds.map(String))
    },
  }),
}))

// ─── Subscriptions ───────────────────────────────────────

builder.subscriptionField('onDealUpdated', (t) =>
  t.field({
    type: DealRef,
    subscribe: async (_root, _args, context) => {
      const user = requireUser(context)
      const visibility = await resolveVisibilityFilter(user.userId, user.tenantId)
      const pubsub = getDealPubSub()
      return {
        [Symbol.asyncIterator]: async function* () {
          const channel = `DEAL_UPDATED:${user.tenantId}`
          for await (const deal of pubsub.subscribe<DealGraphqlShape>(channel)) {
            // Apply visibility filter: yield only deals the subscriber may see
            if (visibility === undefined) {
              yield deal // ADMIN/ALL — yield everything
            } else if (typeof visibility === 'string') {
              if (deal.ownerId === visibility) yield deal // OWN — only own deals
            } else if ('in' in visibility) {
              const allowedIds = (visibility as { in: string[] }).in
              if (allowedIds.includes(deal.ownerId)) yield deal // TEAM
            }
          }
        },
      }
    },
    resolve: (payload: unknown) => payload as DealGraphqlShape,
  }),
)

// ─── Registration ────────────────────────────────────────

export function registerDealGraphql(
  service: DealsService,
  stagesService: DealStageService,
  pubSubService: DealPubSubService,
): void {
  dealsService = service
  dealStagesService = stagesService
  dealPubSub = pubSubService
}
