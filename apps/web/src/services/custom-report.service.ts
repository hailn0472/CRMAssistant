/**
 * Story 6.3 & 6.4 — frontend custom-report GraphQL service.
 *
 * Singular hand-written service over graphqlRequest (no Apollo, no codegen —
 * repo convention). Mirrors the Pothos surface in
 * apps/api/src/reports/reports.graphql.ts: customReportFieldCatalog,
 * customReportPreview, customReportData, customReportDrillDown and saveCustomReport.
 * Query keys are rooted at ['customReports'] by the builder; this module only
 * returns typed unwraps and actionable errors.
 */
import { graphqlRequest } from '@/lib/graphql-client'

// ─── Vocabularies (mirror of apps/api/src/reports/custom-report-types.ts) ─

export type CustomReportDataSource = 'CONTACTS' | 'DEALS' | 'TASKS' | 'ACTIVITIES'
export type CustomReportAggregation = 'COUNT' | 'DISTINCT_COUNT' | 'SUM' | 'AVERAGE' | 'MIN' | 'MAX'
export type CustomReportGranularity = 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR'
export type CustomReportChartType =
  | 'TABLE'
  | 'LINE'
  | 'BAR'
  | 'PIE'
  | 'DONUT'
  | 'AREA'
  | 'FUNNEL'
  | 'SCATTER'
  | 'HEATMAP'
export type CustomReportLegendPosition = 'TOP' | 'RIGHT' | 'BOTTOM' | 'LEFT'
export type CustomReportColorToken =
  | 'BLUE'
  | 'VIOLET'
  | 'GREEN'
  | 'AMBER'
  | 'RED'
  | 'CYAN'
  | 'PINK'
  | 'LIME'
  | 'INDIGO'
  | 'TEAL'

export const CUSTOM_REPORT_COLOR_TOKEN_HEX: Record<CustomReportColorToken, string> = {
  BLUE: '#2563eb',
  VIOLET: '#7c3aed',
  GREEN: '#059669',
  AMBER: '#d97706',
  RED: '#dc2626',
  CYAN: '#0891b2',
  PINK: '#db2777',
  LIME: '#65a30d',
  INDIGO: '#4f46e5',
  TEAL: '#0f766e',
}

export const CUSTOM_REPORT_DEFAULT_COLORS: readonly CustomReportColorToken[] = [
  'BLUE',
  'VIOLET',
  'GREEN',
  'AMBER',
  'RED',
  'CYAN',
  'PINK',
  'LIME',
  'INDIGO',
  'TEAL',
]

export type CustomReportFilterOperator =
  | 'EQ'
  | 'NOT_EQ'
  | 'CONTAINS'
  | 'IN'
  | 'GT'
  | 'GTE'
  | 'LT'
  | 'LTE'
  | 'BETWEEN'
  | 'ON'
  | 'BEFORE'
  | 'AFTER'
  | 'HAS_ANY'
  | 'HAS_ALL'
export type CustomReportSortDirection = 'ASC' | 'DESC'
export type CustomReportOrientation = 'VERTICAL' | 'HORIZONTAL'
export type CustomReportValueType =
  | 'STRING'
  | 'NUMBER'
  | 'DATE'
  | 'DATETIME'
  | 'BOOLEAN'
  | 'ENUM'
  | 'RELATION'
  | 'TAGS'
  | 'CURRENCY'
export type CustomReportFieldRole = 'FILTER' | 'DIMENSION' | 'METRIC'
export type CustomReportColumnRole = 'DIMENSION' | 'METRIC'
export type CustomReportWarningCode =
  | 'DIVISION_BY_ZERO'
  | 'NON_FINITE_RESULT'
  | 'MIXED_CURRENCY'
  | 'INVALID_SAVED_CONFIG'

// ─── Catalogue ─────────────────────────────────────────────────────────

export type CustomReportField = {
  key: string
  label: string
  valueType: CustomReportValueType
  roles: CustomReportFieldRole[]
  aggregations: CustomReportAggregation[]
  filterOperators: CustomReportFilterOperator[]
  relationKind: string | null
  isNumeric: boolean
  isCurrency: boolean
  isDate: boolean
}

export type CustomReportCatalog = {
  dataSource: CustomReportDataSource
  fields: CustomReportField[]
}

// ─── Config (typed value slots — never raw JSON) ───────────────────────

export type CustomReportFilter = {
  id: string
  fieldId: string
  operator: CustomReportFilterOperator
  stringValue: string | null
  numberValue: number | null
  booleanValue: boolean | null
  dateValue: string | null
  stringValues: string[] | null
  numberValues: number[] | null
  dateValues: string[] | null
}

export type CustomReportCalculatedDimension =
  | { kind: 'DATE_PART'; sourceFieldId: string; granularity: CustomReportGranularity }
  | { kind: 'NUMBER_BUCKET'; sourceFieldId: string; bucketSize: number }

export type CustomReportDimension = {
  id: string
  fieldId: string | null
  calculation: CustomReportCalculatedDimension | null
  granularity: CustomReportGranularity | null
}

export type CustomReportMetric = {
  id: string
  fieldId: string
  aggregation: CustomReportAggregation
  alias: string
}

export type CustomReportCalculatedField = {
  id: string
  alias: string
  label: string | null
  expression: string
}

export type CustomReportVisualization = {
  type: CustomReportChartType
  title: string | null
  showLegend: boolean
  showDataLabels: boolean
  xAxisLabel: string | null
  yAxisLabel: string | null
  orientation: CustomReportOrientation | null
  colors?: CustomReportColorToken[]
  legendPosition?: CustomReportLegendPosition
}

export type CustomReportSort = {
  id: string
  targetId: string
  direction: CustomReportSortDirection
}

export type CustomReportConfig = {
  version: 2 | 1
  dataSource: CustomReportDataSource
  filters: CustomReportFilter[]
  dimensions: CustomReportDimension[]
  metrics: CustomReportMetric[]
  calculatedFields: CustomReportCalculatedField[]
  visualization: CustomReportVisualization
  sort: CustomReportSort[]
}

// ─── Result ────────────────────────────────────────────────────────────

export type CustomReportColumn = {
  fieldId: string
  label: string
  valueType: CustomReportValueType
  role: CustomReportColumnRole
  aggregation: CustomReportAggregation | null
  granularity: CustomReportGranularity | null
  isCalculated: boolean
}

export type CustomReportCell = {
  fieldId: string
  label: string
  valueType: CustomReportValueType
  stringValue: string | null
  numberValue: number | null
  booleanValue: boolean | null
  dateValue: string | null
  isNull: boolean
}

export type CustomReportRow = {
  key: string
  cells: CustomReportCell[]
}

export type CustomReportSeriesPoint = {
  key: string
  label: string
  value: number | null
  dimensionLabels: string[]
}

export type CustomReportSeries = {
  metricId: string
  label: string
  points: CustomReportSeriesPoint[]
}

export type CustomReportWarning = {
  code: CustomReportWarningCode
  message: string
}

export type CustomReportPagination = {
  page: number
  pageSize: number
  totalPages: number
}

export type CustomReportResult = {
  reportId: string | null
  generatedAt: string
  config: CustomReportConfig
  columns: CustomReportColumn[]
  rows: CustomReportRow[]
  totalRows: number
  series: CustomReportSeries[]
  warnings: CustomReportWarning[]
  pagination: CustomReportPagination
  truncated: boolean
}

export type CustomReport = {
  id: string
  name: string
  isPublic: boolean
  createdAt: string
  updatedAt: string
  createdBy: string
  config: CustomReportConfig
}

export type CustomReportPaginationInput = {
  page?: number
  pageSize?: number
}

export type SaveCustomReportInput = {
  reportId?: string
  name: string
  config: CustomReportConfig
  isPublic?: boolean
}

export type CustomReportDrillDownItem = {
  id: string
  primaryLabel: string | null
  secondaryLabel: string | null
  relatedRecordId: string | null
}

export type CustomReportDrillDownConnection = {
  source: CustomReportDataSource
  pointLabel: string
  items: CustomReportDrillDownItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export type CustomReportDrillDownInput = {
  reportId?: string
  config?: CustomReportConfig
  pointKey: string
  metricId: string
  pagination?: CustomReportPaginationInput
}

// ─── Fragments (aligned with Pothos refs) ──────────────────────────────

const CUSTOM_REPORT_FILTER_FIELDS = `
  id
  fieldId
  operator
  stringValue
  numberValue
  booleanValue
  dateValue
  stringValues
  numberValues
  dateValues
`

const CUSTOM_REPORT_CALCULATED_DIMENSION_FIELDS = `
  kind
  sourceFieldId
  granularity
  bucketSize
`

const CUSTOM_REPORT_DIMENSION_FIELDS = `
  id
  fieldId
  calculation { ${CUSTOM_REPORT_CALCULATED_DIMENSION_FIELDS} }
  granularity
`

const CUSTOM_REPORT_METRIC_FIELDS = `
  id
  fieldId
  aggregation
  alias
`

const CUSTOM_REPORT_CALCULATED_FIELD_FIELDS = `
  id
  alias
  label
  expression
`

const CUSTOM_REPORT_VISUALIZATION_FIELDS = `
  type
  title
  showLegend
  showDataLabels
  xAxisLabel
  yAxisLabel
  orientation
  colors
  legendPosition
`

const CUSTOM_REPORT_SORT_FIELDS = `
  id
  targetId
  direction
`

const CUSTOM_REPORT_CONFIG_FIELDS = `
  version
  dataSource
  filters { ${CUSTOM_REPORT_FILTER_FIELDS} }
  dimensions { ${CUSTOM_REPORT_DIMENSION_FIELDS} }
  metrics { ${CUSTOM_REPORT_METRIC_FIELDS} }
  calculatedFields { ${CUSTOM_REPORT_CALCULATED_FIELD_FIELDS} }
  visualization { ${CUSTOM_REPORT_VISUALIZATION_FIELDS} }
  sort { ${CUSTOM_REPORT_SORT_FIELDS} }
`

const CUSTOM_REPORT_RESULT_FIELDS = `
  reportId
  generatedAt
  config { ${CUSTOM_REPORT_CONFIG_FIELDS} }
  columns {
    fieldId
    label
    valueType
    role
    aggregation
    granularity
    isCalculated
  }
  rows {
    key
    cells {
      fieldId
      label
      valueType
      stringValue
      numberValue
      booleanValue
      dateValue
      isNull
    }
  }
  totalRows
  series {
    metricId
    label
    points {
      key
      label
      value
      dimensionLabels
    }
  }
  warnings { code message }
  pagination { page pageSize totalPages }
  truncated
`

const CUSTOM_REPORT_DRILL_DOWN_CONNECTION_FIELDS = `
  source
  pointLabel
  items {
    id
    primaryLabel
    secondaryLabel
    relatedRecordId
  }
  total
  page
  pageSize
  totalPages
`

// ─── Operations (exact operations/variables asserted in spec) ──────────

export async function getCustomReportFieldCatalog(
  dataSource: CustomReportDataSource,
): Promise<CustomReportCatalog> {
  const data = await graphqlRequest<{ customReportFieldCatalog: CustomReportCatalog }>(
    `query CustomReportFieldCatalog($dataSource: CustomReportDataSource!) {
      customReportFieldCatalog(dataSource: $dataSource) {
        dataSource
        fields {
          key
          label
          valueType
          roles
          aggregations
          filterOperators
          relationKind
          isNumeric
          isCurrency
          isDate
        }
      }
    }`,
    { dataSource },
  )
  return data.customReportFieldCatalog
}

export async function previewCustomReport(
  config: CustomReportConfig,
  pagination?: CustomReportPaginationInput,
): Promise<CustomReportResult> {
  const data = await graphqlRequest<{ customReportPreview: CustomReportResult }>(
    `query CustomReportPreview($config: CustomReportConfigInput!, $pagination: CustomReportPaginationInput) {
      customReportPreview(config: $config, pagination: $pagination) {
        ${CUSTOM_REPORT_RESULT_FIELDS}
      }
    }`,
    { config, pagination: pagination ?? null },
  )
  return data.customReportPreview
}

export async function getCustomReportData(
  reportId: string,
  pagination?: CustomReportPaginationInput,
): Promise<CustomReportResult> {
  const data = await graphqlRequest<{ customReportData: CustomReportResult }>(
    `query CustomReportData($reportId: ID!, $pagination: CustomReportPaginationInput) {
      customReportData(reportId: $reportId, pagination: $pagination) {
        ${CUSTOM_REPORT_RESULT_FIELDS}
      }
    }`,
    { reportId, pagination: pagination ?? null },
  )
  return data.customReportData
}

export async function customReportDrillDown(
  input: CustomReportDrillDownInput,
): Promise<CustomReportDrillDownConnection> {
  const data = await graphqlRequest<{
    customReportDrillDown: CustomReportDrillDownConnection
  }>(
    `query CustomReportDrillDown($reportId: ID, $config: CustomReportConfigInput, $pointKey: String!, $metricId: String!, $pagination: CustomReportPaginationInput) {
      customReportDrillDown(reportId: $reportId, config: $config, pointKey: $pointKey, metricId: $metricId, pagination: $pagination) {
        ${CUSTOM_REPORT_DRILL_DOWN_CONNECTION_FIELDS}
      }
    }`,
    {
      reportId: input.reportId ?? null,
      config: input.config ?? null,
      pointKey: input.pointKey,
      metricId: input.metricId,
      pagination: input.pagination ?? null,
    },
  )
  return data.customReportDrillDown
}

export async function saveCustomReport(input: SaveCustomReportInput): Promise<CustomReport> {
  const data = await graphqlRequest<{ saveCustomReport: CustomReport }>(
    `mutation SaveCustomReport($reportId: ID, $name: String!, $config: CustomReportConfigInput!, $isPublic: Boolean) {
      saveCustomReport(reportId: $reportId, name: $name, config: $config, isPublic: $isPublic) {
        id
        name
        isPublic
        createdAt
        updatedAt
        createdBy
        config { ${CUSTOM_REPORT_CONFIG_FIELDS} }
      }
    }`,
    {
      reportId: input.reportId ?? null,
      name: input.name,
      config: input.config,
      isPublic: input.isPublic ?? null,
    },
  )
  return data.saveCustomReport
}

/** Read gate required per source (Contract: REPORT:READ + source gate). */
export const CUSTOM_REPORT_SOURCE_READ_GATE: Record<CustomReportDataSource, string> = {
  CONTACTS: 'CONTACT:READ',
  DEALS: 'DEAL:READ',
  TASKS: 'TASK:READ',
  ACTIVITIES: 'CONTACT:READ',
}
