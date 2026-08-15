/**
 * Story 6.3 (Contract B): server-owned closed field catalogue.
 *
 * `customReportFieldCatalog(dataSource)` is the single UI/backend source of
 * truth. The strict config validator and the execution engine consume the
 * SAME catalogue definitions: a field not advertised here can never validate
 * or execute, and a field advertised here must be executable.
 *
 * `readGate` is the required source-domain permission per section B:
 * CONTACTS→CONTACT:READ, DEALS→DEAL:READ, TASKS→TASK:READ and
 * ACTIVITIES→CONTACT:READ (activity visibility derives from the active parent
 * Contact).
 */
import {
  CUSTOM_REPORT_AGGREGATIONS,
  CUSTOM_REPORT_FILTER_OPERATORS,
  CUSTOM_REPORT_VALUE_TYPES,
} from './custom-report-types'
import type {
  CustomReportAggregation,
  CustomReportDataSource,
  CustomReportFieldRole,
  CustomReportFilterOperator,
  CustomReportRelationKind,
  CustomReportValueType,
} from './custom-report-types'

export interface CustomReportField {
  key: string
  label: string
  valueType: CustomReportValueType
  roles: CustomReportFieldRole[]
  aggregations: CustomReportAggregation[]
  filterOperators: CustomReportFilterOperator[]
  relationKind: CustomReportRelationKind | null
  isNumeric: boolean
  isCurrency: boolean
  isDate: boolean
}

export interface CustomReportSourceCatalog {
  dataSource: CustomReportDataSource
  readGate: 'CONTACT' | 'DEAL' | 'TASK'
  fields: CustomReportField[]
}

type FieldSeed = {
  key: string
  label: string
  valueType?: CustomReportValueType
  roles?: CustomReportFieldRole[]
  aggregations?: CustomReportAggregation[]
  filterOperators?: CustomReportFilterOperator[]
  relationKind?: CustomReportRelationKind | null
  isNumeric?: boolean
  isCurrency?: boolean
  isDate?: boolean
}

// ─── Operator families by value type (Contract A.5) ──────────────────────────

const STRING_OPS = ['EQ', 'NOT_EQ', 'CONTAINS', 'IN'] as const
const ENUM_RELATION_OPS = ['EQ', 'NOT_EQ', 'IN'] as const
const NUMBER_OPS = ['EQ', 'GT', 'GTE', 'LT', 'LTE', 'BETWEEN'] as const
const DATE_OPS = ['ON', 'BEFORE', 'AFTER', 'BETWEEN'] as const
const BOOLEAN_OPS = ['EQ'] as const
const TAGS_OPS = ['HAS_ANY', 'HAS_ALL'] as const

const COUNT_AGGS = ['COUNT', 'DISTINCT_COUNT'] as const
const ALL_AGGS = ['COUNT', 'DISTINCT_COUNT', 'SUM', 'AVERAGE', 'MIN', 'MAX'] as const

function field(seed: FieldSeed): CustomReportField {
  const valueType: CustomReportValueType = seed.valueType ?? 'STRING'
  const isNumericValue = valueType === 'NUMBER' || valueType === 'CURRENCY'
  // Multi-valued fields (tags / active product) cannot be single-value metrics.
  const isMulti = valueType === 'TAGS' || seed.relationKind === 'PRODUCT'
  const roles = seed.roles ?? ['FILTER', 'DIMENSION', ...(isMulti ? [] : (['METRIC'] as const))]
  const defaults: Pick<CustomReportField, 'aggregations' | 'filterOperators' | 'isNumeric'> =
    isNumericValue
      ? { aggregations: [...ALL_AGGS], filterOperators: [...NUMBER_OPS], isNumeric: true }
      : {
          aggregations: [...COUNT_AGGS],
          filterOperators: operatorFamily(valueType),
          isNumeric: false,
        }
  return {
    key: seed.key,
    label: seed.label,
    valueType,
    roles,
    aggregations: seed.aggregations ?? [...defaults.aggregations],
    filterOperators: seed.filterOperators ?? [...defaults.filterOperators],
    relationKind: seed.relationKind ?? null,
    isNumeric: seed.isNumeric ?? defaults.isNumeric,
    isCurrency: seed.isCurrency ?? false,
    isDate: seed.isDate ?? (valueType === 'DATE' || valueType === 'DATETIME'),
  }
}

function operatorFamily(valueType: CustomReportValueType): CustomReportFilterOperator[] {
  switch (valueType) {
    case 'STRING':
      return [...STRING_OPS]
    case 'ENUM':
    case 'RELATION':
    case 'CURRENCY':
      return [...ENUM_RELATION_OPS]
    case 'NUMBER':
      return [...NUMBER_OPS]
    case 'DATE':
    case 'DATETIME':
      return [...DATE_OPS]
    case 'BOOLEAN':
      return [...BOOLEAN_OPS]
    case 'TAGS':
      return [...TAGS_OPS]
  }
}

function countMetricField(
  key: string,
  label: string,
  valueType: CustomReportValueType = 'STRING',
): CustomReportField {
  return field({
    key,
    label,
    valueType,
    roles: ['FILTER', 'DIMENSION', 'METRIC'],
    aggregations: [...COUNT_AGGS],
  })
}

// ─── Source catalogues (Contract B.12) ───────────────────────────────────────

const CONTACTS_FIELDS: CustomReportField[] = [
  countMetricField('contact.id', 'Contact ID'),
  field({ key: 'contact.createdAt', label: 'Created at', valueType: 'DATETIME' }),
  field({ key: 'contact.updatedAt', label: 'Updated at', valueType: 'DATETIME' }),
  field({
    key: 'contact.owner',
    label: 'Owner',
    valueType: 'RELATION',
    relationKind: 'OWNER',
  }),
  field({ key: 'contact.team', label: 'Team', valueType: 'RELATION', relationKind: 'TEAM' }),
  countMetricField('contact.company', 'Company'),
  countMetricField('contact.jobTitle', 'Job title'),
  countMetricField('contact.addressCity', 'City'),
  countMetricField('contact.addressCountry', 'Country'),
  countMetricField('contact.department', 'Department'),
  countMetricField('contact.timezone', 'Timezone'),
  countMetricField('contact.language', 'Language'),
  countMetricField('contact.source', 'Source'),
  field({ key: 'contact.tags', label: 'Tags', valueType: 'TAGS' }),
]

const DEALS_FIELDS: CustomReportField[] = [
  countMetricField('deal.id', 'Deal ID'),
  field({ key: 'deal.createdAt', label: 'Created at', valueType: 'DATETIME' }),
  field({ key: 'deal.updatedAt', label: 'Updated at', valueType: 'DATETIME' }),
  field({ key: 'deal.expectedCloseDate', label: 'Expected close date', valueType: 'DATETIME' }),
  field({ key: 'deal.actualCloseDate', label: 'Actual close date', valueType: 'DATETIME' }),
  field({ key: 'deal.owner', label: 'Owner', valueType: 'RELATION', relationKind: 'OWNER' }),
  field({
    key: 'deal.ownerTeam',
    label: 'Owner team',
    valueType: 'RELATION',
    relationKind: 'TEAM',
  }),
  field({ key: 'deal.stage', label: 'Stage', valueType: 'RELATION', relationKind: 'STAGE' }),
  field({ key: 'deal.status', label: 'Status', valueType: 'ENUM' }),
  field({ key: 'deal.contact', label: 'Contact', valueType: 'RELATION', relationKind: 'CONTACT' }),
  field({ key: 'deal.currency', label: 'Currency', valueType: 'ENUM' }),
  field({ key: 'deal.product', label: 'Product', valueType: 'RELATION', relationKind: 'PRODUCT' }),
  field({
    key: 'deal.value',
    label: 'Value',
    valueType: 'NUMBER',
    isCurrency: true,
  }),
  field({ key: 'deal.probability', label: 'Probability', valueType: 'NUMBER' }),
  field({
    key: 'deal.lineItem.quantity',
    label: 'Line item quantity',
    valueType: 'NUMBER',
    // Line items are a multi-valued relation — never a single-value
    // dimension/filter. Executor aggregates them per deal as metrics only.
    roles: ['METRIC'],
  }),
  field({
    key: 'deal.lineItem.discount',
    label: 'Line item discount',
    valueType: 'NUMBER',
    roles: ['METRIC'],
  }),
  field({
    key: 'deal.lineItem.total',
    label: 'Line item total',
    valueType: 'NUMBER',
    isCurrency: true,
    roles: ['METRIC'],
  }),
]

const TASKS_FIELDS: CustomReportField[] = [
  countMetricField('task.id', 'Task ID'),
  field({ key: 'task.createdAt', label: 'Created at', valueType: 'DATETIME' }),
  field({ key: 'task.updatedAt', label: 'Updated at', valueType: 'DATETIME' }),
  field({ key: 'task.dueDate', label: 'Due date', valueType: 'DATETIME' }),
  field({ key: 'task.completedAt', label: 'Completed at', valueType: 'DATETIME' }),
  field({
    key: 'task.assignee',
    label: 'Assignee',
    valueType: 'RELATION',
    relationKind: 'ASSIGNEE',
  }),
  field({
    key: 'task.assigneeTeam',
    label: 'Assignee team',
    valueType: 'RELATION',
    relationKind: 'TEAM',
  }),
  field({ key: 'task.status', label: 'Status', valueType: 'ENUM' }),
  field({ key: 'task.priority', label: 'Priority', valueType: 'ENUM' }),
  field({ key: 'task.contact', label: 'Contact', valueType: 'RELATION', relationKind: 'CONTACT' }),
  field({ key: 'task.deal', label: 'Deal', valueType: 'RELATION', relationKind: 'DEAL' }),
  field({ key: 'task.isRecurring', label: 'Is recurring', valueType: 'BOOLEAN' }),
  field({ key: 'task.recurrencePattern', label: 'Recurrence pattern', valueType: 'ENUM' }),
]

const ACTIVITIES_FIELDS: CustomReportField[] = [
  countMetricField('activity.id', 'Activity ID'),
  field({ key: 'activity.createdAt', label: 'Created at', valueType: 'DATETIME' }),
  field({ key: 'activity.type', label: 'Type', valueType: 'ENUM' }),
  countMetricField('activity.source', 'Source'),
  field({
    key: 'activity.creator',
    label: 'Creator',
    valueType: 'RELATION',
    relationKind: 'CREATOR',
  }),
  field({
    key: 'activity.contact',
    label: 'Contact',
    valueType: 'RELATION',
    relationKind: 'CONTACT',
  }),
  field({
    key: 'activity.contactOwner',
    label: 'Contact owner',
    valueType: 'RELATION',
    relationKind: 'OWNER',
  }),
  field({
    key: 'activity.contactTeam',
    label: 'Contact team',
    valueType: 'RELATION',
    relationKind: 'TEAM',
  }),
  field({ key: 'activity.contactTags', label: 'Contact tags', valueType: 'TAGS' }),
]

export const CUSTOM_REPORT_CATALOGS: Record<CustomReportDataSource, CustomReportSourceCatalog> = {
  CONTACTS: {
    dataSource: 'CONTACTS',
    readGate: 'CONTACT',
    fields: CONTACTS_FIELDS,
  },
  DEALS: {
    dataSource: 'DEALS',
    readGate: 'DEAL',
    fields: DEALS_FIELDS,
  },
  TASKS: {
    dataSource: 'TASKS',
    readGate: 'TASK',
    fields: TASKS_FIELDS,
  },
  ACTIVITIES: {
    dataSource: 'ACTIVITIES',
    readGate: 'CONTACT',
    fields: ACTIVITIES_FIELDS,
  },
}

export function catalogFor(dataSource: CustomReportDataSource): CustomReportSourceCatalog {
  return CUSTOM_REPORT_CATALOGS[dataSource]
}

export function customReportFieldCatalog(dataSource: CustomReportDataSource): {
  dataSource: CustomReportDataSource
  fields: CustomReportField[]
} {
  const catalog = catalogFor(dataSource)
  return { dataSource, fields: catalog.fields }
}

export function fieldByKey(
  dataSource: CustomReportDataSource,
  key: string,
): CustomReportField | undefined {
  return catalogFor(dataSource).fields.find((f) => f.key === key)
}

// ─── Closed vocabulary sanity (single-source guard) ─────────────────────────

function assertClosedVocabulary(): void {
  for (const catalog of Object.values(CUSTOM_REPORT_CATALOGS)) {
    for (const f of catalog.fields) {
      if (!CUSTOM_REPORT_VALUE_TYPES.includes(f.valueType)) {
        throw new Error(`Catalogue field ${f.key} has an unknown value type ${f.valueType}`)
      }
      for (const agg of f.aggregations) {
        if (!CUSTOM_REPORT_AGGREGATIONS.includes(agg)) {
          throw new Error(`Catalogue field ${f.key} has an unknown aggregation ${agg}`)
        }
      }
      for (const op of f.filterOperators) {
        if (!CUSTOM_REPORT_FILTER_OPERATORS.includes(op)) {
          throw new Error(`Catalogue field ${f.key} has an unknown operator ${op}`)
        }
      }
    }
  }
}

assertClosedVocabulary()
