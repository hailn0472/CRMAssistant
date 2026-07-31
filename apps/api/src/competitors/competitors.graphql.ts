import { UnauthorizedException } from '@nestjs/common'

/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types */

import { builder } from '../graphql/schema.builder'
import { requirePermission } from '../common/guards/permission-check'
import { WIN_LOSS_REASONS } from './win-loss-reasons'
// Value import: recordWinLoss returns DealRef, and importing deals.graphql here
// also makes the Deal field registration independent of app.module.ts order.
import { DealRef, type DealGraphqlShape } from '../deals/deals.graphql'
import type { CompetitorsService } from './competitors.service'
import type { DealCompetitorsService } from './deal-competitors.service'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

// ─── Competitor Type ──────────────────────────────────────

type CompetitorGraphqlShape = {
  id: string
  name: string
  website: string | null
  strengths: string | null
  weaknesses: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

const CompetitorRef = builder.objectRef<CompetitorGraphqlShape>('Competitor')

CompetitorRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    website: t.string({
      nullable: true,
      resolve: (c) => c.website ?? null,
    }),
    strengths: t.string({
      nullable: true,
      resolve: (c) => c.strengths ?? null,
    }),
    weaknesses: t.string({
      nullable: true,
      resolve: (c) => c.weaknesses ?? null,
    }),
    isActive: t.exposeBoolean('isActive'),
    createdAt: t.string({ resolve: (c) => c.createdAt.toISOString() }),
    updatedAt: t.string({ resolve: (c) => c.updatedAt.toISOString() }),
  }),
})

// ─── DealCompetitor Type ──────────────────────────────────

type DealCompetitorGraphqlShape = {
  id: string
  dealId: string
  competitorId: string
  note: string | null
  createdAt: Date
  competitor: CompetitorGraphqlShape
}

const DealCompetitorRef = builder.objectRef<DealCompetitorGraphqlShape>('DealCompetitor')

DealCompetitorRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    dealId: t.exposeID('dealId'),
    competitorId: t.exposeID('competitorId'),
    note: t.string({
      nullable: true,
      resolve: (link) => link.note ?? null,
    }),
    createdAt: t.string({ resolve: (link) => link.createdAt.toISOString() }),
    competitor: t.field({
      type: CompetitorRef,
      resolve: (link) => link.competitor as unknown as CompetitorGraphqlShape,
    }),
  }),
})

// ─── CompetitorConnection Type ────────────────────────────

const CompetitorConnectionRef = builder
  .objectRef<{
    items: CompetitorGraphqlShape[]
    total: number
    page: number
    pageSize: number
  }>('CompetitorConnection')
  .implement({
    fields: (t) => ({
      items: t.field({ type: [CompetitorRef], resolve: (c) => c.items }),
      total: t.exposeInt('total'),
      page: t.exposeInt('page'),
      pageSize: t.exposeInt('pageSize'),
    }),
  })

// ─── Enum Types ───────────────────────────────────────────

const WinLossReasonRef = builder.enumType('WinLossReason', {
  values: WIN_LOSS_REASONS,
})

// ─── Input Types ──────────────────────────────────────────

const CreateCompetitorInputRef = builder.inputType('CreateCompetitorInput', {
  fields: (t) => ({
    name: t.string({ required: true }),
    website: t.string(),
    strengths: t.string(),
    weaknesses: t.string(),
    isActive: t.boolean(),
  }),
})

const UpdateCompetitorInputRef = builder.inputType('UpdateCompetitorInput', {
  fields: (t) => ({
    name: t.string(),
    website: t.string(),
    strengths: t.string(),
    weaknesses: t.string(),
    isActive: t.boolean(),
  }),
})

const CompetitorFilterInputRef = builder.inputType('CompetitorFilterInput', {
  fields: (t) => ({
    search: t.string(),
    includeInactive: t.boolean(),
  }),
})

const CompetitorPaginationInputRef = builder.inputType('CompetitorPaginationInput', {
  fields: (t) => ({
    page: t.int(),
    pageSize: t.int(),
  }),
})

const AddCompetitorToDealInputRef = builder.inputType('AddCompetitorToDealInput', {
  fields: (t) => ({
    dealId: t.string({ required: true }),
    competitorId: t.string({ required: true }),
    note: t.string(),
  }),
})

const RecordWinLossInputRef = builder.inputType('RecordWinLossInput', {
  fields: (t) => ({
    dealId: t.string({ required: true }),
    stageId: t.string(),
    reason: t.field({ type: WinLossReasonRef, required: true }),
    competitorId: t.string(),
    note: t.string(),
  }),
})

// ─── Service Singletons ───────────────────────────────────

let competitorsService: CompetitorsService | undefined
let dealCompetitorsService: DealCompetitorsService | undefined

function getCompetitorsService(): CompetitorsService {
  if (!competitorsService) throw new Error('CompetitorsService is not initialized')
  return competitorsService
}

function getDealCompetitorsService(): DealCompetitorsService {
  if (!dealCompetitorsService) throw new Error('DealCompetitorsService is not initialized')
  return dealCompetitorsService
}

function requireUser(context: GraphqlContext): JwtPayload {
  if (!context.user) {
    throw new UnauthorizedException('Authentication required')
  }
  return context.user
}

// ─── Query Fields ─────────────────────────────────────────

builder.queryFields((t) => ({
  competitors: t.field({
    type: CompetitorConnectionRef,
    args: {
      filter: t.arg({ type: CompetitorFilterInputRef }),
      pagination: t.arg({ type: CompetitorPaginationInputRef }),
    },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      await requirePermission(context, 'COMPETITOR', 'READ')
      const result = await getCompetitorsService().findMany(
        user.tenantId,
        (args.filter ?? {}) as Parameters<CompetitorsService['findMany']>[1],
        (args.pagination ?? {}) as Parameters<CompetitorsService['findMany']>[2],
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return result as unknown as any
    },
  }),

  dealCompetitors: t.field({
    type: [DealCompetitorRef],
    args: {
      dealId: t.arg.string({ required: true }),
    },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      await requirePermission(context, 'COMPETITOR', 'READ')
      const links = await getDealCompetitorsService().findManyForDeal(
        user.tenantId,
        user.userId,
        args.dealId,
      )
      return links as unknown as DealCompetitorGraphqlShape[]
    },
  }),
}))

// ─── Mutation Fields ──────────────────────────────────────

builder.mutationFields((t) => ({
  createCompetitor: t.field({
    type: CompetitorRef,
    args: {
      input: t.arg({ type: CreateCompetitorInputRef, required: true }),
    },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      await requirePermission(context, 'COMPETITOR', 'CREATE')
      const result = await getCompetitorsService().create(
        user.tenantId,
        user.userId,
        args.input as Parameters<CompetitorsService['create']>[2],
      )
      return result as unknown as CompetitorGraphqlShape
    },
  }),

  updateCompetitor: t.field({
    type: CompetitorRef,
    args: {
      id: t.arg.string({ required: true }),
      input: t.arg({ type: UpdateCompetitorInputRef, required: true }),
    },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      await requirePermission(context, 'COMPETITOR', 'UPDATE')
      const result = await getCompetitorsService().update(
        user.tenantId,
        user.userId,
        args.id,
        args.input as Parameters<CompetitorsService['update']>[3],
      )
      return result as unknown as CompetitorGraphqlShape
    },
  }),

  deleteCompetitor: t.field({
    type: 'Boolean',
    args: {
      id: t.arg.string({ required: true }),
    },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      await requirePermission(context, 'COMPETITOR', 'DELETE')
      return getCompetitorsService().delete(user.tenantId, user.userId, args.id)
    },
  }),

  addCompetitorToDeal: t.field({
    type: DealCompetitorRef,
    args: {
      input: t.arg({ type: AddCompetitorToDealInputRef, required: true }),
    },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      await requirePermission(context, 'DEAL', 'UPDATE')
      const result = await getDealCompetitorsService().add(
        user.tenantId,
        user.userId,
        args.input as Parameters<DealCompetitorsService['add']>[2],
      )
      return result as unknown as DealCompetitorGraphqlShape
    },
  }),

  removeCompetitorFromDeal: t.field({
    type: 'Boolean',
    args: {
      id: t.arg.string({ required: true }),
    },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      await requirePermission(context, 'DEAL', 'UPDATE')
      return getDealCompetitorsService().remove(user.tenantId, user.userId, args.id)
    },
  }),

  recordWinLoss: t.field({
    type: DealRef,
    args: {
      input: t.arg({ type: RecordWinLossInputRef, required: true }),
    },
    resolve: async (_parent, args, context: GraphqlContext) => {
      const user = requireUser(context)
      await requirePermission(context, 'DEAL', 'UPDATE')
      const result = await getDealCompetitorsService().recordWinLoss(user.tenantId, user.userId, {
        dealId: args.input.dealId,
        stageId: args.input.stageId ?? undefined,
        reason: args.input.reason,
        competitorId: args.input.competitorId ?? undefined,
        note: args.input.note ?? undefined,
      })
      return result as unknown as DealGraphqlShape
    },
  }),
}))

// ─── Module Registration ──────────────────────────────────

export function registerCompetitorsGraphql(
  svc: CompetitorsService,
  dealSvc: DealCompetitorsService,
): void {
  competitorsService = svc
  dealCompetitorsService = dealSvc
}
