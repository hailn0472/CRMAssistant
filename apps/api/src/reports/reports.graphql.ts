import { UnauthorizedException } from '@nestjs/common'

/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types */

import { builder } from '../graphql/schema.builder'
import { requirePermission } from '../common/guards/permission-check'
import type {
  ForecastService,
  SalesForecastResult,
  ForecastBucket,
  ForecastBand,
  ForecastAccuracyPeriod,
} from './forecast.service'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

// ─── Enum Types ──────────────────────────────────────────

const ForecastGroupByRef = builder.enumType('ForecastGroupBy', {
  values: ['MONTH', 'QUARTER', 'OWNER', 'TEAM'] as const,
})

// ─── Object Types ─────────────────────────────────────────

const ForecastBucketRef = builder.objectRef<ForecastBucket>('ForecastBucket')

ForecastBucketRef.implement({
  fields: (t) => ({
    key: t.exposeID('key'),
    label: t.exposeString('label'),
    periodStart: t.string({ nullable: true, resolve: (bucket) => bucket.periodStart ?? null }),
    periodEnd: t.string({ nullable: true, resolve: (bucket) => bucket.periodEnd ?? null }),
    weightedValue: t.exposeFloat('weightedValue'),
    totalValue: t.exposeFloat('totalValue'),
    count: t.exposeInt('count'),
  }),
})

const ForecastBandRef = builder.objectRef<ForecastBand>('ForecastBand')

ForecastBandRef.implement({
  fields: (t) => ({
    weightedValue: t.exposeFloat('weightedValue'),
    totalValue: t.exposeFloat('totalValue'),
    count: t.exposeInt('count'),
  }),
})

const SalesForecastRef = builder.objectRef<SalesForecastResult>('SalesForecast')

SalesForecastRef.implement({
  fields: (t) => ({
    buckets: t.field({ type: [ForecastBucketRef], resolve: (sf) => sf.buckets }),
    commit: t.field({ type: ForecastBandRef, resolve: (sf) => sf.commit }),
    bestCase: t.field({ type: ForecastBandRef, resolve: (sf) => sf.bestCase }),
    pipeline: t.field({ type: ForecastBandRef, resolve: (sf) => sf.pipeline }),
    currency: t.exposeString('currency'),
  }),
})

const ForecastAccuracyPeriodRef =
  builder.objectRef<ForecastAccuracyPeriod>('ForecastAccuracyPeriod')

ForecastAccuracyPeriodRef.implement({
  fields: (t) => ({
    periodStart: t.exposeString('periodStart'),
    periodEnd: t.exposeString('periodEnd'),
    forecastValue: t.float({ nullable: true, resolve: (p) => p.forecastValue }),
    actualValue: t.exposeFloat('actualValue'),
    variance: t.float({ nullable: true, resolve: (p) => p.variance }),
    accuracyPct: t.float({ nullable: true, resolve: (p) => p.accuracyPct }),
  }),
})

// ─── Input Types ──────────────────────────────────────────

const SalesForecastInputRef = builder.inputType('SalesForecastInput', {
  fields: (t) => ({
    startDate: t.string({ required: true }),
    endDate: t.string({ required: true }),
    groupBy: t.field({ type: ForecastGroupByRef, required: true }),
    ownerId: t.string(),
    teamId: t.string(),
  }),
})

// ─── Service Singleton ─────────────────────────────────────

let forecastService: ForecastService | undefined

function getForecastService(): ForecastService {
  if (!forecastService) {
    throw new Error('ForecastService is not initialized')
  }
  return forecastService
}

function requireUser(context: GraphqlContext): JwtPayload {
  if (!context.user) {
    throw new UnauthorizedException('Authentication required')
  }
  return context.user
}

// ─── Queries ──────────────────────────────────────────────

builder.queryFields((t) => ({
  salesForecast: t.field({
    type: SalesForecastRef,
    args: {
      input: t.arg({ type: SalesForecastInputRef, required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'READ')
      return getForecastService().salesForecast(user.tenantId, user.userId, {
        startDate: args.input.startDate,
        endDate: args.input.endDate,
        groupBy: args.input.groupBy as 'MONTH' | 'QUARTER' | 'OWNER' | 'TEAM',
        ownerId: args.input.ownerId ?? undefined,
        teamId: args.input.teamId ?? undefined,
      })
    },
  }),
  forecastAccuracy: t.field({
    type: [ForecastAccuracyPeriodRef],
    args: {
      startDate: t.arg.string({ required: true }),
      endDate: t.arg.string({ required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'READ')
      return getForecastService().forecastAccuracy(user.tenantId, user.userId, {
        startDate: args.startDate,
        endDate: args.endDate,
      })
    },
  }),
}))

// ─── Registration ─────────────────────────────────────────

export function registerReportsGraphql(service: ForecastService): void {
  forecastService = service
}
