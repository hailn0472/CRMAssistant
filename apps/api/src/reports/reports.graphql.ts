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
import type {
  WinLossService,
  WinLossAnalysisResult,
  WinLossReasonBucket,
  CompetitorOutcome,
} from './win-loss.service'
import type {
  ProductivityService,
  ProductivityTaskBucket,
  ProductivityRelatedBucket,
  ProductivityTimeBucket,
} from './productivity.service'
import type { ProductivityBucket } from './productivity-buckets'
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

// ─── Win/Loss Analysis Types (AC #21) ─────────────────────

const WinLossReasonBucketRef = builder.objectRef<WinLossReasonBucket>('WinLossReasonBucket')

WinLossReasonBucketRef.implement({
  fields: (t) => ({
    reason: t.exposeString('reason'),
    count: t.exposeInt('count'),
    totalValue: t.exposeFloat('totalValue'),
    percentage: t.exposeFloat('percentage'),
  }),
})

const CompetitorOutcomeRef = builder.objectRef<CompetitorOutcome>('CompetitorOutcome')

CompetitorOutcomeRef.implement({
  fields: (t) => ({
    competitorId: t.exposeID('competitorId'),
    competitorName: t.exposeString('competitorName'),
    wonCount: t.exposeInt('wonCount'),
    lostCount: t.exposeInt('lostCount'),
    winRate: t.exposeFloat('winRate'),
    totalValue: t.exposeFloat('totalValue'),
  }),
})

const WinLossAnalysisRef = builder.objectRef<WinLossAnalysisResult>('WinLossAnalysis')

WinLossAnalysisRef.implement({
  fields: (t) => ({
    totalClosed: t.exposeInt('totalClosed'),
    wonCount: t.exposeInt('wonCount'),
    lostCount: t.exposeInt('lostCount'),
    winRate: t.exposeFloat('winRate'),
    wonValue: t.exposeFloat('wonValue'),
    lostValue: t.exposeFloat('lostValue'),
    currency: t.exposeString('currency'),
    lossReasons: t.field({ type: [WinLossReasonBucketRef], resolve: (r) => r.lossReasons }),
    winReasons: t.field({ type: [WinLossReasonBucketRef], resolve: (r) => r.winReasons }),
    competitors: t.field({ type: [CompetitorOutcomeRef], resolve: (r) => r.competitors }),
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

// ─── Productivity Report Types (Story 4.5, AC 25) ─────────

const ProductivityBucketRef = builder.enumType('ProductivityBucket', {
  values: ['DAY', 'WEEK', 'MONTH'] as const,
})

const ProductivityTaskBucketRef =
  builder.objectRef<ProductivityTaskBucket>('ProductivityTaskBucket')

ProductivityTaskBucketRef.implement({
  fields: (t) => ({
    taskId: t.exposeID('taskId'),
    taskTitle: t.exposeString('taskTitle'),
    totalSeconds: t.exposeInt('totalSeconds'),
    percentage: t.exposeFloat('percentage'),
  }),
})

const ProductivityRelatedBucketRef = builder.objectRef<ProductivityRelatedBucket>(
  'ProductivityRelatedBucket',
)

ProductivityRelatedBucketRef.implement({
  fields: (t) => ({
    kind: t.exposeString('kind'),
    id: t.id({ nullable: true, resolve: (r) => r.id }),
    label: t.exposeString('label'),
    totalSeconds: t.exposeInt('totalSeconds'),
    percentage: t.exposeFloat('percentage'),
  }),
})

const ProductivityTimeBucketRef =
  builder.objectRef<ProductivityTimeBucket>('ProductivityTimeBucket')

ProductivityTimeBucketRef.implement({
  fields: (t) => ({
    bucketStart: t.exposeString('bucketStart'),
    totalSeconds: t.exposeInt('totalSeconds'),
  }),
})

// The TaskStatsRef idiom (tasks.graphql.ts:178): the ref is typed straight
// off the service's return type so ref fields cannot outrun the service.
const ProductivityReportRef = builder
  .objectRef<Awaited<ReturnType<ProductivityService['productivityReport']>>>('ProductivityReport')
  .implement({
    fields: (t) => ({
      userId: t.exposeID('userId'),
      startDate: t.exposeString('startDate'),
      endDate: t.exposeString('endDate'),
      bucket: t.field({ type: ProductivityBucketRef, resolve: (r) => r.bucket }),
      totalSeconds: t.exposeInt('totalSeconds'),
      entryCount: t.exposeInt('entryCount'),
      trackedDays: t.exposeInt('trackedDays'),
      averageSecondsPerTrackedDay: t.exposeFloat('averageSecondsPerTrackedDay'),
      byTask: t.field({ type: [ProductivityTaskBucketRef], resolve: (r) => r.byTask }),
      byRelated: t.field({ type: [ProductivityRelatedBucketRef], resolve: (r) => r.byRelated }),
      buckets: t.field({ type: [ProductivityTimeBucketRef], resolve: (r) => r.buckets }),
    }),
  })

const ProductivityReportInputRef = builder.inputType('ProductivityReportInput', {
  fields: (t) => ({
    startDate: t.string({ required: true }),
    endDate: t.string({ required: true }),
    bucket: t.field({ type: ProductivityBucketRef }),
    userId: t.string(),
  }),
})

// ─── Service Singleton ─────────────────────────────────────

let forecastService: ForecastService | undefined
let winLossService: WinLossService | undefined
let productivityService: ProductivityService | undefined

function getForecastService(): ForecastService {
  if (!forecastService) {
    throw new Error('ForecastService is not initialized')
  }
  return forecastService
}

function getWinLossService(): WinLossService {
  if (!winLossService) {
    throw new Error('WinLossService is not initialized')
  }
  return winLossService
}

function getProductivityService(): ProductivityService {
  if (!productivityService) {
    throw new Error('ProductivityService is not initialized')
  }
  return productivityService
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
  winLossAnalysis: t.field({
    type: WinLossAnalysisRef,
    args: {
      startDate: t.arg.string({ required: true }),
      endDate: t.arg.string({ required: true }),
      ownerId: t.arg.string(),
      teamId: t.arg.string(),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'READ')
      return getWinLossService().winLossAnalysis(user.tenantId, user.userId, {
        startDate: args.startDate,
        endDate: args.endDate,
        ownerId: args.ownerId ?? undefined,
        teamId: args.teamId ?? undefined,
      })
    },
  }),
  productivityReport: t.field({
    type: ProductivityReportRef,
    args: {
      input: t.arg({ type: ProductivityReportInputRef, required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'READ')
      return getProductivityService().productivityReport(user.tenantId, user.userId, {
        userId: args.input.userId ?? undefined,
        startDate: args.input.startDate,
        endDate: args.input.endDate,
        bucket: (args.input.bucket ?? 'DAY') as ProductivityBucket,
      })
    },
  }),
}))

// ─── Registration ─────────────────────────────────────────

export function registerReportsGraphql(
  service: ForecastService,
  winLoss: WinLossService,
  productivity: ProductivityService,
): void {
  forecastService = service
  winLossService = winLoss
  productivityService = productivity
}
