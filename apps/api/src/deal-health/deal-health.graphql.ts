import { UnauthorizedException, ForbiddenException } from '@nestjs/common'

/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types */

import { builder } from '../graphql/schema.builder'
import { requirePermission } from '../common/guards/permission-check'
import { DealRef } from '../deals/deals.graphql'
import type { DealGraphqlShape } from '../deals/deals.graphql'
import type { DealHealthService } from './deal-health.service'
import type { DealHealthStatus, DealHealthSignal } from './deal-health-score'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

// ─── DealHealth Type ────────────────────────────────────

type DealHealthShape = {
  status: DealHealthStatus
  score: number
  signals: DealHealthSignal[]
  snoozedUntil?: string | null
}

const DealHealthRef = builder.objectRef<DealHealthShape>('DealHealth')

DealHealthRef.implement({
  fields: (t) => ({
    status: t.exposeString('status'),
    score: t.exposeInt('score'),
    signals: t.exposeStringList('signals'),
    // The calling user's active snooze (if any) — resolved by the service, not
    // by a deal-row column. null on the at-risk list path, where no per-user
    // snooze is resolved.
    snoozedUntil: t.string({
      nullable: true,
      resolve: (health) => health.snoozedUntil ?? null,
    }),
  }),
})

// ─── AtRiskDeal Type ────────────────────────────────────

type AtRiskDealShape = {
  deal: DealGraphqlShape
  health: DealHealthShape
}

const AtRiskDealRef = builder.objectRef<AtRiskDealShape>('AtRiskDeal')

AtRiskDealRef.implement({
  fields: (t) => ({
    deal: t.field({
      type: DealRef,
      resolve: (item) => item.deal as unknown as DealGraphqlShape,
    }),
    health: t.field({
      type: DealHealthRef,
      resolve: (item) => item.health as unknown as DealHealthShape,
    }),
  }),
})

// ─── AtRiskDealConnection Type ──────────────────────────

type AtRiskDealConnectionShape = {
  items: AtRiskDealShape[]
  total: number
  page: number
  pageSize: number
}

const AtRiskDealConnectionRef = builder
  .objectRef<AtRiskDealConnectionShape>('AtRiskDealConnection')
  .implement({
    fields: (t) => ({
      items: t.field({ type: [AtRiskDealRef], resolve: (connection) => connection.items }),
      total: t.exposeInt('total'),
      page: t.exposeInt('page'),
      pageSize: t.exposeInt('pageSize'),
    }),
  })

// ─── DealReminderSnooze Type ────────────────────────────

type DealReminderSnoozeShape = {
  id: string
  dealId: string
  snoozedUntil: Date
}

const DealReminderSnoozeRef = builder.objectRef<DealReminderSnoozeShape>('DealReminderSnooze')

DealReminderSnoozeRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    dealId: t.exposeID('dealId'),
    snoozedUntil: t.string({ resolve: (snooze) => snooze.snoozedUntil.toISOString() }),
  }),
})

// ─── DealHealthSweepResult Type ─────────────────────────

type DealHealthSweepResultShape = {
  sweepDate: Date
  dealsEvaluated: number
  remindersCreated: number
}

const DealHealthSweepResultRef = builder
  .objectRef<DealHealthSweepResultShape>('DealHealthSweepResult')
  .implement({
    fields: (t) => ({
      sweepDate: t.string({ resolve: (result) => result.sweepDate.toISOString() }),
      dealsEvaluated: t.exposeInt('dealsEvaluated'),
      remindersCreated: t.exposeInt('remindersCreated'),
    }),
  })

// ─── ReminderPreference Type ────────────────────────────

type ReminderPreferenceShape = {
  emailFrequency: string
  notifyNoActivity: boolean
  notifyClosingSoon: boolean
  notifyAtRisk: boolean
}

const ReminderPreferenceRef = builder.objectRef<ReminderPreferenceShape>('ReminderPreference')

ReminderPreferenceRef.implement({
  fields: (t) => ({
    emailFrequency: t.exposeString('emailFrequency'),
    notifyNoActivity: t.exposeBoolean('notifyNoActivity'),
    notifyClosingSoon: t.exposeBoolean('notifyClosingSoon'),
    notifyAtRisk: t.exposeBoolean('notifyAtRisk'),
  }),
})

// ─── Input Types ────────────────────────────────────────

const DealHealthPaginationInputRef = builder.inputType('DealHealthPaginationInput', {
  fields: (t) => ({
    page: t.int(),
    pageSize: t.int(),
  }),
})

const UpdateReminderPreferenceInputRef = builder.inputType('UpdateReminderPreferenceInput', {
  fields: (t) => ({
    emailFrequency: t.string({ required: true }),
    notifyNoActivity: t.boolean({ required: true }),
    notifyClosingSoon: t.boolean({ required: true }),
    notifyAtRisk: t.boolean({ required: true }),
  }),
})

// ─── Service Singleton ──────────────────────────────────

let dealHealthService: DealHealthService | undefined

function getDealHealthService(): DealHealthService {
  if (!dealHealthService) {
    throw new Error('DealHealthService is not initialized')
  }
  return dealHealthService
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

// ─── Queries ────────────────────────────────────────────

builder.queryFields((t) => ({
  dealHealth: t.field({
    type: DealHealthRef,
    nullable: true, // null for a closed deal
    args: { dealId: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'DEAL', 'READ')
      const result = await getDealHealthService().findOneHealth(
        user.tenantId,
        user.userId,
        args.dealId,
      )
      if (!result.health) return null
      return {
        ...result.health,
        snoozedUntil: result.snoozedUntil ? result.snoozedUntil.toISOString() : null,
      } as unknown as DealHealthShape
    },
  }),
  atRiskDeals: t.field({
    type: AtRiskDealConnectionRef,
    args: { pagination: t.arg({ type: DealHealthPaginationInputRef }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'DEAL', 'READ')
      const service = getDealHealthService()
      // Lazy daily sweep — at most once per tenant per UTC day (AC 32). Any
      // failure is swallowed inside ensureSweptToday; the read never depends
      // on the sweep succeeding (AC 33).
      await service.ensureSweptToday(user.tenantId, user.userId, new Date())
      return service.findAtRisk(user.tenantId, user.userId, {
        page: args.pagination?.page ?? undefined,
        pageSize: args.pagination?.pageSize ?? undefined,
      }) as unknown as AtRiskDealConnectionShape
    },
  }),
  myReminderPreferences: t.field({
    type: ReminderPreferenceRef,
    resolve: async (_parent, _args, context) => {
      const user = requireUser(context)
      // A user editing their own preferences needs no write grant on anyone
      // else's data — DEAL:READ suffices (AC 37).
      await requirePermission(context, 'DEAL', 'READ')
      return getDealHealthService().myReminderPreferences(
        user.tenantId,
        user.userId,
      ) as unknown as ReminderPreferenceShape
    },
  }),
}))

// ─── Mutations ──────────────────────────────────────────

builder.mutationFields((t) => ({
  snoozeDealReminder: t.field({
    type: DealReminderSnoozeRef,
    args: {
      dealId: t.arg.id({ required: true }),
      days: t.arg.int({ required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'DEAL', 'UPDATE')
      return getDealHealthService().snoozeDealReminder(
        user.tenantId,
        user.userId,
        args.dealId,
        args.days,
      ) as unknown as DealReminderSnoozeShape
    },
  }),
  unsnoozeDealReminder: t.boolean({
    args: { dealId: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'DEAL', 'UPDATE')
      return getDealHealthService().unsnoozeDealReminder(user.tenantId, user.userId, args.dealId)
    },
  }),
  updateReminderPreferences: t.field({
    type: ReminderPreferenceRef,
    args: { input: t.arg({ type: UpdateReminderPreferenceInputRef, required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'DEAL', 'READ')
      return getDealHealthService().updateReminderPreferences(user.tenantId, user.userId, {
        emailFrequency: args.input.emailFrequency,
        notifyNoActivity: args.input.notifyNoActivity,
        notifyClosingSoon: args.input.notifyClosingSoon,
        notifyAtRisk: args.input.notifyAtRisk,
      }) as unknown as ReminderPreferenceShape
    },
  }),
  runDealHealthSweep: t.field({
    type: DealHealthSweepResultRef,
    resolve: async (_parent, _args, context) => {
      isAdmin(context)
      const user = requireUser(context)
      return getDealHealthService().runSweep(
        user.tenantId,
        user.userId,
        new Date(),
      ) as unknown as DealHealthSweepResultShape
    },
  }),
}))

// ─── Registration ───────────────────────────────────────

export function registerDealHealthGraphql(service: DealHealthService): void {
  dealHealthService = service
}
