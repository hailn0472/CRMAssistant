/**
 * Story 6.3 (Contract A): framework-free strict-write / defensive-read custom
 * report config module.
 *
 * - `validateCustomReportConfig` (write path) is STRICT — throws on unknown
 *   object keys, unknown IDs/enums/operators/aggregations, duplicate selected
 *   IDs/aliases, incompatible field roles/types, invalid display options and
 *   excessive complexity. No eval/new Function/raw SQL is ever involved.
 * - `parseCustomReportConfig` (read path) is DEFENSIVE — never throws and
 *   returns an explicit invalid-config result; a corrupt custom report is
 *   never silently rewritten into a sales report.
 * - Calculated-field expressions go through a safe tokenizer/recursive-descent
 *   parser (numbers, aliases, parentheses, `+ - * /` only) — never eval, never
 *   interpolated into SQL. Division by zero / non-finite results evaluate to
 *   null plus a warning at execution time; non-finite literals are rejected at
 *   parse time.
 */
import { fieldByKey } from './custom-report-catalog'
import {
  isCustomReportAggregation,
  isCustomReportCalculatedDimensionKind,
  isCustomReportChartType,
  isCustomReportColorToken,
  isCustomReportDataSource,
  isCustomReportFilterOperator,
  isCustomReportGranularity,
  isCustomReportLegendPosition,
  isCustomReportOrientation,
  isCustomReportSortDirection,
  CUSTOM_REPORT_DEFAULT_COLORS,
} from './custom-report-types'
import type {
  CustomReportCalculatedDimension,
  CustomReportColorToken,
  CustomReportConfig,
  CustomReportDataSource,
  CustomReportDimension,
  CustomReportFilter,
  CustomReportLegendPosition,
  CustomReportMetric,
  CustomReportOrientation,
  CustomReportSort,
  CustomReportVisualization,
} from './custom-report-types'

export { CUSTOM_REPORT_CONFIG_VERSION } from './custom-report-types'

// ─── Limits (Contract A.4, A.8, A.9) ─────────────────────────────────────────

export const MAX_CUSTOM_FILTERS = 10
export const MAX_CUSTOM_DIMENSIONS = 3
export const MAX_CUSTOM_METRICS = 10
export const MAX_CUSTOM_SORTS = 3
export const MAX_EXPRESSION_LENGTH = 200
export const MAX_EXPRESSION_TOKENS = 50

// ─── Small helpers ───────────────────────────────────────────────────────────

const ISO_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isValidIsoDay(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DAY_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return false
  // Reject rollover dates such as 2026-02-31.
  return parsed.toISOString().slice(0, 10) === value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertKeys(obj: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(obj)) {
    if (!(allowed as readonly string[]).includes(key)) {
      throw new Error(`${label} has unknown key: ${key}`)
    }
  }
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function requireNullableString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  return requireNonEmptyString(value, label)
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`)
  }
  return value
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`)
  }
  return value
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array of strings`)
  }
  for (const item of value) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      throw new Error(`${label} must be a non-empty array of strings`)
    }
  }
  return value
}

function requireIsoDay(value: unknown, label: string): string {
  if (!isValidIsoDay(value)) {
    throw new Error(`${label} must be an ISO YYYY-MM-DD date interpreted in UTC`)
  }
  return value
}

// ─── Filter value slots (Contract A.5) ───────────────────────────────────────

type FilterSlotKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'stringList'
  | 'numberList'
  | 'dateList'

const FILTER_SLOT_KEYS = [
  'stringValue',
  'numberValue',
  'booleanValue',
  'dateValue',
  'stringValues',
  'numberValues',
  'dateValues',
] as const

/** Which slot kinds each operator accepts (Contract A.5). */
const OPERATOR_SLOTS: Record<string, FilterSlotKind[]> = {
  EQ: ['string', 'number', 'boolean', 'date'],
  NOT_EQ: ['string'],
  CONTAINS: ['string'],
  IN: ['stringList'],
  GT: ['number', 'date'],
  GTE: ['number', 'date'],
  LT: ['number', 'date'],
  LTE: ['number', 'date'],
  BETWEEN: ['numberList', 'dateList'],
  ON: ['date'],
  BEFORE: ['date'],
  AFTER: ['date'],
  HAS_ANY: ['stringList'],
  HAS_ALL: ['stringList'],
}

/** Which slot kinds a field value type accepts (Contract A.5). */
const FIELD_TYPE_SLOTS: Record<string, FilterSlotKind[]> = {
  STRING: ['string', 'stringList'],
  ENUM: ['string', 'stringList'],
  RELATION: ['string', 'stringList'],
  CURRENCY: ['string', 'stringList'],
  NUMBER: ['number', 'numberList'],
  DATE: ['date', 'dateList'],
  DATETIME: ['date', 'dateList'],
  BOOLEAN: ['boolean'],
  TAGS: ['stringList'],
}

function presentSlots(
  filter: Record<string, unknown>,
): Array<{ kind: FilterSlotKind; value: unknown }> {
  const present: Array<{ kind: FilterSlotKind; value: unknown }> = []
  if (filter.stringValue !== undefined && filter.stringValue !== null) {
    present.push({ kind: 'string', value: filter.stringValue })
  }
  if (filter.numberValue !== undefined && filter.numberValue !== null) {
    present.push({ kind: 'number', value: filter.numberValue })
  }
  if (filter.booleanValue !== undefined && filter.booleanValue !== null) {
    present.push({ kind: 'boolean', value: filter.booleanValue })
  }
  if (filter.dateValue !== undefined && filter.dateValue !== null) {
    present.push({ kind: 'date', value: filter.dateValue })
  }
  if (filter.stringValues !== undefined && filter.stringValues !== null) {
    present.push({ kind: 'stringList', value: filter.stringValues })
  }
  if (filter.numberValues !== undefined && filter.numberValues !== null) {
    present.push({ kind: 'numberList', value: filter.numberValues })
  }
  if (filter.dateValues !== undefined && filter.dateValues !== null) {
    present.push({ kind: 'dateList', value: filter.dateValues })
  }
  return present
}

// ─── Safe expression parser/evaluator (Contract A.8) ─────────────────────────

export type ExpressionNode =
  | { kind: 'num'; value: number }
  | { kind: 'ref'; name: string }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/'; left: ExpressionNode; right: ExpressionNode }

type ExpressionToken =
  | { type: 'number'; value: number }
  | { type: 'ident'; value: string }
  | { type: 'op'; value: string }

export function tokenizeExpression(expression: string): ExpressionToken[] {
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new Error(
      `Calculated field expression must be at most ${MAX_EXPRESSION_LENGTH} characters`,
    )
  }
  const tokens: ExpressionToken[] = []
  let i = 0
  while (i < expression.length) {
    const ch = expression[i]
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(expression[i + 1] ?? ''))) {
      const match = /^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?/.exec(expression.slice(i))
      if (!match) throw new Error('Invalid numeric literal in calculated field expression')
      const value = Number(match[0])
      if (!Number.isFinite(value)) {
        throw new Error('Calculated field expression contains a non-finite numeric literal')
      }
      tokens.push({ type: 'number', value })
      i += match[0].length
      continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(expression.slice(i))
      if (!match) throw new Error('Invalid identifier in calculated field expression')
      tokens.push({ type: 'ident', value: match[0] })
      i += match[0].length
      continue
    }
    if ('+-*/()'.includes(ch)) {
      tokens.push({ type: 'op', value: ch })
      i += 1
      continue
    }
    throw new Error(`Invalid character in calculated field expression: ${ch}`)
  }
  return tokens
}

export function parseExpression(
  expression: string,
  allowedAliases: ReadonlySet<string>,
): ExpressionNode {
  const tokens = tokenizeExpression(expression)
  if (tokens.length === 0) {
    throw new Error('Calculated field expression must not be empty')
  }
  if (tokens.length > MAX_EXPRESSION_TOKENS) {
    throw new Error(`Calculated field expression must be at most ${MAX_EXPRESSION_TOKENS} tokens`)
  }

  let pos = 0
  const peek = (): ExpressionToken | undefined => tokens[pos]
  const next = (): ExpressionToken => {
    const token = tokens[pos]
    if (!token) throw new Error('Unexpected end of calculated field expression')
    pos += 1
    return token
  }

  const parseFactor = (): ExpressionNode => {
    const token = next()
    if (token.type === 'number') return { kind: 'num', value: token.value }
    if (token.type === 'ident') {
      if (!allowedAliases.has(token.value)) {
        throw new Error(
          `Calculated field references an unknown or unsupported alias: ${token.value}`,
        )
      }
      return { kind: 'ref', name: token.value }
    }
    if (token.type === 'op' && token.value === '(') {
      const node = parseExpr()
      const close = next()
      if (close.type !== 'op' || close.value !== ')') {
        throw new Error('Unbalanced parentheses in calculated field expression')
      }
      return node
    }
    throw new Error('Invalid token in calculated field expression')
  }

  const parseTerm = (): ExpressionNode => {
    let left = parseFactor()
    for (;;) {
      const token = peek()
      if (token?.type === 'op' && (token.value === '*' || token.value === '/')) {
        next()
        left = { kind: 'bin', op: token.value, left, right: parseFactor() }
      } else {
        return left
      }
    }
  }

  const parseExpr = (): ExpressionNode => {
    let left = parseTerm()
    for (;;) {
      const token = peek()
      if (token?.type === 'op' && (token.value === '+' || token.value === '-')) {
        next()
        left = { kind: 'bin', op: token.value, left, right: parseTerm() }
      } else {
        return left
      }
    }
  }

  const node = parseExpr()
  if (pos !== tokens.length) {
    throw new Error('Unexpected trailing tokens in calculated field expression')
  }
  return node
}

export type ExpressionEvalResult = {
  value: number | null
  divByZero: boolean
  nonFinite: boolean
}

export function evaluateExpression(
  node: ExpressionNode,
  values: ReadonlyMap<string, number | null>,
): ExpressionEvalResult {
  switch (node.kind) {
    case 'num':
      return { value: node.value, divByZero: false, nonFinite: false }
    case 'ref':
      return { value: values.get(node.name) ?? null, divByZero: false, nonFinite: false }
    case 'bin': {
      const left = evaluateExpression(node.left, values)
      const right = evaluateExpression(node.right, values)
      if (left.value === null || right.value === null) {
        return { value: null, divByZero: false, nonFinite: false }
      }
      let raw: number
      switch (node.op) {
        case '+':
          raw = left.value + right.value
          break
        case '-':
          raw = left.value - right.value
          break
        case '*':
          raw = left.value * right.value
          break
        case '/':
          if (right.value === 0) {
            // Division by zero yields null plus a warning — never Infinity/NaN.
            return { value: null, divByZero: true, nonFinite: false }
          }
          raw = left.value / right.value
          break
      }
      if (!Number.isFinite(raw)) {
        return { value: null, divByZero: false, nonFinite: true }
      }
      return { value: raw, divByZero: false, nonFinite: false }
    }
  }
}

// ─── Dimension / metric / visualization helpers ──────────────────────────────

function isDateLikeDimension(
  dimension: CustomReportDimension,
  source: CustomReportDataSource,
): boolean {
  if (dimension.calculation?.kind === 'DATE_PART') return true
  if (dimension.fieldId) {
    const field = fieldByKey(source, dimension.fieldId)
    return field?.isDate === true
  }
  return false
}

function isNumericMetric(metric: CustomReportMetric): boolean {
  return (
    metric.aggregation === 'SUM' ||
    metric.aggregation === 'AVERAGE' ||
    metric.aggregation === 'MIN' ||
    metric.aggregation === 'MAX'
  )
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

// ─── Chart-type compatibility matrix (Contract A.4) ─────────────────────────

/**
 * Closed chart-type compatibility check shared by the strict validator and
 * the client-facing compatibility mirror. Returns the human-readable errors
 * for the configured chart type; an empty array means the combination is
 * supported. `validateCustomReportConfig` throws the first error verbatim so
 * the two surfaces can never drift.
 */
export function chartCompatibilityErrors(config: CustomReportConfig): string[] {
  const errors: string[] = []
  const source = config.dataSource
  const chartType = config.visualization.type
  const dimensions = config.dimensions
  const metrics = config.metrics
  const calculatedFields = config.calculatedFields
  const totalMetrics = metrics.length + calculatedFields.length
  const hasNumericMetric = metrics.some(isNumericMetric) || calculatedFields.length > 0
  const firstDimensionIsDate = dimensions.length > 0 && isDateLikeDimension(dimensions[0], source)
  const dimensionIsDateLike = (d: CustomReportDimension): boolean => isDateLikeDimension(d, source)

  switch (chartType) {
    case 'TABLE':
      // Any otherwise valid Story 6.3 config is a valid table.
      break
    case 'LINE':
    case 'AREA':
      if (!firstDimensionIsDate) {
        errors.push(`${chartType} charts require a date dimension as the first dimension`)
      }
      if (!hasNumericMetric) {
        errors.push(`${chartType} charts require at least one numeric metric`)
      }
      break
    case 'BAR':
      if (dimensions.length < 1 || dimensions.length > 2) {
        errors.push('BAR charts require one or two dimensions')
      }
      if (!hasNumericMetric) {
        errors.push('BAR charts require at least one numeric metric')
      }
      break
    case 'PIE':
    case 'DONUT':
      if (dimensions.length !== 1 || dimensionIsDateLike(dimensions[0])) {
        errors.push(`${chartType} charts require exactly one categorical (non-date) dimension`)
      }
      if (totalMetrics !== 1 || !hasNumericMetric) {
        errors.push(`${chartType} charts require exactly one numeric metric`)
      }
      break
    case 'FUNNEL':
      if (source !== 'DEALS') {
        errors.push('FUNNEL charts require the DEALS data source')
      }
      if (dimensions.length !== 1 || dimensions[0].fieldId !== 'deal.stage') {
        errors.push('FUNNEL charts require exactly one stage dimension')
      }
      if (
        totalMetrics !== 1 ||
        metrics.length !== 1 ||
        (metrics[0].aggregation !== 'COUNT' && metrics[0].aggregation !== 'SUM')
      ) {
        errors.push('FUNNEL charts require exactly one COUNT or SUM metric')
      }
      break
    case 'SCATTER':
      if (dimensions.length !== 1 || dimensionIsDateLike(dimensions[0])) {
        errors.push('SCATTER charts require exactly one identifying (non-date) dimension')
      }
      if (totalMetrics !== 2 || !metrics.every(isNumericMetric)) {
        errors.push(
          'SCATTER charts require exactly two numeric metrics (metric order binds X then Y)',
        )
      }
      break
    case 'HEATMAP':
      if (dimensions.length !== 2) {
        errors.push('HEATMAP charts require exactly two dimensions (order binds X then Y)')
      }
      if (totalMetrics !== 1 || !hasNumericMetric) {
        errors.push('HEATMAP charts require exactly one numeric metric (binds intensity)')
      }
      break
  }
  return errors
}

// ─── Strict write-path validation (Contract A.3-A.10) ────────────────────────

/**
 * Strict write-path validation. Throws an Error with a user-safe message on
 * any malformed input. Returns the normalized typed config (aliases defaulted
 * to ids, visualization defaults filled).
 */
export function validateCustomReportConfig(raw: unknown): CustomReportConfig {
  if (!isPlainObject(raw)) {
    throw new Error('Custom report config must be an object')
  }
  const obj = raw
  assertKeys(
    obj,
    [
      'version',
      'dataSource',
      'filters',
      'dimensions',
      'metrics',
      'calculatedFields',
      'visualization',
      'sort',
    ] as const,
    'Custom report config',
  )

  if (obj.version !== 1 && obj.version !== 2) {
    throw new Error('Custom report config version must be 1 or 2')
  }
  const isV1 = obj.version === 1
  if (!isCustomReportDataSource(obj.dataSource)) {
    throw new Error(
      'Custom report config dataSource must be one of CONTACTS, DEALS, TASKS, ACTIVITIES',
    )
  }
  const dataSource: CustomReportDataSource = obj.dataSource

  // ── filters (Contract A.4-A.5) ─────────────────────────────────────────
  if (!Array.isArray(obj.filters)) {
    throw new Error('Custom report config filters must be an array')
  }
  if (obj.filters.length > MAX_CUSTOM_FILTERS) {
    throw new Error(`Custom report config allows at most ${MAX_CUSTOM_FILTERS} filters`)
  }
  const filterIds = new Set<string>()
  const filters: CustomReportFilter[] = obj.filters.map((entry) => {
    if (!isPlainObject(entry)) throw new Error('Custom report filter must be an object')
    assertKeys(
      entry,
      [...FILTER_SLOT_KEYS, 'id', 'fieldId', 'operator'] as const,
      'Custom report filter',
    )
    const id = requireNonEmptyString(entry.id, 'Custom report filter id')
    if (filterIds.has(id)) throw new Error(`duplicate filter id: ${id}`)
    filterIds.add(id)
    const fieldId = requireNonEmptyString(entry.fieldId, 'Custom report filter fieldId')
    const field = fieldByKey(dataSource, fieldId)
    if (!field) {
      throw new Error(`Unknown custom report filter field for ${dataSource}: ${fieldId}`)
    }
    if (!field.roles.includes('FILTER')) {
      throw new Error(`Field ${fieldId} cannot be used as a filter`)
    }
    if (!isCustomReportFilterOperator(entry.operator)) {
      throw new Error(`Unsupported filter operator: ${String(entry.operator)}`)
    }
    const operator = entry.operator
    if (!field.filterOperators.includes(operator)) {
      throw new Error(`operator ${operator} is not supported for field ${fieldId}`)
    }

    const slots = presentSlots(entry)
    if (slots.length === 0) {
      throw new Error(`Filter ${id} requires exactly one typed value`)
    }
    if (slots.length > 1) {
      throw new Error(`Filter ${id} value must use exactly one typed slot`)
    }
    const slot = slots[0]
    const opSlots = OPERATOR_SLOTS[operator]
    const fieldSlots = FIELD_TYPE_SLOTS[field.valueType]
    if (!opSlots.includes(slot.kind) || !fieldSlots.includes(slot.kind)) {
      throw new Error(
        `Filter ${id} has a value incompatible with operator ${operator} on field ${fieldId}`,
      )
    }

    let stringValue: string | null = null
    let numberValue: number | null = null
    let booleanValue: boolean | null = null
    let dateValue: string | null = null
    let stringValues: string[] | null = null
    let numberValues: number[] | null = null
    let dateValues: string[] | null = null

    switch (slot.kind) {
      case 'string':
        stringValue = requireNonEmptyString(slot.value, `Filter ${id} value`)
        break
      case 'number':
        numberValue = requireFiniteNumber(slot.value, `Filter ${id} value`)
        break
      case 'boolean':
        booleanValue = requireBoolean(slot.value, `Filter ${id} value`)
        break
      case 'date':
        dateValue = requireIsoDay(slot.value, `Filter ${id} value`)
        break
      case 'stringList':
        stringValues = requireStringArray(slot.value, `Filter ${id} value`)
        break
      case 'numberList': {
        const list = slot.value
        if (
          !Array.isArray(list) ||
          list.length !== 2 ||
          list.some((v) => typeof v !== 'number' || !Number.isFinite(v))
        ) {
          throw new Error(`Filter ${id} value: BETWEEN requires exactly two finite numbers`)
        }
        numberValues = list as number[]
        if (numberValues[0] > numberValues[1]) {
          throw new Error(`Filter ${id} BETWEEN range start must be <= range end`)
        }
        break
      }
      case 'dateList': {
        const list = slot.value
        if (!Array.isArray(list) || list.length !== 2 || !list.every(isValidIsoDay)) {
          throw new Error(`Filter ${id} value: BETWEEN requires exactly two ISO dates`)
        }
        dateValues = list as string[]
        if (dateValues[0] > dateValues[1]) {
          throw new Error(`Filter ${id} BETWEEN range start must be <= range end`)
        }
        break
      }
    }

    return {
      id,
      fieldId,
      operator,
      stringValue,
      numberValue,
      booleanValue,
      dateValue,
      stringValues,
      numberValues,
      dateValues,
    }
  })

  // ── dimensions (Contract A.4, A.6) ─────────────────────────────────────
  if (!Array.isArray(obj.dimensions)) {
    throw new Error('Custom report config dimensions must be an array')
  }
  if (obj.dimensions.length < 1) {
    throw new Error('Custom report config requires at least one dimension')
  }
  if (obj.dimensions.length > MAX_CUSTOM_DIMENSIONS) {
    throw new Error(`Custom report config allows at most ${MAX_CUSTOM_DIMENSIONS} dimensions`)
  }
  const dimensionIds = new Set<string>()
  const dimensions: CustomReportDimension[] = obj.dimensions.map((entry) => {
    if (!isPlainObject(entry)) throw new Error('Custom report dimension must be an object')
    assertKeys(
      entry,
      ['id', 'fieldId', 'calculation', 'granularity'] as const,
      'Custom report dimension',
    )
    const id = requireNonEmptyString(entry.id, 'Custom report dimension id')
    if (dimensionIds.has(id)) throw new Error(`duplicate dimension id: ${id}`)
    dimensionIds.add(id)

    const hasField = entry.fieldId !== undefined && entry.fieldId !== null
    const hasCalculation = entry.calculation !== undefined && entry.calculation !== null
    if (hasField === hasCalculation) {
      throw new Error(`dimension ${id} must specify exactly one of fieldId or calculation`)
    }

    if (hasField) {
      const fieldId = requireNonEmptyString(entry.fieldId, 'Custom report dimension fieldId')
      const field = fieldByKey(dataSource, fieldId)
      if (!field) {
        throw new Error(`Unknown custom report dimension field for ${dataSource}: ${fieldId}`)
      }
      if (!field.roles.includes('DIMENSION')) {
        throw new Error(`Field ${fieldId} cannot be used as a dimension`)
      }
      const granularity =
        entry.granularity === undefined || entry.granularity === null ? null : entry.granularity
      if (field.isDate) {
        if (!isCustomReportGranularity(granularity)) {
          throw new Error(
            `Date dimension ${id} requires a granularity of DAY, WEEK, MONTH, QUARTER or YEAR`,
          )
        }
      } else if (granularity !== null) {
        throw new Error(`Dimension ${id} granularity is only valid on date fields`)
      }
      return { id, fieldId, calculation: null, granularity }
    }

    if (!isPlainObject(entry.calculation)) {
      throw new Error(`Dimension ${id} calculation must be an object`)
    }
    assertKeys(
      entry.calculation,
      ['kind', 'sourceFieldId', 'granularity', 'bucketSize'] as const,
      'Custom report dimension calculation',
    )
    if (!isCustomReportCalculatedDimensionKind(entry.calculation.kind)) {
      throw new Error(
        `Dimension ${id} has an unknown calculation kind: ${String(entry.calculation.kind)}`,
      )
    }
    const sourceFieldId = requireNonEmptyString(
      entry.calculation.sourceFieldId,
      `Dimension ${id} calculation sourceFieldId`,
    )
    const sourceField = fieldByKey(dataSource, sourceFieldId)
    if (!sourceField) {
      throw new Error(`Dimension ${id} calculation references an unknown field: ${sourceFieldId}`)
    }
    let calculation: CustomReportCalculatedDimension
    if (entry.calculation.kind === 'DATE_PART') {
      if (!sourceField.isDate) {
        throw new Error(`DATE_PART dimension ${id} requires a date source field`)
      }
      if (!isCustomReportGranularity(entry.calculation.granularity)) {
        throw new Error(
          `DATE_PART dimension ${id} requires a granularity of DAY, WEEK, MONTH, QUARTER or YEAR`,
        )
      }
      if (entry.calculation.bucketSize !== undefined && entry.calculation.bucketSize !== null) {
        throw new Error(`DATE_PART dimension ${id} must not carry a bucketSize`)
      }
      calculation = {
        kind: 'DATE_PART',
        sourceFieldId,
        granularity: entry.calculation.granularity,
      }
    } else {
      if (!sourceField.isNumeric) {
        throw new Error(`NUMBER_BUCKET dimension ${id} requires a numeric source field`)
      }
      const bucketSize = requireFiniteNumber(
        entry.calculation.bucketSize,
        `NUMBER_BUCKET dimension ${id} bucketSize`,
      )
      if (bucketSize <= 0) {
        throw new Error(`NUMBER_BUCKET dimension ${id} bucketSize must be positive`)
      }
      if (entry.calculation.granularity !== undefined && entry.calculation.granularity !== null) {
        throw new Error(`NUMBER_BUCKET dimension ${id} must not carry a granularity`)
      }
      calculation = { kind: 'NUMBER_BUCKET', sourceFieldId, bucketSize }
    }
    return { id, fieldId: null, calculation, granularity: null }
  })

  // ── metrics (Contract A.4, A.7) ────────────────────────────────────────
  if (!Array.isArray(obj.metrics)) {
    throw new Error('Custom report config metrics must be an array')
  }
  if (!Array.isArray(obj.calculatedFields)) {
    throw new Error('Custom report config calculatedFields must be an array')
  }
  const totalMetrics = obj.metrics.length + obj.calculatedFields.length
  if (totalMetrics < 1) {
    throw new Error('Custom report config requires at least one metric')
  }
  if (totalMetrics > MAX_CUSTOM_METRICS) {
    throw new Error(
      `Custom report config allows at most ${MAX_CUSTOM_METRICS} metrics in total (base plus calculated)`,
    )
  }

  const metricIds = new Set<string>()
  const metrics: CustomReportMetric[] = obj.metrics.map((entry) => {
    if (!isPlainObject(entry)) throw new Error('Custom report metric must be an object')
    assertKeys(entry, ['id', 'fieldId', 'aggregation', 'alias'] as const, 'Custom report metric')
    const id = requireNonEmptyString(entry.id, 'Custom report metric id')
    if (metricIds.has(id)) throw new Error(`duplicate metric id: ${id}`)
    metricIds.add(id)
    const fieldId = requireNonEmptyString(entry.fieldId, 'Custom report metric fieldId')
    const field = fieldByKey(dataSource, fieldId)
    if (!field) {
      throw new Error(`Unknown custom report metric field for ${dataSource}: ${fieldId}`)
    }
    if (!isCustomReportAggregation(entry.aggregation)) {
      throw new Error(`Unsupported aggregation: ${String(entry.aggregation)}`)
    }
    const aggregation = entry.aggregation
    if (
      (aggregation === 'SUM' ||
        aggregation === 'AVERAGE' ||
        aggregation === 'MIN' ||
        aggregation === 'MAX') &&
      !field.isNumeric
    ) {
      throw new Error(
        `Aggregation ${aggregation} requires a numeric field, but ${fieldId} is not numeric`,
      )
    }
    if (!field.roles.includes('METRIC')) {
      throw new Error(`Field ${fieldId} cannot be used as a metric`)
    }
    if (!field.aggregations.includes(aggregation)) {
      throw new Error(`Aggregation ${aggregation} is not supported for field ${fieldId}`)
    }
    if (entry.alias !== undefined && entry.alias !== null) {
      if (typeof entry.alias !== 'string' || entry.alias.trim().length === 0) {
        throw new Error(`Metric ${id} alias must be a non-empty string`)
      }
    }
    return {
      id,
      fieldId,
      aggregation,
      alias: (entry.alias as string | null | undefined)?.trim() || id,
    }
  })

  // ── calculated fields (Contract A.8) ───────────────────────────────────
  const calcIds = new Set<string>()
  const aliasSet = new Set<string>()
  for (const metric of metrics) {
    if (aliasSet.has(metric.alias)) throw new Error(`Duplicate metric alias: ${metric.alias}`)
    aliasSet.add(metric.alias)
  }

  const baseAliasSet = new Set(metrics.map((m) => m.alias))
  const calculatedFields = obj.calculatedFields.map((entry) => {
    if (!isPlainObject(entry)) throw new Error('Custom report calculated field must be an object')
    assertKeys(
      entry,
      ['id', 'alias', 'label', 'expression'] as const,
      'Custom report calculated field',
    )
    const id = requireNonEmptyString(entry.id, 'Custom report calculated field id')
    if (calcIds.has(id)) throw new Error(`duplicate calculated field id: ${id}`)
    calcIds.add(id)
    const alias = requireNonEmptyString(entry.alias, 'Custom report calculated field alias')
    if (aliasSet.has(alias)) throw new Error(`Duplicate metric alias: ${alias}`)
    aliasSet.add(alias)
    const label = requireNullableString(entry.label, 'Custom report calculated field label')
    const expression = requireNonEmptyString(
      entry.expression,
      'Custom report calculated field expression',
    )
    // Expressions reference BASE metric aliases only — never other calculated
    // fields — which structurally rules out forward/self/cyclic references.
    if (baseAliasSet.has(alias)) {
      throw new Error(`Calculated field alias must not shadow a base metric alias: ${alias}`)
    }
    parseExpression(expression, baseAliasSet)
    return { id, alias, label, expression }
  })

  // ── visualization (Contract A.2, A.10) ───────────────────────────────
  if (!isPlainObject(obj.visualization)) {
    throw new Error('Custom report config visualization must be an object')
  }
  // v1 persisted rows carry the Story 6.3 seven-field shape; v2 adds the
  // approved color tokens and legend position. Version/key mixing fails closed.
  assertKeys(
    obj.visualization,
    isV1
      ? ([
          'type',
          'title',
          'showLegend',
          'showDataLabels',
          'xAxisLabel',
          'yAxisLabel',
          'orientation',
        ] as const)
      : ([
          'type',
          'title',
          'showLegend',
          'showDataLabels',
          'xAxisLabel',
          'yAxisLabel',
          'orientation',
          'colors',
          'legendPosition',
        ] as const),
    'Custom report visualization',
  )
  if (!isCustomReportChartType(obj.visualization.type)) {
    throw new Error(
      'Custom report visualization type must be one of TABLE, LINE, BAR, PIE, DONUT, AREA, FUNNEL, SCATTER, HEATMAP',
    )
  }
  const chartType = obj.visualization.type
  const title = requireNullableString(obj.visualization.title, 'Visualization title')
  const showLegend =
    obj.visualization.showLegend === undefined
      ? false
      : requireBoolean(obj.visualization.showLegend, 'Visualization showLegend')
  const showDataLabels =
    obj.visualization.showDataLabels === undefined
      ? false
      : requireBoolean(obj.visualization.showDataLabels, 'Visualization showDataLabels')
  const xAxisLabel = requireNullableString(obj.visualization.xAxisLabel, 'Visualization xAxisLabel')
  const yAxisLabel = requireNullableString(obj.visualization.yAxisLabel, 'Visualization yAxisLabel')
  const rawOrientation = obj.visualization.orientation
  let orientation: CustomReportOrientation | null = null
  if (rawOrientation !== undefined && rawOrientation !== null) {
    if (!isCustomReportOrientation(rawOrientation)) {
      throw new Error('Visualization orientation must be VERTICAL or HORIZONTAL')
    }
    orientation = rawOrientation
    if (chartType !== 'BAR') {
      throw new Error('Visualization orientation is only valid for BAR charts')
    }
  } else if (chartType === 'BAR') {
    // Contract A.4: BAR orientation is required/defaulted to VERTICAL.
    orientation = 'VERTICAL'
  }

  // ── v2 colors + legend position (Contract A.2) ───────────────────────
  let colors: CustomReportColorToken[]
  if (isV1) {
    // v1 rows never carry colors — normalize to the full default palette.
    colors = [...CUSTOM_REPORT_DEFAULT_COLORS]
  } else if (obj.visualization.colors === undefined || obj.visualization.colors === null) {
    colors = [...CUSTOM_REPORT_DEFAULT_COLORS]
  } else {
    const rawColors = obj.visualization.colors
    if (!Array.isArray(rawColors)) {
      throw new Error('Visualization colors must be an array of approved color tokens')
    }
    if (rawColors.length === 0) {
      // Empty input normalizes to the full default palette (Contract A.2).
      colors = [...CUSTOM_REPORT_DEFAULT_COLORS]
    } else {
      if (rawColors.length > 10) {
        throw new Error('Visualization colors must contain at most 10 approved color tokens')
      }
      if (!rawColors.every(isCustomReportColorToken)) {
        throw new Error('Visualization colors must be approved color tokens (no arbitrary colors)')
      }
      colors = rawColors as CustomReportColorToken[]
    }
  }
  let legendPosition: CustomReportLegendPosition
  if (isV1) {
    legendPosition = 'BOTTOM'
  } else if (
    obj.visualization.legendPosition === undefined ||
    obj.visualization.legendPosition === null
  ) {
    legendPosition = 'BOTTOM'
  } else {
    if (!isCustomReportLegendPosition(obj.visualization.legendPosition)) {
      throw new Error('Visualization legendPosition must be TOP, RIGHT, BOTTOM or LEFT')
    }
    legendPosition = obj.visualization.legendPosition
  }

  const visualization: CustomReportVisualization = {
    type: chartType,
    title,
    showLegend,
    showDataLabels,
    xAxisLabel,
    yAxisLabel,
    orientation,
    colors,
    legendPosition,
  }

  // Chart-type compatibility comes from the SAME closed matrix exported as
  // `chartCompatibilityErrors` — backend validation and the client-side
  // mirror can never drift (Contract A.4). Thrown before sort validation to
  // keep the historical error precedence.
  const pendingConfig: CustomReportConfig = {
    version: 2,
    dataSource,
    filters,
    dimensions,
    metrics,
    calculatedFields,
    visualization,
    sort: [],
  }
  const compatibilityErrors = chartCompatibilityErrors(pendingConfig)
  if (compatibilityErrors.length > 0) {
    throw new Error(compatibilityErrors[0])
  }

  // ── sort (Contract A.9) ────────────────────────────────────────────────
  if (!Array.isArray(obj.sort)) {
    throw new Error('Custom report config sort must be an array')
  }
  if (obj.sort.length > MAX_CUSTOM_SORTS) {
    throw new Error(`Custom report config allows at most ${MAX_CUSTOM_SORTS} sorts`)
  }
  const selectedIds = new Set<string>([
    ...dimensions.map((d) => d.id),
    ...metrics.map((m) => m.id),
    ...calculatedFields.map((c) => c.id),
  ])
  const sortIds = new Set<string>()
  const sort: CustomReportSort[] = obj.sort.map((entry) => {
    if (!isPlainObject(entry)) throw new Error('Custom report sort must be an object')
    assertKeys(entry, ['id', 'targetId', 'direction'] as const, 'Custom report sort')
    const id = requireNonEmptyString(entry.id, 'Custom report sort id')
    if (sortIds.has(id)) throw new Error(`duplicate sort id: ${id}`)
    sortIds.add(id)
    const targetId = requireNonEmptyString(entry.targetId, 'Custom report sort targetId')
    if (!selectedIds.has(targetId)) {
      throw new Error(
        `Sort target ${targetId} is not a selected dimension, metric or calculated field`,
      )
    }
    if (!isCustomReportSortDirection(entry.direction)) {
      throw new Error('Sort direction must be ASC or DESC')
    }
    return { id, targetId, direction: entry.direction }
  })

  return {
    version: 2,
    dataSource,
    filters,
    dimensions,
    metrics,
    calculatedFields,
    visualization,
    sort,
  }
}

// ─── Defensive read-path parsing (Contract A.3) ──────────────────────────────

export type CustomConfigParseResult =
  | { ok: true; config: CustomReportConfig; warnings: string[] }
  | { ok: false; warnings: string[] }

/**
 * Defensive read-path parsing. Never throws. A corrupt persisted config
 * returns an explicit invalid result with warnings — it is never silently
 * rewritten into a sales report or into a safe-looking default.
 */
export function parseCustomReportConfig(raw: unknown): CustomConfigParseResult {
  try {
    const config = validateCustomReportConfig(raw)
    return { ok: true, config, warnings: [] }
  } catch (err) {
    return { ok: false, warnings: [(err as Error).message] }
  }
}

/** Rounding helper shared with the execution engine (Contract A.7). */
export function roundCustomNumber(value: number): number {
  return round2(value)
}
