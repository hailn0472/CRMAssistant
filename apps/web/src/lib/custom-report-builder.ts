/**
 * Story 6.3 & 6.4 — pure client-side custom report builder logic.
 *
 * Framework-free on purpose (unit-tested without React): closed vocabularies,
 * the local draft reducer, server-equivalent validation gating, chart
 * compatibility (Contract A.4 / A.10) and a safe arithmetic expression checker
 * for calculated fields. The backend remains the source of truth —
 * this module only mirrors the rules so the UI never issues preview/save
 * requests for drafts the server would reject.
 */
import type {
  CustomReportAggregation,
  CustomReportCatalog,
  CustomReportCalculatedField,
  CustomReportChartType,
  CustomReportColorToken,
  CustomReportConfig,
  CustomReportDataSource,
  CustomReportDimension,
  CustomReportField,
  CustomReportFilter,
  CustomReportFilterOperator,
  CustomReportGranularity,
  CustomReportLegendPosition,
  CustomReportMetric,
  CustomReportOrientation,
  CustomReportSort,
  CustomReportSortDirection,
  CustomReportValueType,
  CustomReportVisualization,
} from '@/services/custom-report.service'
import {
  CUSTOM_REPORT_COLOR_TOKEN_HEX,
  CUSTOM_REPORT_DEFAULT_COLORS,
} from '@/services/custom-report.service'

export type {
  CustomReportAggregation,
  CustomReportCatalog,
  CustomReportCalculatedField,
  CustomReportChartType,
  CustomReportColorToken,
  CustomReportConfig,
  CustomReportDataSource,
  CustomReportDimension,
  CustomReportField,
  CustomReportFilter,
  CustomReportFilterOperator,
  CustomReportGranularity,
  CustomReportLegendPosition,
  CustomReportMetric,
  CustomReportOrientation,
  CustomReportSort,
  CustomReportSortDirection,
  CustomReportValueType,
  CustomReportVisualization,
}

export { CUSTOM_REPORT_COLOR_TOKEN_HEX, CUSTOM_REPORT_DEFAULT_COLORS }

// ─── Limits (mirror of Contract A.4 / A.10) ───────────────────────────

export const MAX_FILTERS = 10
export const MAX_DIMENSIONS = 3
export const MAX_TOTAL_METRICS = 10
export const MAX_SORTS = 3
export const MAX_EXPRESSION_LENGTH = 200
export const MAX_EXPRESSION_TOKENS = 50

export const CUSTOM_REPORT_DATA_SOURCES: readonly CustomReportDataSource[] = [
  'CONTACTS',
  'DEALS',
  'TASKS',
  'ACTIVITIES',
]

export const CUSTOM_REPORT_AGGREGATIONS: readonly CustomReportAggregation[] = [
  'COUNT',
  'DISTINCT_COUNT',
  'SUM',
  'AVERAGE',
  'MIN',
  'MAX',
]

export const CUSTOM_REPORT_GRANULARITIES: readonly CustomReportGranularity[] = [
  'DAY',
  'WEEK',
  'MONTH',
  'QUARTER',
  'YEAR',
]

export const CUSTOM_REPORT_CHART_TYPES: readonly CustomReportChartType[] = [
  'TABLE',
  'LINE',
  'BAR',
  'PIE',
  'DONUT',
  'AREA',
  'FUNNEL',
  'SCATTER',
  'HEATMAP',
]

export const CUSTOM_REPORT_LEGEND_POSITIONS: readonly CustomReportLegendPosition[] = [
  'TOP',
  'RIGHT',
  'BOTTOM',
  'LEFT',
]

export const CUSTOM_REPORT_COLOR_TOKENS: readonly CustomReportColorToken[] = [
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

export const CUSTOM_REPORT_SORT_DIRECTIONS: readonly CustomReportSortDirection[] = ['ASC', 'DESC']

export const CUSTOM_REPORT_ORIENTATIONS: readonly CustomReportOrientation[] = [
  'VERTICAL',
  'HORIZONTAL',
]

export const SOURCE_LABELS: Record<CustomReportDataSource, string> = {
  CONTACTS: 'Contacts',
  DEALS: 'Deals',
  TASKS: 'Tasks',
  ACTIVITIES: 'Activities',
}

export const AGGREGATION_LABELS: Record<CustomReportAggregation, string> = {
  COUNT: 'Count',
  DISTINCT_COUNT: 'Distinct count',
  SUM: 'Sum',
  AVERAGE: 'Average',
  MIN: 'Min',
  MAX: 'Max',
}

export const CHART_LABELS: Record<CustomReportChartType, string> = {
  TABLE: 'Table',
  LINE: 'Line',
  BAR: 'Bar',
  PIE: 'Pie',
  DONUT: 'Donut',
  AREA: 'Area',
  FUNNEL: 'Funnel',
  SCATTER: 'Scatter',
  HEATMAP: 'Heatmap',
}

export const LEGEND_POSITION_LABELS: Record<CustomReportLegendPosition, string> = {
  TOP: 'Top',
  RIGHT: 'Right',
  BOTTOM: 'Bottom',
  LEFT: 'Left',
}

// ─── Draft state ───────────────────────────────────────────────────────

/** UI draft — source may be unset; the server only ever sees serialized config. */
export interface CustomReportDraft {
  source: CustomReportDataSource | null
  filters: CustomReportFilter[]
  dimensions: CustomReportDimension[]
  metrics: CustomReportMetric[]
  calculatedFields: CustomReportCalculatedField[]
  visualization: CustomReportVisualization
  sort: CustomReportSort[]
}

export function defaultVisualization(): CustomReportVisualization {
  return {
    type: 'TABLE',
    title: null,
    showLegend: true,
    showDataLabels: false,
    xAxisLabel: null,
    yAxisLabel: null,
    // Orientation is only valid for BAR (Contract A.10); the default TABLE
    // must not carry one or the server rejects every non-BAR save.
    orientation: null,
    colors: [...CUSTOM_REPORT_DEFAULT_COLORS],
    legendPosition: 'BOTTOM',
  }
}

export function createEmptyDraft(): CustomReportDraft {
  return {
    source: null,
    filters: [],
    dimensions: [],
    metrics: [],
    calculatedFields: [],
    visualization: defaultVisualization(),
    sort: [],
  }
}

/** True when a source change would discard anything (Contract D.25). */
export function draftHasSelections(draft: CustomReportDraft): boolean {
  return (
    draft.filters.length > 0 ||
    draft.dimensions.length > 0 ||
    draft.metrics.length > 0 ||
    draft.calculatedFields.length > 0 ||
    draft.sort.length > 0
  )
}

/** Confirmed source change — clear everything incompatible with the new source. */
export function clearSourceSelections(draft: CustomReportDraft): CustomReportDraft {
  return {
    ...draft,
    filters: [],
    dimensions: [],
    metrics: [],
    calculatedFields: [],
    sort: [],
  }
}

/** Stable draft id generator (Contract D.26 — stable IDs). */
let idCounter = 0
export function createDraftId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`
}

function uniqueAlias(metrics: CustomReportMetric[], preferred: string): string {
  const existing = new Set(metrics.map((m) => m.alias))
  if (!existing.has(preferred)) return preferred
  let n = 2
  while (existing.has(`${preferred}_${n}`)) n += 1
  return `${preferred}_${n}`
}

// ─── Serialization (draft → server config) ─────────────────────────────

/** Null when the draft has no source — invalid drafts never reach the API. */
export function serializeConfig(draft: CustomReportDraft): CustomReportConfig | null {
  if (!draft.source) return null
  return {
    version: 2,
    dataSource: draft.source,
    filters: draft.filters,
    dimensions: draft.dimensions,
    metrics: draft.metrics,
    calculatedFields: draft.calculatedFields,
    visualization: {
      ...draft.visualization,
      colors: draft.visualization.colors ?? [...CUSTOM_REPORT_DEFAULT_COLORS],
      legendPosition: draft.visualization.legendPosition ?? 'BOTTOM',
    },
    sort: draft.sort,
  }
}

/** Load a saved config into an editable draft (edit mode, Contract D.23 / v1+v2 compat). */
export function configToDraft(config: CustomReportConfig): CustomReportDraft {
  return {
    source: config.dataSource,
    filters: config.filters,
    dimensions: config.dimensions,
    metrics: config.metrics,
    calculatedFields: config.calculatedFields,
    visualization: {
      ...config.visualization,
      colors: config.visualization.colors ?? [...CUSTOM_REPORT_DEFAULT_COLORS],
      legendPosition: config.visualization.legendPosition ?? 'BOTTOM',
    },
    sort: config.sort,
  }
}

// ─── Validation (server-equivalent gating, AC 15 / Contract A.3-A.4) ───

export interface DraftValidation {
  errors: string[]
  saveable: boolean
  previewable: boolean
}

export function validateDraft(
  draft: CustomReportDraft,
  catalog: CustomReportCatalog | null,
): DraftValidation {
  const errors: string[] = []
  if (!draft.source) {
    errors.push('Choose a data source.')
  }
  if (draft.dimensions.length < 1) {
    errors.push('Add at least one dimension.')
  }
  if (draft.dimensions.length > MAX_DIMENSIONS) {
    errors.push(`At most ${MAX_DIMENSIONS} dimensions allowed.`)
  }
  if (draft.metrics.length < 1) {
    errors.push('Add at least one metric.')
  }
  if (draft.metrics.length + draft.calculatedFields.length > MAX_TOTAL_METRICS) {
    errors.push(`At most ${MAX_TOTAL_METRICS} metrics total (including calculated fields).`)
  }
  if (draft.filters.length > MAX_FILTERS) {
    errors.push(`At most ${MAX_FILTERS} filters allowed.`)
  }
  if (draft.sort.length > MAX_SORTS) {
    errors.push(`At most ${MAX_SORTS} sort rules allowed.`)
  }

  const ids = new Set<string>()
  for (const dim of draft.dimensions) {
    if (ids.has(dim.id)) errors.push(`Duplicate selected id: ${dim.id}`)
    ids.add(dim.id)
  }
  for (const metric of draft.metrics) {
    if (ids.has(metric.id)) errors.push(`Duplicate selected id: ${metric.id}`)
    ids.add(metric.id)
  }
  for (const calc of draft.calculatedFields) {
    if (ids.has(calc.id)) errors.push(`Duplicate selected id: ${calc.id}`)
    ids.add(calc.id)
  }

  const aliases = new Set<string>()
  for (const metric of draft.metrics) {
    if (aliases.has(metric.alias)) errors.push(`Duplicate metric alias: ${metric.alias}`)
    aliases.add(metric.alias)
  }
  for (const calc of draft.calculatedFields) {
    if (aliases.has(calc.alias)) errors.push(`Duplicate calculated alias: ${calc.alias}`)
    aliases.add(calc.alias)
  }

  if (catalog) {
    const fieldByKey = new Map(catalog.fields.map((f) => [f.key, f]))
    for (const dim of draft.dimensions) {
      if (dim.fieldId === null) continue // calculated dimension — no catalogue field
      const field = fieldByKey.get(dim.fieldId)
      if (!field) {
        errors.push(`Unknown field: ${dim.fieldId}`)
        continue
      }
      if (field.isDate && !dim.granularity) {
        errors.push(`${field.label} needs a date granularity.`)
      }
      if (!field.isDate && dim.granularity) {
        errors.push(`${field.label} is not a date field — granularity is not allowed.`)
      }
    }
    for (const metric of draft.metrics) {
      const field = fieldByKey.get(metric.fieldId)
      if (!field) {
        errors.push(`Unknown field: ${metric.fieldId}`)
        continue
      }
      if (!field.aggregations.includes(metric.aggregation)) {
        errors.push(`${field.label} does not support ${metric.aggregation}.`)
      }
    }
    for (const sort of draft.sort) {
      if (!ids.has(sort.targetId)) {
        errors.push(`Sort references an unselected item: ${sort.targetId}`)
      }
    }
  }

  for (const calc of draft.calculatedFields) {
    if (!calc.alias.trim()) errors.push('Calculated field needs an alias.')
    if (!calc.expression.trim()) {
      errors.push(`Calculated field "${calc.alias}" needs an expression.`)
    } else {
      const diag = expressionDiagnostics(calc.expression, [...aliases])
      if (diag.error) errors.push(`Calculated field "${calc.alias}": ${diag.error}`)
    }
  }

  errors.push(...chartCompatibilityErrors(draft.visualization.type, draft, catalog))

  const saveable = errors.length === 0
  // A draft without source or without fields is not previewable at all, and a
  // chart-incompatible draft must never fire a preview request either — the
  // backend rejects those combos with a 400 (Contract A.4 / A.10).
  const baseErrors = errors.filter((e) =>
    /^(Choose a data source|Add at least one dimension|Add at least one metric)/.test(e),
  )
  const chartErrors = chartCompatibilityErrors(draft.visualization.type, draft, catalog)
  const previewable = baseErrors.length === 0 && chartErrors.length === 0
  return { errors, saveable, previewable }
}

// ─── Chart compatibility (Contract A.4) ─────────────────────────────────

export function chartCompatibilityErrors(
  chartType: CustomReportChartType,
  draft: CustomReportDraft,
  catalog: CustomReportCatalog | null,
): string[] {
  const errors: string[] = []
  const fieldByKey = new Map((catalog?.fields ?? []).map((f) => [f.key, f]))
  const firstDim = draft.dimensions[0]
  const totalMetrics = draft.metrics.length + (draft.calculatedFields?.length ?? 0)
  const hasNumericMetric =
    draft.metrics.some((m) => {
      const field = fieldByKey.get(m.fieldId)
      return !!field?.isNumeric
    }) || (draft.calculatedFields?.length ?? 0) > 0
  const stageDimension = draft.dimensions.some((d) => d.fieldId === 'deal.stage')

  switch (chartType) {
    case 'TABLE':
      break
    case 'LINE':
    case 'AREA':
      if (!(firstDim && (fieldByKey.get(firstDim.fieldId ?? '')?.isDate ?? false))) {
        errors.push(`${CHART_LABELS[chartType]} charts need a date dimension first.`)
      }
      if (!hasNumericMetric) {
        errors.push(`${CHART_LABELS[chartType]} charts need a numeric metric.`)
      }
      break
    case 'BAR':
      if (draft.dimensions.length > 2) {
        errors.push('Bar charts support 1–2 dimensions.')
      }
      if (!hasNumericMetric) {
        errors.push('Bar charts need a numeric metric.')
      }
      break
    case 'PIE':
    case 'DONUT':
      if (!(draft.dimensions.length === 1 && totalMetrics === 1)) {
        errors.push(`${CHART_LABELS[chartType]} charts need exactly one dimension and one metric.`)
      }
      if (!hasNumericMetric) {
        errors.push(`${CHART_LABELS[chartType]} charts need a numeric metric.`)
      }
      break
    case 'FUNNEL':
      if (draft.source !== 'DEALS') {
        errors.push('Funnel charts require the Deals source.')
      }
      if (!stageDimension) {
        errors.push('Funnel charts need a Stage dimension.')
      }
      if (
        totalMetrics !== 1 ||
        (draft.metrics.length > 0 &&
          draft.metrics[0].aggregation !== 'COUNT' &&
          draft.metrics[0].aggregation !== 'SUM')
      ) {
        errors.push('Funnel charts need a COUNT or SUM metric.')
      }
      break
    case 'SCATTER':
      if (draft.dimensions.length !== 1) {
        errors.push('Scatter plots need exactly one identifying dimension.')
      }
      if (totalMetrics !== 2) {
        errors.push('Scatter plots need exactly two numeric metrics.')
      } else {
        const metricsAreNumeric = draft.metrics.every((m) => {
          const field = fieldByKey.get(m.fieldId)
          return !!field?.isNumeric
        })
        // Note: calculatedFields are always numeric
        if (!metricsAreNumeric) {
          errors.push('Scatter plots need both metrics to be numeric.')
        }
      }
      break
    case 'HEATMAP':
      if (draft.dimensions.length !== 2) {
        errors.push('Heatmaps need exactly two dimensions.')
      }
      if (totalMetrics !== 1) {
        errors.push('Heatmaps need exactly one numeric metric.')
      } else {
        if (!hasNumericMetric) {
          errors.push('Heatmaps need a numeric metric.')
        }
      }
      break
  }
  return errors
}

// ─── Safe expression checker (Contract A.8 — no eval/new Function) ─────

export interface ExpressionDiagnostic {
  error: string | null
  warning: string | null
}

type Token = { kind: 'number' | 'id' | 'op'; value: string }

function tokenizeExpression(expression: string): Token[] | string {
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    return `Expression too long (max ${MAX_EXPRESSION_LENGTH} characters).`
  }
  const tokens: Token[] = []
  let i = 0
  while (i < expression.length) {
    const c = expression[i]
    if (/\s/.test(c)) {
      i += 1
      continue
    }
    if (/[0-9.]/.test(c)) {
      let s = ''
      while (i < expression.length && /[0-9.]/.test(expression[i])) s += expression[i++]
      tokens.push({ kind: 'number', value: s })
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      let s = ''
      while (i < expression.length && /[A-Za-z0-9_]/.test(expression[i])) s += expression[i++]
      tokens.push({ kind: 'id', value: s })
      continue
    }
    if ('+-*/()'.includes(c)) {
      tokens.push({ kind: 'op', value: c })
      i += 1
      continue
    }
    return `Unexpected character: ${c}`
  }
  return tokens
}

/**
 * Client mirror of the server-side grammar: numeric literals, aliases,
 * parentheses and `+ - * /`. Returns an error string for grammar/alias
 * problems and a warning for division by zero. Never executes anything.
 */
export function expressionDiagnostics(
  expression: string,
  aliases: readonly string[],
): ExpressionDiagnostic {
  const tokenizedResult = tokenizeExpression(expression)
  if (typeof tokenizedResult === 'string') return { error: tokenizedResult, warning: null }
  const tokenized: Token[] = tokenizedResult
  if (tokenized.length === 0) return { error: 'Empty expression.', warning: null }
  if (tokenized.length > MAX_EXPRESSION_TOKENS) {
    return { error: `Expression too long (max ${MAX_EXPRESSION_TOKENS} tokens).`, warning: null }
  }
  const aliasSet = new Set(aliases)

  let pos = 0
  let divisionByZero = false

  function peek(): Token | undefined {
    return tokenized[pos]
  }
  function next(): Token | undefined {
    return tokenized[pos++]
  }
  function parseFactor(): string | null {
    const token = next()
    if (!token) return 'Unexpected end of expression.'
    if (token.kind === 'number') {
      if (Number.isNaN(Number(token.value))) return `Invalid number: ${token.value}`
      return null
    }
    if (token.kind === 'id') {
      if (!aliasSet.has(token.value)) return `Unknown alias: ${token.value}`
      return null
    }
    if (token.value === '(') {
      const inner = parseExpression()
      if (inner) return inner
      const close = next()
      if (!close || close.value !== ')') return 'Missing closing ).'
      return null
    }
    return `Unexpected token: ${token.value}`
  }
  function parseTerm(): string | null {
    const left = parseFactor()
    if (left) return left
    let opToken = peek()
    while (opToken && (opToken.value === '*' || opToken.value === '/')) {
      const op = next()?.value
      if (op === '/') {
        const divisor = tokenized[pos]
        if (divisor && divisor.kind === 'number' && Number(divisor.value) === 0) {
          divisionByZero = true
        }
      }
      const right = parseFactor()
      if (right) return right
      opToken = peek()
    }
    return null
  }
  function parseExpression(): string | null {
    const left = parseTerm()
    if (left) return left
    let opToken = peek()
    while (opToken && (opToken.value === '+' || opToken.value === '-')) {
      next()
      const right = parseTerm()
      if (right) return right
      opToken = peek()
    }
    return null
  }

  const error = parseExpression()
  if (error) return { error, warning: null }
  if (pos < tokenized.length) return { error: 'Unexpected trailing input.', warning: null }
  if (divisionByZero) return { error: null, warning: 'Division by zero yields null.' }
  return { error: null, warning: null }
}

// ─── Draft reducer ─────────────────────────────────────────────────────

export type CustomReportDraftAction =
  | { type: 'SET_SOURCE'; source: CustomReportDataSource }
  | { type: 'CLEAR_SELECTIONS' }
  | { type: 'ADD_FILTER'; filter: CustomReportFilter }
  | { type: 'UPDATE_FILTER'; id: string; patch: Partial<CustomReportFilter> }
  | { type: 'REMOVE_FILTER'; id: string }
  | { type: 'ADD_DIMENSION'; fieldId: string }
  | { type: 'ADD_METRIC'; fieldId: string; aggregation?: CustomReportAggregation }
  | { type: 'REMOVE_ITEM'; role: 'dimension' | 'metric'; id: string }
  | { type: 'MOVE_ITEM'; role: 'dimension' | 'metric'; id: string; direction: 'up' | 'down' }
  | { type: 'SET_AGGREGATION'; metricId: string; aggregation: CustomReportAggregation }
  | { type: 'SET_GRANULARITY'; dimensionId: string; granularity: CustomReportGranularity | null }
  | { type: 'ADD_CALCULATED_FIELD'; field: CustomReportCalculatedField }
  | { type: 'UPDATE_CALCULATED_FIELD'; id: string; patch: Partial<CustomReportCalculatedField> }
  | { type: 'REMOVE_CALCULATED_FIELD'; id: string }
  | { type: 'SET_CHART_TYPE'; chartType: CustomReportChartType }
  | { type: 'UPDATE_VISUALIZATION'; patch: Partial<CustomReportVisualization> }
  | { type: 'REORDER_ITEMS'; role: 'dimension' | 'metric'; orderedIds: string[] }
  | { type: 'ADD_SORT'; sort: CustomReportSort }
  | { type: 'REMOVE_SORT'; id: string }
  | { type: 'SET_SORT_DIRECTION'; id: string; direction: CustomReportSortDirection }
  | { type: 'MOVE_SORT'; id: string; direction: 'up' | 'down' }
  | { type: 'LOAD_CONFIG'; config: CustomReportConfig }
  | { type: 'RESET' }

export function customReportDraftReducer(
  state: CustomReportDraft,
  action: CustomReportDraftAction,
): CustomReportDraft {
  switch (action.type) {
    case 'SET_SOURCE':
      return { ...state, source: action.source }
    case 'CLEAR_SELECTIONS':
      return clearSourceSelections(state)
    case 'ADD_FILTER':
      return { ...state, filters: [...state.filters, action.filter] }
    case 'UPDATE_FILTER':
      return {
        ...state,
        filters: state.filters.map((f) => (f.id === action.id ? { ...f, ...action.patch } : f)),
      }
    case 'REMOVE_FILTER':
      return { ...state, filters: state.filters.filter((f) => f.id !== action.id) }
    case 'ADD_DIMENSION': {
      if (state.dimensions.some((d) => d.fieldId === action.fieldId)) return state
      return {
        ...state,
        dimensions: [
          ...state.dimensions,
          {
            id: createDraftId('dim'),
            fieldId: action.fieldId,
            calculation: null,
            granularity: null,
          },
        ],
      }
    }
    case 'ADD_METRIC': {
      const alias = uniqueAlias(state.metrics, action.fieldId.split('.').pop() ?? 'metric')
      return {
        ...state,
        metrics: [
          ...state.metrics,
          {
            id: createDraftId('met'),
            fieldId: action.fieldId,
            aggregation: action.aggregation ?? 'COUNT',
            alias,
          },
        ],
      }
    }
    case 'REMOVE_ITEM':
      return {
        ...state,
        dimensions:
          action.role === 'dimension'
            ? state.dimensions.filter((d) => d.id !== action.id)
            : state.dimensions,
        metrics:
          action.role === 'metric'
            ? state.metrics.filter((m) => m.id !== action.id)
            : state.metrics,
      }
    case 'MOVE_ITEM': {
      if (action.role === 'dimension') {
        const list = state.dimensions
        const index = list.findIndex((item) => item.id === action.id)
        if (index === -1) return state
        const target = action.direction === 'up' ? index - 1 : index + 1
        if (target < 0 || target >= list.length) return state
        const reordered = [...list]
        const [item] = reordered.splice(index, 1)
        reordered.splice(target, 0, item)
        return { ...state, dimensions: reordered }
      }
      const list = state.metrics
      const index = list.findIndex((item) => item.id === action.id)
      if (index === -1) return state
      const target = action.direction === 'up' ? index - 1 : index + 1
      if (target < 0 || target >= list.length) return state
      const reordered = [...list]
      const [item] = reordered.splice(index, 1)
      reordered.splice(target, 0, item)
      return { ...state, metrics: reordered }
    }
    case 'SET_AGGREGATION':
      return {
        ...state,
        metrics: state.metrics.map((m) =>
          m.id === action.metricId ? { ...m, aggregation: action.aggregation } : m,
        ),
      }
    case 'SET_GRANULARITY':
      return {
        ...state,
        dimensions: state.dimensions.map((d) =>
          d.id === action.dimensionId ? { ...d, granularity: action.granularity } : d,
        ),
      }
    case 'ADD_CALCULATED_FIELD':
      return { ...state, calculatedFields: [...state.calculatedFields, action.field] }
    case 'UPDATE_CALCULATED_FIELD':
      return {
        ...state,
        calculatedFields: state.calculatedFields.map((c) =>
          c.id === action.id ? { ...c, ...action.patch } : c,
        ),
      }
    case 'REMOVE_CALCULATED_FIELD':
      return {
        ...state,
        calculatedFields: state.calculatedFields.filter((c) => c.id !== action.id),
      }
    case 'SET_CHART_TYPE': {
      // Orientation is BAR-only (Contract A.10). Clear it when leaving BAR and
      // restore a sane default when entering BAR, so a non-BAR chart never
      // serializes a stale VERTICAL/HORIZONTAL that the server rejects.
      const isBar = action.chartType === 'BAR'
      return {
        ...state,
        visualization: {
          ...state.visualization,
          type: action.chartType,
          orientation: isBar ? state.visualization.orientation ?? 'VERTICAL' : null,
        },
      }
    }
    case 'UPDATE_VISUALIZATION':
      return { ...state, visualization: { ...state.visualization, ...action.patch } }
    case 'REORDER_ITEMS': {
      if (action.role === 'dimension') {
        const orderMap = new Map(action.orderedIds.map((id, index) => [id, index]))
        return {
          ...state,
          dimensions: [...state.dimensions].sort(
            (a, b) => (orderMap.get(a.id) ?? Infinity) - (orderMap.get(b.id) ?? Infinity),
          ),
        }
      }
      const orderMap = new Map(action.orderedIds.map((id, index) => [id, index]))
      return {
        ...state,
        metrics: [...state.metrics].sort(
          (a, b) => (orderMap.get(a.id) ?? Infinity) - (orderMap.get(b.id) ?? Infinity),
        ),
      }
    }
    case 'ADD_SORT':
      return { ...state, sort: [...state.sort, action.sort] }
    case 'REMOVE_SORT':
      return { ...state, sort: state.sort.filter((s) => s.id !== action.id) }
    case 'SET_SORT_DIRECTION':
      return {
        ...state,
        sort: state.sort.map((s) =>
          s.id === action.id ? { ...s, direction: action.direction } : s,
        ),
      }
    case 'MOVE_SORT': {
      const sortList = state.sort
      const index = sortList.findIndex((s) => s.id === action.id)
      if (index === -1) return state
      const target = action.direction === 'up' ? index - 1 : index + 1
      if (target < 0 || target >= sortList.length) return state
      const reordered = [...sortList]
      const [item] = reordered.splice(index, 1)
      reordered.splice(target, 0, item)
      return { ...state, sort: reordered }
    }
    case 'LOAD_CONFIG':
      return configToDraft(action.config)
    case 'RESET':
      return createEmptyDraft()
    default:
      return state
  }
}

/** Default aggregation for a metric field (numeric fields → SUM, else COUNT). */
export function defaultAggregationFor(field: CustomReportField): CustomReportAggregation {
  if (field.isNumeric && field.aggregations.includes('SUM')) return 'SUM'
  if (field.aggregations.includes('COUNT')) return 'COUNT'
  return field.aggregations[0] ?? 'COUNT'
}
