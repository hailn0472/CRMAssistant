import { BadRequestException, UnauthorizedException } from '@nestjs/common'

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
import { isPlatformReportType } from './report-types'
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
    // Raw type string — CUSTOM rows are supported platform reports (Custom
    // badge in the saved list) while truly unknown persisted types surface as
    // isSupported:false (Story 6.2 AC 42 + Story 6.3 Contract D.30).
    type: t.exposeString('type'),
    isSupported: t.boolean({ resolve: (r) => isPlatformReportType(r.type) }),
    config: t.field({
      type: ReportConfigRef,
      nullable: true,
      // A CUSTOM row carries a custom config that must never be parsed as a
      // sales config — expose null instead of a fabricated sales default.
      resolve: (r) => (r.type === 'CUSTOM' ? null : parseReportConfig(r.config, r.type)),
    }),
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

// Story 6.6 (Contract B8): reused verbatim by report-exports.graphql.ts so the
// export mutation argument is the SAME existing sales-filter input type.
export { ReportFiltersInputRef }

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

// ─── Custom Report Types (Story 6.3) ────────────────────────────────
// Enums derive from the const tuples in custom-report-types.ts; object refs
// derive from the service/catalogue return types (Contract B.11, C.15-C.19).
// No raw JSON crosses GraphQL — cells carry exactly one typed value slot.
// ────────────────────────────────────────────────────────────────────

import { catalogFor } from './custom-report-catalog'
import {
  CUSTOM_REPORT_AGGREGATIONS,
  CUSTOM_REPORT_CALCULATED_DIMENSION_KINDS,
  CUSTOM_REPORT_CHART_TYPES,
  CUSTOM_REPORT_COLOR_TOKENS,
  CUSTOM_REPORT_COLUMN_ROLES,
  CUSTOM_REPORT_DATA_SOURCES,
  CUSTOM_REPORT_FIELD_ROLES,
  CUSTOM_REPORT_FILTER_OPERATORS,
  CUSTOM_REPORT_GRANULARITIES,
  CUSTOM_REPORT_LEGEND_POSITIONS,
  CUSTOM_REPORT_ORIENTATIONS,
  CUSTOM_REPORT_RELATION_KINDS,
  CUSTOM_REPORT_SORT_DIRECTIONS,
  CUSTOM_REPORT_VALUE_TYPES,
  CUSTOM_REPORT_WARNING_CODES,
} from './custom-report-types'
import type {
  CustomReportCalculatedDimension,
  CustomReportConfig as CustomReportConfigShape,
  CustomReportDataSource,
  CustomReportDimension,
  CustomReportFilter,
  CustomReportMetric,
  CustomReportSort,
  CustomReportVisualization,
} from './custom-report-types'
import type {
  CustomReportsService,
  CustomReportCell,
  CustomReportColumn,
  CustomReportDrillDownConnection,
  CustomReportDrillDownItem,
  CustomReportOutput,
  CustomReportPagination,
  CustomReportResult,
  CustomReportRow,
  CustomReportSeries,
  CustomReportSeriesPoint,
  CustomReportWarning,
} from './custom-reports.service'
import type { CustomReportField } from './custom-report-catalog'

const CustomReportDataSourceRef = builder.enumType('CustomReportDataSource', {
  values: CUSTOM_REPORT_DATA_SOURCES,
})
const CustomReportAggregationRef = builder.enumType('CustomReportAggregation', {
  values: CUSTOM_REPORT_AGGREGATIONS,
})
const CustomReportGranularityRef = builder.enumType('CustomReportGranularity', {
  values: CUSTOM_REPORT_GRANULARITIES,
})
const CustomReportChartTypeRef = builder.enumType('CustomReportChartType', {
  values: CUSTOM_REPORT_CHART_TYPES,
})
const CustomReportLegendPositionRef = builder.enumType('CustomReportLegendPosition', {
  values: CUSTOM_REPORT_LEGEND_POSITIONS,
})
const CustomReportColorTokenRef = builder.enumType('CustomReportColorToken', {
  values: CUSTOM_REPORT_COLOR_TOKENS,
})
const CustomReportValueTypeRef = builder.enumType('CustomReportValueType', {
  values: CUSTOM_REPORT_VALUE_TYPES,
})
const CustomReportFilterOperatorRef = builder.enumType('CustomReportFilterOperator', {
  values: CUSTOM_REPORT_FILTER_OPERATORS,
})
const CustomReportSortDirectionRef = builder.enumType('CustomReportSortDirection', {
  values: CUSTOM_REPORT_SORT_DIRECTIONS,
})
const CustomReportOrientationRef = builder.enumType('CustomReportOrientation', {
  values: CUSTOM_REPORT_ORIENTATIONS,
})
const CustomReportFieldRoleRef = builder.enumType('CustomReportFieldRole', {
  values: CUSTOM_REPORT_FIELD_ROLES,
})
const CustomReportColumnRoleRef = builder.enumType('CustomReportColumnRole', {
  values: CUSTOM_REPORT_COLUMN_ROLES,
})
const CustomReportCalculatedDimensionKindRef = builder.enumType(
  'CustomReportCalculatedDimensionKind',
  { values: CUSTOM_REPORT_CALCULATED_DIMENSION_KINDS },
)
const CustomReportRelationKindRef = builder.enumType('CustomReportRelationKind', {
  values: CUSTOM_REPORT_RELATION_KINDS,
})
const CustomReportWarningCodeRef = builder.enumType('CustomReportWarningCode', {
  values: CUSTOM_REPORT_WARNING_CODES,
})

// ── Output object refs (derive from service shapes — Contract C.19) ──

const CustomReportFieldRef = builder.objectRef<CustomReportField>('CustomReportField')

CustomReportFieldRef.implement({
  fields: (t) => ({
    key: t.exposeString('key'),
    label: t.exposeString('label'),
    valueType: t.field({ type: CustomReportValueTypeRef, resolve: (f) => f.valueType }),
    roles: t.field({ type: [CustomReportFieldRoleRef], resolve: (f) => f.roles }),
    aggregations: t.field({ type: [CustomReportAggregationRef], resolve: (f) => f.aggregations }),
    filterOperators: t.field({
      type: [CustomReportFilterOperatorRef],
      resolve: (f) => f.filterOperators,
    }),
    relationKind: t.field({
      type: CustomReportRelationKindRef,
      nullable: true,
      resolve: (f) => f.relationKind,
    }),
    isNumeric: t.exposeBoolean('isNumeric'),
    isCurrency: t.exposeBoolean('isCurrency'),
    isDate: t.exposeBoolean('isDate'),
  }),
})

const CustomReportCatalogRef = builder.objectRef<{
  dataSource: CustomReportDataSource
  fields: CustomReportField[]
}>('CustomReportCatalog')

CustomReportCatalogRef.implement({
  fields: (t) => ({
    dataSource: t.field({ type: CustomReportDataSourceRef, resolve: (c) => c.dataSource }),
    fields: t.field({ type: [CustomReportFieldRef], resolve: (c) => c.fields }),
  }),
})

const CustomReportFilterRef = builder.objectRef<CustomReportFilter>('CustomReportFilter')

CustomReportFilterRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    fieldId: t.exposeString('fieldId'),
    operator: t.field({ type: CustomReportFilterOperatorRef, resolve: (f) => f.operator }),
    stringValue: t.string({ nullable: true, resolve: (f) => f.stringValue }),
    numberValue: t.float({ nullable: true, resolve: (f) => f.numberValue }),
    booleanValue: t.boolean({ nullable: true, resolve: (f) => f.booleanValue }),
    dateValue: t.string({ nullable: true, resolve: (f) => f.dateValue }),
    stringValues: t.stringList({ nullable: true, resolve: (f) => f.stringValues }),
    numberValues: t.floatList({ nullable: true, resolve: (f) => f.numberValues }),
    dateValues: t.stringList({ nullable: true, resolve: (f) => f.dateValues }),
  }),
})

const CustomReportCalculatedDimensionRef = builder.objectRef<CustomReportCalculatedDimension>(
  'CustomReportCalculatedDimension',
)

CustomReportCalculatedDimensionRef.implement({
  fields: (t) => ({
    kind: t.field({ type: CustomReportCalculatedDimensionKindRef, resolve: (d) => d.kind }),
    sourceFieldId: t.exposeString('sourceFieldId'),
    granularity: t.field({
      type: CustomReportGranularityRef,
      nullable: true,
      resolve: (d) => (d.kind === 'DATE_PART' ? d.granularity : null),
    }),
    bucketSize: t.float({
      nullable: true,
      resolve: (d) => (d.kind === 'NUMBER_BUCKET' ? d.bucketSize : null),
    }),
  }),
})

const CustomReportDimensionRef = builder.objectRef<CustomReportDimension>('CustomReportDimension')

CustomReportDimensionRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    fieldId: t.string({ nullable: true, resolve: (d) => d.fieldId }),
    calculation: t.field({
      type: CustomReportCalculatedDimensionRef,
      nullable: true,
      resolve: (d) => d.calculation,
    }),
    granularity: t.field({
      type: CustomReportGranularityRef,
      nullable: true,
      resolve: (d) => d.granularity,
    }),
  }),
})

const CustomReportMetricRef = builder.objectRef<CustomReportMetric>('CustomReportMetric')

CustomReportMetricRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    fieldId: t.exposeString('fieldId'),
    aggregation: t.field({ type: CustomReportAggregationRef, resolve: (m) => m.aggregation }),
    alias: t.exposeString('alias'),
  }),
})

const CustomReportCalculatedFieldRef = builder.objectRef<{
  id: string
  alias: string
  label: string | null
  expression: string
}>('CustomReportCalculatedField')

CustomReportCalculatedFieldRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    alias: t.exposeString('alias'),
    label: t.string({ nullable: true, resolve: (c) => c.label }),
    expression: t.exposeString('expression'),
  }),
})

const CustomReportSortRef = builder.objectRef<CustomReportSort>('CustomReportSort')

CustomReportSortRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    targetId: t.exposeString('targetId'),
    direction: t.field({ type: CustomReportSortDirectionRef, resolve: (s) => s.direction }),
  }),
})

const CustomReportVisualizationRef = builder.objectRef<CustomReportVisualization>(
  'CustomReportVisualization',
)

CustomReportVisualizationRef.implement({
  fields: (t) => ({
    type: t.field({ type: CustomReportChartTypeRef, resolve: (v) => v.type }),
    title: t.string({ nullable: true, resolve: (v) => v.title }),
    showLegend: t.exposeBoolean('showLegend'),
    showDataLabels: t.exposeBoolean('showDataLabels'),
    xAxisLabel: t.string({ nullable: true, resolve: (v) => v.xAxisLabel }),
    yAxisLabel: t.string({ nullable: true, resolve: (v) => v.yAxisLabel }),
    orientation: t.field({
      type: CustomReportOrientationRef,
      nullable: true,
      resolve: (v) => v.orientation,
    }),
    colors: t.field({ type: [CustomReportColorTokenRef], resolve: (v) => v.colors }),
    legendPosition: t.field({
      type: CustomReportLegendPositionRef,
      resolve: (v) => v.legendPosition,
    }),
  }),
})

const CustomReportConfigRef = builder.objectRef<CustomReportConfigShape>('CustomReportConfig')

CustomReportConfigRef.implement({
  fields: (t) => ({
    version: t.exposeInt('version'),
    dataSource: t.field({ type: CustomReportDataSourceRef, resolve: (c) => c.dataSource }),
    filters: t.field({ type: [CustomReportFilterRef], resolve: (c) => c.filters }),
    dimensions: t.field({ type: [CustomReportDimensionRef], resolve: (c) => c.dimensions }),
    metrics: t.field({ type: [CustomReportMetricRef], resolve: (c) => c.metrics }),
    calculatedFields: t.field({
      type: [CustomReportCalculatedFieldRef],
      resolve: (c) => c.calculatedFields,
    }),
    visualization: t.field({ type: CustomReportVisualizationRef, resolve: (c) => c.visualization }),
    sort: t.field({ type: [CustomReportSortRef], resolve: (c) => c.sort }),
  }),
})

const CustomReportColumnRef = builder.objectRef<CustomReportColumn>('CustomReportColumn')

CustomReportColumnRef.implement({
  fields: (t) => ({
    fieldId: t.exposeString('fieldId'),
    label: t.exposeString('label'),
    valueType: t.field({ type: CustomReportValueTypeRef, resolve: (c) => c.valueType }),
    role: t.field({ type: CustomReportColumnRoleRef, resolve: (c) => c.role }),
    aggregation: t.field({
      type: CustomReportAggregationRef,
      nullable: true,
      resolve: (c) => c.aggregation,
    }),
    granularity: t.field({
      type: CustomReportGranularityRef,
      nullable: true,
      resolve: (c) => c.granularity,
    }),
    isCalculated: t.exposeBoolean('isCalculated'),
  }),
})

const CustomReportCellRef = builder.objectRef<CustomReportCell>('CustomReportCell')

CustomReportCellRef.implement({
  fields: (t) => ({
    fieldId: t.exposeString('fieldId'),
    label: t.exposeString('label'),
    valueType: t.field({ type: CustomReportValueTypeRef, resolve: (c) => c.valueType }),
    stringValue: t.string({ nullable: true, resolve: (c) => c.stringValue }),
    numberValue: t.float({ nullable: true, resolve: (c) => c.numberValue }),
    booleanValue: t.boolean({ nullable: true, resolve: (c) => c.booleanValue }),
    dateValue: t.string({ nullable: true, resolve: (c) => c.dateValue }),
    isNull: t.exposeBoolean('isNull'),
  }),
})

const CustomReportRowRef = builder.objectRef<CustomReportRow>('CustomReportRow')

CustomReportRowRef.implement({
  fields: (t) => ({
    key: t.exposeString('key'),
    cells: t.field({ type: [CustomReportCellRef], resolve: (r) => r.cells }),
  }),
})

const CustomReportSeriesPointRef =
  builder.objectRef<CustomReportSeriesPoint>('CustomReportSeriesPoint')

CustomReportSeriesPointRef.implement({
  fields: (t) => ({
    key: t.exposeString('key'),
    label: t.exposeString('label'),
    value: t.float({ nullable: true, resolve: (p) => p.value }),
    dimensionLabels: t.stringList({
      resolve: (p) => p.dimensionLabels,
    }),
  }),
})

const CustomReportSeriesRef = builder.objectRef<CustomReportSeries>('CustomReportSeries')

CustomReportSeriesRef.implement({
  fields: (t) => ({
    metricId: t.exposeString('metricId'),
    label: t.exposeString('label'),
    points: t.field({ type: [CustomReportSeriesPointRef], resolve: (s) => s.points }),
  }),
})

const CustomReportWarningRef = builder.objectRef<CustomReportWarning>('CustomReportWarning')

CustomReportWarningRef.implement({
  fields: (t) => ({
    code: t.field({ type: CustomReportWarningCodeRef, resolve: (w) => w.code }),
    message: t.exposeString('message'),
  }),
})

const CustomReportPaginationRef =
  builder.objectRef<CustomReportPagination>('CustomReportPagination')

CustomReportPaginationRef.implement({
  fields: (t) => ({
    page: t.exposeInt('page'),
    pageSize: t.exposeInt('pageSize'),
    totalPages: t.exposeInt('totalPages'),
  }),
})

const CustomReportResultRef = builder.objectRef<CustomReportResult>('CustomReportResult')

CustomReportResultRef.implement({
  fields: (t) => ({
    reportId: t.id({ nullable: true, resolve: (r) => r.reportId }),
    generatedAt: t.exposeString('generatedAt'),
    config: t.field({ type: CustomReportConfigRef, resolve: (r) => r.config }),
    columns: t.field({ type: [CustomReportColumnRef], resolve: (r) => r.columns }),
    rows: t.field({ type: [CustomReportRowRef], resolve: (r) => r.rows }),
    totalRows: t.exposeInt('totalRows'),
    series: t.field({ type: [CustomReportSeriesRef], resolve: (r) => r.series }),
    warnings: t.field({ type: [CustomReportWarningRef], resolve: (r) => r.warnings }),
    pagination: t.field({ type: CustomReportPaginationRef, resolve: (r) => r.pagination }),
    truncated: t.exposeBoolean('truncated'),
  }),
})

const CustomReportRef = builder.objectRef<CustomReportOutput>('CustomReport')

CustomReportRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    isPublic: t.exposeBoolean('isPublic'),
    createdAt: t.string({ resolve: (r) => r.createdAt.toISOString() }),
    updatedAt: t.string({ resolve: (r) => r.updatedAt.toISOString() }),
    createdBy: t.exposeString('createdBy'),
    config: t.field({ type: CustomReportConfigRef, resolve: (r) => r.config }),
  }),
})

// ── Story 6.4 drill-down output refs (Contract E.27) ─────────────────

const CustomReportDrillDownItemRef = builder.objectRef<CustomReportDrillDownItem>(
  'CustomReportDrillDownItem',
)

CustomReportDrillDownItemRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    primaryLabel: t.string({ nullable: true, resolve: (i) => i.primaryLabel }),
    secondaryLabel: t.string({ nullable: true, resolve: (i) => i.secondaryLabel }),
    relatedRecordId: t.id({ nullable: true, resolve: (i) => i.relatedRecordId }),
  }),
})

const CustomReportDrillDownConnectionRef = builder.objectRef<CustomReportDrillDownConnection>(
  'CustomReportDrillDownConnection',
)

CustomReportDrillDownConnectionRef.implement({
  fields: (t) => ({
    source: t.field({ type: CustomReportDataSourceRef, resolve: (c) => c.source }),
    pointLabel: t.exposeString('pointLabel'),
    items: t.field({ type: [CustomReportDrillDownItemRef], resolve: (c) => c.items }),
    total: t.exposeInt('total'),
    page: t.exposeInt('page'),
    pageSize: t.exposeInt('pageSize'),
    totalPages: t.exposeInt('totalPages'),
  }),
})

// ── Input types (typed value slots — never raw JSON) ─────────────────

const CustomReportFilterInputRef = builder.inputType('CustomReportFilterInput', {
  fields: (t) => ({
    id: t.id({ required: true }),
    fieldId: t.string({ required: true }),
    operator: t.field({ type: CustomReportFilterOperatorRef, required: true }),
    stringValue: t.string(),
    numberValue: t.float(),
    booleanValue: t.boolean(),
    dateValue: t.string(),
    stringValues: t.stringList(),
    numberValues: t.floatList(),
    dateValues: t.stringList(),
  }),
})

const CustomReportDimensionCalculationInputRef = builder.inputType(
  'CustomReportDimensionCalculationInput',
  {
    fields: (t) => ({
      kind: t.field({ type: CustomReportCalculatedDimensionKindRef, required: true }),
      sourceFieldId: t.string({ required: true }),
      granularity: t.field({ type: CustomReportGranularityRef }),
      bucketSize: t.float(),
    }),
  },
)

const CustomReportDimensionInputRef = builder.inputType('CustomReportDimensionInput', {
  fields: (t) => ({
    id: t.id({ required: true }),
    fieldId: t.string(),
    calculation: t.field({ type: CustomReportDimensionCalculationInputRef }),
    granularity: t.field({ type: CustomReportGranularityRef }),
  }),
})

const CustomReportMetricInputRef = builder.inputType('CustomReportMetricInput', {
  fields: (t) => ({
    id: t.id({ required: true }),
    fieldId: t.string({ required: true }),
    aggregation: t.field({ type: CustomReportAggregationRef, required: true }),
    alias: t.string(),
  }),
})

const CustomReportCalculatedFieldInputRef = builder.inputType('CustomReportCalculatedFieldInput', {
  fields: (t) => ({
    id: t.id({ required: true }),
    alias: t.string({ required: true }),
    label: t.string(),
    expression: t.string({ required: true }),
  }),
})

const CustomReportSortInputRef = builder.inputType('CustomReportSortInput', {
  fields: (t) => ({
    id: t.id({ required: true }),
    targetId: t.string({ required: true }),
    direction: t.field({ type: CustomReportSortDirectionRef, required: true }),
  }),
})

const CustomReportVisualizationInputRef = builder.inputType('CustomReportVisualizationInput', {
  fields: (t) => ({
    type: t.field({ type: CustomReportChartTypeRef, required: true }),
    title: t.string(),
    showLegend: t.boolean(),
    showDataLabels: t.boolean(),
    xAxisLabel: t.string(),
    yAxisLabel: t.string(),
    orientation: t.field({ type: CustomReportOrientationRef }),
    colors: t.field({ type: [CustomReportColorTokenRef] }),
    legendPosition: t.field({ type: CustomReportLegendPositionRef }),
  }),
})

const CustomReportConfigInputRef = builder.inputType('CustomReportConfigInput', {
  fields: (t) => ({
    version: t.int({ required: true }),
    dataSource: t.field({ type: CustomReportDataSourceRef, required: true }),
    filters: t.field({ type: [CustomReportFilterInputRef], required: true }),
    dimensions: t.field({ type: [CustomReportDimensionInputRef], required: true }),
    metrics: t.field({ type: [CustomReportMetricInputRef], required: true }),
    calculatedFields: t.field({ type: [CustomReportCalculatedFieldInputRef], required: true }),
    visualization: t.field({ type: CustomReportVisualizationInputRef, required: true }),
    sort: t.field({ type: [CustomReportSortInputRef], required: true }),
  }),
})

const CustomReportPaginationInputRef = builder.inputType('CustomReportPaginationInput', {
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
let customReportsService: CustomReportsService | undefined

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

function getCustomReportsService(): CustomReportsService {
  if (!customReportsService) {
    throw new Error('CustomReportsService is not initialized')
  }
  return customReportsService
}

/**
 * Story 6.3 (Contract B.12, security invariant 1-2): every custom report
 * read/run additionally requires the selected source-domain READ gate.
 * ACTIVITIES derives visibility from its active parent Contact, so its gate is
 * CONTACT:READ. Public visibility never bypasses this gate.
 */
function requireCustomSourceRead(
  context: GraphqlContext,
  source: CustomReportDataSource,
): Promise<void> {
  const resource = catalogFor(source).readGate
  return requirePermission(context, resource, 'READ')
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
  // ─── Story 6.3 custom reports (Contract C.16) ────────────────────────
  // Every custom read requires REPORT:READ + the source-domain READ gate.
  customReportFieldCatalog: t.field({
    type: CustomReportCatalogRef,
    args: {
      dataSource: t.arg({ type: CustomReportDataSourceRef, required: true }),
    },
    resolve: async (_parent, args, context) => {
      await requirePermission(context, 'REPORT', 'READ')
      await requireCustomSourceRead(context, args.dataSource)
      return {
        dataSource: args.dataSource,
        fields: catalogFor(args.dataSource).fields,
      }
    },
  }),
  customReportPreview: t.field({
    type: CustomReportResultRef,
    args: {
      config: t.arg({ type: CustomReportConfigInputRef, required: true }),
      pagination: t.arg({ type: CustomReportPaginationInputRef }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'READ')
      const config = args.config as unknown as { dataSource: CustomReportDataSource }
      await requireCustomSourceRead(context, config.dataSource)
      return getCustomReportsService().preview(user.tenantId, user.userId, args.config, {
        page: args.pagination?.page ?? undefined,
        pageSize: args.pagination?.pageSize ?? undefined,
      })
    },
  }),
  customReportData: t.field({
    type: CustomReportResultRef,
    args: {
      reportId: t.arg.id({ required: true }),
      pagination: t.arg({ type: CustomReportPaginationInputRef }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'READ')
      // Resolve the source from the saved CUSTOM report first so the correct
      // source-domain gate applies (identical Report not found semantics).
      const source = await getCustomReportsService().resolveReportDataSource(
        user.tenantId,
        user.userId,
        args.reportId,
      )
      await requireCustomSourceRead(context, source)
      return getCustomReportsService().customReportData(user.tenantId, user.userId, args.reportId, {
        page: args.pagination?.page ?? undefined,
        pageSize: args.pagination?.pageSize ?? undefined,
      })
    },
  }),
  // ─── Story 6.4 drill-down (Contract E.25) ────────────────────────────
  // Exactly one of reportId/config is required. Both paths require
  // REPORT:READ + the source-domain READ gate; the service recomputes the
  // bounded result and never lets client point keys become DB predicates.
  customReportDrillDown: t.field({
    type: CustomReportDrillDownConnectionRef,
    args: {
      reportId: t.arg.id(),
      config: t.arg({ type: CustomReportConfigInputRef }),
      pointKey: t.arg.string({ required: true }),
      metricId: t.arg.string({ required: true }),
      pagination: t.arg({ type: CustomReportPaginationInputRef }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'READ')
      const hasReportId = args.reportId !== undefined && args.reportId !== null
      const hasConfig = args.config !== undefined && args.config !== null
      if (hasReportId === hasConfig) {
        throw new BadRequestException(
          'customReportDrillDown requires exactly one of reportId or config',
        )
      }
      if (hasReportId) {
        // Saved mode: resolve the source from the saved CUSTOM report first so
        // the correct source-domain gate applies (identical not-found
        // semantics as customReportData).
        const source = await getCustomReportsService().resolveReportDataSource(
          user.tenantId,
          user.userId,
          args.reportId as string,
        )
        await requireCustomSourceRead(context, source)
      } else {
        const config = args.config as unknown as { dataSource: CustomReportDataSource }
        await requireCustomSourceRead(context, config.dataSource)
      }
      return getCustomReportsService().customReportDrillDown(user.tenantId, user.userId, {
        reportId: args.reportId ?? undefined,
        config: args.config ?? undefined,
        pointKey: args.pointKey,
        metricId: args.metricId,
        pagination: {
          page: args.pagination?.page ?? undefined,
          pageSize: args.pagination?.pageSize ?? undefined,
        },
      })
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
  // ─── Story 6.3 saveCustomReport (Contract C.16-C.18) ────────────────
  // `reportId` absent → create (REPORT:CREATE); present → update the
  // creator-owned active CUSTOM row (REPORT:UPDATE + ownership). Both require
  // the source-domain READ gate. Exactly one service-level audit row.
  saveCustomReport: t.field({
    type: CustomReportRef,
    args: {
      reportId: t.arg.id(),
      name: t.arg.string({ required: true }),
      config: t.arg({ type: CustomReportConfigInputRef, required: true }),
      isPublic: t.arg.boolean(),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      const config = args.config as unknown as { dataSource: CustomReportDataSource }
      if (args.reportId) {
        await requirePermission(context, 'REPORT', 'UPDATE')
      } else {
        await requirePermission(context, 'REPORT', 'CREATE')
      }
      await requireCustomSourceRead(context, config.dataSource)
      return getCustomReportsService().saveCustomReport(user.tenantId, user.userId, {
        reportId: args.reportId ?? undefined,
        name: args.name,
        config: args.config,
        isPublic: args.isPublic ?? undefined,
      })
    },
  }),
}))

// ─── Registration ─────────────────────────────────────────

export function registerReportsGraphql(
  service: ForecastService,
  winLoss: WinLossService,
  productivity: ProductivityService,
  salesReports: SalesReportsService,
  customReports: CustomReportsService,
): void {
  forecastService = service
  winLossService = winLoss
  productivityService = productivity
  salesReportsService = salesReports
  customReportsService = customReports
}
