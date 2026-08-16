/**
 * Story 6.2 — frontend sales-report service.
 *
 * Singular hand-written GraphQL service over graphqlRequest (no Apollo, no
 * codegen — repo convention). Fragment constants and types stay aligned with
 * the Pothos refs in apps/api/src/reports/reports.graphql.ts.
 */
import { graphqlRequest } from '@/lib/graphql-client'

// ─── Types (mirror of the backend vocabularies — AC 77) ─────────────

export type ReportType =
  | 'SALES_OVERVIEW'
  | 'PIPELINE_ANALYSIS'
  | 'WIN_LOSS'
  | 'REVENUE_FORECAST'
  | 'TEAM_PERFORMANCE'
  | 'DEAL_VELOCITY'

export type ReportGroupBy = 'MONTH' | 'QUARTER' | 'YEAR' | 'OWNER' | 'TEAM' | 'PRODUCT'

export type ComparisonMode = 'NONE' | 'PREVIOUS_PERIOD' | 'YEAR_OVER_YEAR' | 'CUSTOM'

export type DatePreset = 'THIS_MONTH' | 'THIS_QUARTER' | 'THIS_YEAR' | 'CUSTOM'

export type ReportMetricKey =
  | 'TOTAL_REVENUE'
  | 'WON_DEALS'
  | 'LOST_DEALS'
  | 'WIN_RATE'
  | 'AVERAGE_DEAL_SIZE'
  | 'OPEN_DEALS'
  | 'PIPELINE_VALUE'
  | 'WEIGHTED_PIPELINE_VALUE'
  | 'TOTAL_CLOSED'
  | 'WON_VALUE'
  | 'LOST_VALUE'
  | 'FORECAST_COMMIT'
  | 'FORECAST_BEST_CASE'
  | 'FORECAST_PIPELINE'
  | 'WON_REVENUE'
  | 'AVG_WON_DEAL_SIZE'
  | 'CLOSED_DEALS'
  | 'AVG_CYCLE_DAYS'
  | 'MEDIAN_CYCLE_DAYS'
  | 'EXCLUDED_ROWS'

export type ReportTrendDirection = 'UP' | 'DOWN' | 'FLAT'

export type ReportDisplayToken = 'NONE' | 'NEW'

export type ReportDrillScope = 'CURRENT' | 'COMPARISON'

export type ReportConfig = {
  datePreset: DatePreset
  startDate: string | null
  endDate: string | null
  comparisonMode: ComparisonMode
  comparisonStartDate: string | null
  comparisonEndDate: string | null
  groupBy: ReportGroupBy
  ownerId: string | null
  teamId: string | null
  stageId: string | null
  productId: string | null
  currency: string | null
}

/** Runtime filter overrides — every field optional (AC 24). */
export type ReportFilters = Partial<Omit<ReportConfig, never>>

export type ReportRow = {
  id: string
  name: string
  type: string
  isSupported: boolean
  /** Null for CUSTOM and other non-sales types (Story 6.3 Contract: config:null). */
  config: ReportConfig | null
  isPublic: boolean
  createdAt: string
  updatedAt: string
  createdBy: string
}

export type ReportMetric = {
  key: ReportMetricKey
  label: string
  value: number | null
  unit: 'CURRENCY' | 'COUNT' | 'PERCENT' | 'DAYS'
  comparisonValue: number | null
  percentageChange: number | null
  direction: ReportTrendDirection | null
  displayToken: ReportDisplayToken
}

export type ReportBucket = {
  key: string
  label: string
  value: number | null
  count: number
  comparisonValue: number | null
  percentageChange: number | null
  direction: ReportTrendDirection | null
  displayToken: ReportDisplayToken
}

export type ReportStageBreakdown = {
  stageId: string
  stageName: string
  order: number
  color: string
  dealCount: number
  stageSharePct: number
  value: number | null
}

export type ReportPeriod = {
  startDate: string
  endDate: string
  metrics: ReportMetric[]
  buckets: ReportBucket[]
  stageBreakdown: ReportStageBreakdown[]
}

export type ReportDrillRow = {
  id: string
  title: string
  value: number
  currency: string
  probability: number
  stageId: string
  stageName: string | null
  contactId: string | null
  contactName: string | null
  ownerId: string | null
  ownerName: string | null
  teamId: string | null
  teamName: string | null
  productNames: string[]
  createdAt: string
  expectedCloseDate: string | null
  actualCloseDate: string | null
  dealHref: string
  contactHref: string | null
}

export type ReportDrillConnection = {
  items: ReportDrillRow[]
  total: number
  page: number
  pageSize: number
}

export type ReportData = {
  reportId: string
  reportType: ReportType
  generatedAt: string
  dateField: string
  calculationNote: string
  currency: string | null
  mixedCurrencies: boolean
  availableCurrencies: string[]
  appliedFilters: ReportConfig
  current: ReportPeriod
  comparison: ReportPeriod | null
  drillDown: ReportDrillConnection | null
}

export type ReportConnection = {
  items: ReportRow[]
  total: number
  page: number
  pageSize: number
}

export type CreateReportInput = {
  name: string
  type: ReportType
  config: ReportConfig
  isPublic?: boolean
}

export type UpdateReportInput = Partial<Omit<CreateReportInput, never>>

export type ReportDrillDownInput = {
  metricKey: ReportMetricKey
  bucketKey?: string
  page?: number
  pageSize?: number
  scope?: ReportDrillScope
}

// ─── Fragments (aligned with Pothos refs) ────────────────────────────

const REPORT_CONFIG_FIELDS = `
  datePreset
  startDate
  endDate
  comparisonMode
  comparisonStartDate
  comparisonEndDate
  groupBy
  ownerId
  teamId
  stageId
  productId
  currency
`

const REPORT_METRIC_FIELDS = `
  key
  label
  value
  unit
  comparisonValue
  percentageChange
  direction
  displayToken
`

const REPORT_BUCKET_FIELDS = `
  key
  label
  value
  count
  comparisonValue
  percentageChange
  direction
  displayToken
`

const REPORT_STAGE_FIELDS = `
  stageId
  stageName
  order
  color
  dealCount
  stageSharePct
  value
`

const REPORT_PERIOD_FIELDS = `
  startDate
  endDate
  metrics { ${REPORT_METRIC_FIELDS} }
  buckets { ${REPORT_BUCKET_FIELDS} }
  stageBreakdown { ${REPORT_STAGE_FIELDS} }
`

const REPORT_ROW_FIELDS = `
  id
  name
  type
  isSupported
  isPublic
  createdAt
  updatedAt
  createdBy
  config { ${REPORT_CONFIG_FIELDS} }
`

const REPORT_DRILL_ROW_FIELDS = `
  id
  title
  value
  currency
  probability
  stageId
  stageName
  contactId
  contactName
  ownerId
  ownerName
  teamId
  teamName
  productNames
  createdAt
  expectedCloseDate
  actualCloseDate
  dealHref
  contactHref
`

const REPORT_DATA_FIELDS = `
  reportId
  reportType
  generatedAt
  dateField
  calculationNote
  currency
  mixedCurrencies
  availableCurrencies
  appliedFilters { ${REPORT_CONFIG_FIELDS} }
  current { ${REPORT_PERIOD_FIELDS} }
  comparison { ${REPORT_PERIOD_FIELDS} }
  drillDown {
    items { ${REPORT_DRILL_ROW_FIELDS} }
    total
    page
    pageSize
  }
`

// ─── Operations (AC 77: exact operations/variables asserted in spec) ──

export async function getReports(
  page = 1,
  pageSize = 20,
  type?: ReportType,
): Promise<ReportConnection> {
  const data = await graphqlRequest<{ reports: ReportConnection }>(
    `query Reports($filter: ReportListFilterInput, $pagination: ReportPaginationInput) {
      reports(filter: $filter, pagination: $pagination) {
        items { ${REPORT_ROW_FIELDS} }
        total
        page
        pageSize
      }
    }`,
    { filter: type ? { type } : null, pagination: { page, pageSize } },
  )
  return data.reports
}

export async function getReport(id: string): Promise<ReportRow> {
  const data = await graphqlRequest<{ report: ReportRow }>(
    `query Report($id: ID!) {
      report(id: $id) {
        ${REPORT_ROW_FIELDS}
      }
    }`,
    { id },
  )
  return data.report
}

export async function getReportData(
  reportId: string,
  filters?: ReportFilters,
  drillDown?: ReportDrillDownInput,
): Promise<ReportData> {
  const data = await graphqlRequest<{ reportData: ReportData }>(
    `query ReportData($reportId: ID!, $filters: ReportFiltersInput, $drillDown: ReportDrillDownInput) {
      reportData(reportId: $reportId, filters: $filters, drillDown: $drillDown) {
        ${REPORT_DATA_FIELDS}
      }
    }`,
    { reportId, filters: filters ?? null, drillDown: drillDown ?? null },
  )
  return data.reportData
}

export async function createReport(input: CreateReportInput): Promise<ReportRow> {
  const data = await graphqlRequest<{ createReport: ReportRow }>(
    `mutation CreateReport($input: CreateReportInput!) {
      createReport(input: $input) {
        ${REPORT_ROW_FIELDS}
      }
    }`,
    { input },
  )
  return data.createReport
}

export async function updateReport(id: string, input: UpdateReportInput): Promise<ReportRow> {
  const data = await graphqlRequest<{ updateReport: ReportRow }>(
    `mutation UpdateReport($id: ID!, $input: UpdateReportInput!) {
      updateReport(id: $id, input: $input) {
        ${REPORT_ROW_FIELDS}
      }
    }`,
    { id, input },
  )
  return data.updateReport
}

export async function deleteReport(id: string): Promise<boolean> {
  const data = await graphqlRequest<{ deleteReport: boolean }>(
    `mutation DeleteReport($id: ID!) {
      deleteReport(id: $id)
    }`,
    { id },
  )
  return data.deleteReport
}

export async function runReport(reportId: string, filters?: ReportFilters): Promise<ReportData> {
  const data = await graphqlRequest<{ runReport: ReportData }>(
    `mutation RunReport($reportId: ID!, $filters: ReportFiltersInput) {
      runReport(reportId: $reportId, filters: $filters) {
        ${REPORT_DATA_FIELDS}
      }
    }`,
    { reportId, filters: filters ?? null },
  )
  return data.runReport
}
