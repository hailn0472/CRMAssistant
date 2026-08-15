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

// ─── Sales Report Types (Story 6.2) ────────────────────────────────
// Enums derive from the const tuples in report-types.ts (AC 55) — never a
// second vocabulary. Object refs derive from service/select return types so a
// ref field can never outrun the service (Trap T1).
// ───────────────────────────────────────────────────────────────────

import { parseReportConfig } from './report-config'
import {
  REPORT_TYPES,
  REPORT_GROUP_BY,
  COMPARISON_MODES,
  DATE_PRESETS,
  REPORT_METRIC_KEYS,
  REPORT_DRILL_SCOPES,
  REPORT_TREND_DIRECTIONS,
  REPORT_DISPLAY_TOKENS,
} from './report-types'
import type {
  SalesReportsService,
  ReportRow,
  ReportConnection,
  ReportMetric,
  ReportBucket,
  ReportStageBreakdown,
  ReportPeriod,
  ReportData,
  ReportDrillRow,
  ReportDrillConnection,
  ReportFiltersInput,
  ReportDrillDownInput,
} from './sales-reports.service'
import { isReportType } from './report-types'
import type { ReportType } from './report-types'

const ReportTypeRef = builder.enumType('ReportType', { values: REPORT_TYPES })
const ReportGroupByRef = builder.enumType('ReportGroupBy', { values: REPORT_GROUP_BY })
const ComparisonModeRef = builder.enumType('ComparisonMode', { values: COMPARISON_MODES })
const DatePresetRef = builder.enumType('DatePreset', { values: DATE_PRESETS })
const ReportMetricKeyRef = builder.enumType('ReportMetricKey', { values: REPORT_METRIC_KEYS })
const ReportDrillScopeRef = builder.enumType('ReportDrillScope', { values: REPORT_DRILL_SCOPES })
// Named ReportTrendDirection to avoid a collision with the dashboard
// TrendDirection enum registered by dashboards.graphql.ts.
const ReportTrendDirectionRef = builder.enumType('ReportTrendDirection', {
  values: REPORT_TREND_DIRECTIONS,
})
const ReportDisplayTokenRef = builder.enumType('ReportDisplayToken', {
  values: REPORT_DISPLAY_TOKENS,
})

const ReportConfigRef = builder.objectRef<ReturnType<typeof parseReportConfig>>('ReportConfig')

ReportConfigRef.implement({
  fields: (t) => ({
    datePreset: t.field({ type: DatePresetRef, resolve: (c) => c.datePreset }),
    startDate: t.string({ nullable: true, resolve: (c) => c.startDate }),
    endDate: t.string({ nullable: true, resolve: (c) => c.endDate }),
    comparisonMode: t.field({ type: ComparisonModeRef, resolve: (c) => c.comparisonMode }),
    comparisonStartDate: t.string({ nullable: true, resolve: (c) => c.comparisonStartDate }),
    comparisonEndDate: t.string({ nullable: true, resolve: (c) => c.comparisonEndDate }),
    groupBy: t.field({ type: ReportGroupByRef, resolve: (c) => c.groupBy }),
    ownerId: t.string({ nullable: true, resolve: (c) => c.ownerId }),
    teamId: t.string({ nullable: true, resolve: (c) => c.teamId }),
    stageId: t.string({ nullable: true, resolve: (c) => c.stageId }),
    productId: t.string({ nullable: true, resolve: (c) => c.productId }),
    currency: t.string({ nullable: true, resolve: (c) => c.currency }),
  }),
})

const ReportRef = builder.objectRef<ReportRow>('Report')

ReportRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    // Raw type string — an unknown persisted type is surfaced as
    // isSupported:false so the saved-report list can flag it (AC 42).
    type: t.exposeString('type'),
    isSupported: t.boolean({ resolve: (r) => isReportType(r.type) }),
    config: t.field({ type: ReportConfigRef, resolve: (r) => parseReportConfig(r.config, r.type) }),
    isPublic: t.exposeBoolean('isPublic'),
    createdAt: t.string({ resolve: (r) => r.createdAt.toISOString() }),
    updatedAt: t.string({ resolve: (r) => r.updatedAt.toISOString() }),
    createdBy: t.exposeString('createdBy'),
  }),
})

const ReportMetricRef = builder.objectRef<ReportMetric>('ReportMetric')

ReportMetricRef.implement({
  fields: (t) => ({
    key: t.field({ type: ReportMetricKeyRef, resolve: (m) => m.key }),
    label: t.exposeString('label'),
    value: t.float({ nullable: true, resolve: (m) => m.value }),
    unit: t.exposeString('unit'),
    comparisonValue: t.float({ nullable: true, resolve: (m) => m.comparisonValue }),
    percentageChange: t.float({ nullable: true, resolve: (m) => m.percentageChange }),
    direction: t.field({
      type: ReportTrendDirectionRef,
      nullable: true,
      resolve: (m) => m.direction,
    }),
    displayToken: t.field({ type: ReportDisplayTokenRef, resolve: (m) => m.displayToken }),
  }),
})

const ReportBucketRef = builder.objectRef<ReportBucket>('ReportBucket')

ReportBucketRef.implement({
  fields: (t) => ({
    key: t.exposeString('key'),
    label: t.exposeString('label'),
    value: t.float({ nullable: true, resolve: (b) => b.value }),
    count: t.exposeInt('count'),
    comparisonValue: t.float({ nullable: true, resolve: (b) => b.comparisonValue }),
    percentageChange: t.float({ nullable: true, resolve: (b) => b.percentageChange }),
    direction: t.field({
      type: ReportTrendDirectionRef,
      nullable: true,
      resolve: (b) => b.direction,
    }),
    displayToken: t.field({ type: ReportDisplayTokenRef, resolve: (b) => b.displayToken }),
  }),
})

const ReportStageBreakdownRef = builder.objectRef<ReportStageBreakdown>('ReportStageBreakdown')

ReportStageBreakdownRef.implement({
  fields: (t) => ({
    stageId: t.exposeID('stageId'),
    stageName: t.exposeString('stageName'),
    order: t.exposeInt('order'),
    color: t.exposeString('color'),
    dealCount: t.exposeInt('dealCount'),
    stageSharePct: t.exposeFloat('stageSharePct'),
    value: t.float({ nullable: true, resolve: (s) => s.value }),
  }),
})

const ReportPeriodRef = builder.objectRef<ReportPeriod>('ReportPeriod')

ReportPeriodRef.implement({
  fields: (t) => ({
    startDate: t.exposeString('startDate'),
    endDate: t.exposeString('endDate'),
    metrics: t.field({ type: [ReportMetricRef], resolve: (p) => p.metrics }),
    buckets: t.field({ type: [ReportBucketRef], resolve: (p) => p.buckets }),
    stageBreakdown: t.field({ type: [ReportStageBreakdownRef], resolve: (p) => p.stageBreakdown }),
  }),
})

const ReportDrillRowRef = builder.objectRef<ReportDrillRow>('ReportDrillRow')

ReportDrillRowRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    title: t.exposeString('title'),
    value: t.exposeFloat('value'),
    currency: t.exposeString('currency'),
    probability: t.exposeInt('probability'),
    stageId: t.exposeID('stageId'),
    stageName: t.string({ nullable: true, resolve: (r) => r.stageName }),
    contactId: t.id({ nullable: true, resolve: (r) => r.contactId }),
    contactName: t.string({ nullable: true, resolve: (r) => r.contactName }),
    ownerId: t.id({ nullable: true, resolve: (r) => r.ownerId }),
    ownerName: t.string({ nullable: true, resolve: (r) => r.ownerName }),
    teamId: t.id({ nullable: true, resolve: (r) => r.teamId }),
    teamName: t.string({ nullable: true, resolve: (r) => r.teamName }),
    productNames: t.stringList({ resolve: (r) => r.productNames }),
    createdAt: t.exposeString('createdAt'),
    expectedCloseDate: t.string({ nullable: true, resolve: (r) => r.expectedCloseDate }),
    actualCloseDate: t.string({ nullable: true, resolve: (r) => r.actualCloseDate }),
    dealHref: t.exposeString('dealHref'),
    contactHref: t.string({ nullable: true, resolve: (r) => r.contactHref }),
  }),
})

const ReportDrillConnectionRef = builder.objectRef<ReportDrillConnection>('ReportDrillConnection')

ReportDrillConnectionRef.implement({
  fields: (t) => ({
    items: t.field({ type: [ReportDrillRowRef], resolve: (c) => c.items }),
    total: t.exposeInt('total'),
    page: t.exposeInt('page'),
    pageSize: t.exposeInt('pageSize'),
  }),
})

const ReportDataRef = builder.objectRef<ReportData>('ReportData')

ReportDataRef.implement({
  fields: (t) => ({
    reportId: t.exposeID('reportId'),
    reportType: t.field({ type: ReportTypeRef, resolve: (d) => d.reportType }),
    generatedAt: t.exposeString('generatedAt'),
    dateField: t.exposeString('dateField'),
    calculationNote: t.exposeString('calculationNote'),
    currency: t.string({ nullable: true, resolve: (d) => d.currency }),
    mixedCurrencies: t.exposeBoolean('mixedCurrencies'),
    availableCurrencies: t.stringList({ resolve: (d) => d.availableCurrencies }),
    appliedFilters: t.field({ type: ReportConfigRef, resolve: (d) => d.appliedFilters }),
    current: t.field({ type: ReportPeriodRef, resolve: (d) => d.current }),
    comparison: t.field({ type: ReportPeriodRef, nullable: true, resolve: (d) => d.comparison }),
    drillDown: t.field({
      type: ReportDrillConnectionRef,
      nullable: true,
      resolve: (d) => d.drillDown,
    }),
  }),
})

const ReportConnectionRef = builder.objectRef<ReportConnection>('ReportConnection')

ReportConnectionRef.implement({
  fields: (t) => ({
    items: t.field({ type: [ReportRef], resolve: (c) => c.items }),
    total: t.exposeInt('total'),
    page: t.exposeInt('page'),
    pageSize: t.exposeInt('pageSize'),
  }),
})

// ─── Input Types ────────────────────────────────────────────────────

const ReportConfigInputRef = builder.inputType('ReportConfigInput', {
  fields: (t) => ({
    datePreset: t.field({ type: DatePresetRef, required: true }),
    startDate: t.string(),
    endDate: t.string(),
    comparisonMode: t.field({ type: ComparisonModeRef, required: true }),
    comparisonStartDate: t.string(),
    comparisonEndDate: t.string(),
    groupBy: t.field({ type: ReportGroupByRef, required: true }),
    ownerId: t.string(),
    teamId: t.string(),
    stageId: t.string(),
    productId: t.string(),
    currency: t.string(),
  }),
})

const CreateReportInputRef = builder.inputType('CreateReportInput', {
  fields: (t) => ({
    name: t.string({ required: true }),
    type: t.field({ type: ReportTypeRef, required: true }),
    config: t.field({ type: ReportConfigInputRef, required: true }),
    isPublic: t.boolean(),
  }),
})

const UpdateReportInputRef = builder.inputType('UpdateReportInput', {
  fields: (t) => ({
    name: t.string(),
    type: t.field({ type: ReportTypeRef }),
    config: t.field({ type: ReportConfigInputRef }),
    isPublic: t.boolean(),
  }),
})

const ReportFiltersInputRef = builder.inputType('ReportFiltersInput', {
  fields: (t) => ({
    datePreset: t.field({ type: DatePresetRef }),
    startDate: t.string(),
    endDate: t.string(),
    comparisonMode: t.field({ type: ComparisonModeRef }),
    comparisonStartDate: t.string(),
    comparisonEndDate: t.string(),
    groupBy: t.field({ type: ReportGroupByRef }),
    ownerId: t.string(),
    teamId: t.string(),
    stageId: t.string(),
    productId: t.string(),
    currency: t.string(),
  }),
})

const ReportListFilterInputRef = builder.inputType('ReportListFilterInput', {
  fields: (t) => ({
    type: t.field({ type: ReportTypeRef }),
  }),
})

const ReportPaginationInputRef = builder.inputType('ReportPaginationInput', {
  fields: (t) => ({
    page: t.int(),
    pageSize: t.int(),
  }),
})

const ReportDrillDownInputRef = builder.inputType('ReportDrillDownInput', {
  fields: (t) => ({
    metricKey: t.field({ type: ReportMetricKeyRef, required: true }),
    bucketKey: t.string(),
    page: t.int(),
    pageSize: t.int(),
    scope: t.field({ type: ReportDrillScopeRef }),
  }),
})

// ─── Service Singleton ─────────────────────────────────────────────────────
let forecastService: ForecastService | undefined
let winLossService: WinLossService | undefined
let productivityService: ProductivityService | undefined
let salesReportsService: SalesReportsService | undefined

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

function getSalesReportsService(): SalesReportsService {
  if (!salesReportsService) {
    throw new Error('SalesReportsService is not initialized')
  }
  return salesReportsService
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
  // ─── Story 6.2 saved reports (AC 57) ──────────────────────────────
  // Every read/run resolver requires BOTH REPORT:READ and DEAL:READ (AC 20) —
  // REPORT read alone never yields sales data.
  reports: t.field({
    type: ReportConnectionRef,
    args: {
      filter: t.arg({ type: ReportListFilterInputRef }),
      pagination: t.arg({ type: ReportPaginationInputRef }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'READ')
      await requirePermission(context, 'DEAL', 'READ')
      return getSalesReportsService().reports(
        user.tenantId,
        user.userId,
        {
          page: args.pagination?.page ?? undefined,
          pageSize: args.pagination?.pageSize ?? undefined,
        },
        { type: args.filter?.type ?? undefined },
      )
    },
  }),
  report: t.field({
    type: ReportRef,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'READ')
      await requirePermission(context, 'DEAL', 'READ')
      return getSalesReportsService().report(user.tenantId, user.userId, args.id)
    },
  }),
  reportData: t.field({
    type: ReportDataRef,
    args: {
      reportId: t.arg.id({ required: true }),
      filters: t.arg({ type: ReportFiltersInputRef }),
      drillDown: t.arg({ type: ReportDrillDownInputRef }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'READ')
      await requirePermission(context, 'DEAL', 'READ')
      const filters = args.filters as ReportFiltersInput | undefined
      const drill = args.drillDown as ReportDrillDownInput | undefined
      return getSalesReportsService().reportData(
        user.tenantId,
        user.userId,
        args.reportId,
        filters ?? undefined,
        drill ?? undefined,
      )
    },
  }),
}))

// ─── Story 6.2 report mutations (AC 58) ─────────────────────────────

builder.mutationFields((t) => ({
  createReport: t.field({
    type: ReportRef,
    args: { input: t.arg({ type: CreateReportInputRef, required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'CREATE')
      await requirePermission(context, 'DEAL', 'READ')
      return getSalesReportsService().createReport(user.tenantId, user.userId, {
        name: args.input.name,
        type: args.input.type as ReportType,
        config: args.input.config as ReportFiltersInput,
        isPublic: args.input.isPublic ?? false,
      })
    },
  }),
  updateReport: t.field({
    type: ReportRef,
    args: {
      id: t.arg.id({ required: true }),
      input: t.arg({ type: UpdateReportInputRef, required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'UPDATE')
      await requirePermission(context, 'DEAL', 'READ')
      return getSalesReportsService().updateReport(user.tenantId, user.userId, args.id, {
        name: args.input.name ?? undefined,
        type: args.input.type as ReportType | undefined,
        config: args.input.config as ReportFiltersInput | undefined,
        isPublic: args.input.isPublic ?? undefined,
      })
    },
  }),
  deleteReport: t.field({
    type: 'Boolean',
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'DELETE')
      await requirePermission(context, 'DEAL', 'READ')
      return getSalesReportsService().deleteReport(user.tenantId, user.userId, args.id)
    },
  }),
  // Compatibility mutation (AC 28 arbitration): same ReportData type, no DB
  // write, no audit row. The frontend uses the reportData query instead.
  runReport: t.field({
    type: ReportDataRef,
    args: {
      reportId: t.arg.id({ required: true }),
      filters: t.arg({ type: ReportFiltersInputRef }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'READ')
      await requirePermission(context, 'DEAL', 'READ')
      const filters = args.filters as ReportFiltersInput | undefined
      return getSalesReportsService().runReport(
        user.tenantId,
        user.userId,
        args.reportId,
        filters ?? undefined,
      )
    },
  }),
}))

// ─── Registration ─────────────────────────────────────────

export function registerReportsGraphql(
  service: ForecastService,
  winLoss: WinLossService,
  productivity: ProductivityService,
  salesReports: SalesReportsService,
): void {
  forecastService = service
  winLossService = winLoss
  productivityService = productivity
  salesReportsService = salesReports
}
