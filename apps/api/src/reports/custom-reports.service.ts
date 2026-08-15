/**
 * Story 6.3 (Contract C): CustomReportsService — four-source
 * filter/group/aggregate/sort dispatch with bounded, deterministic execution.
 *
 * - Preview and saved-data execution share ONE engine. Both reuse the SAME
 *   shared visibility predicate per source (ContactsService.buildContactWhere,
 *   DealsService.buildDealWhere, TasksService.buildTaskWhere,
 *   ActivityService.buildFeedWhere) so totals, rows and series can never leak
 *   cross-tenant/non-visible records (Contract C.14, security invariant 1-4).
 * - Reads are bounded: a scope wider than MAX_CUSTOM_SCOPE_ROWS or a result
 *   wider than MAX_GROUPED_ROWS fails explicitly with a "narrow your filters
 *   or date range" error — never silent truncation (Contract C.20).
 * - Money metrics keep the Story 6.2 no-FX behavior: unlike currencies are
 *   never summed; mixed currencies null money metrics with a warning unless a
 *   currency filter or currency dimension is present (Contract A.7).
 * - Preview is read-only and unaudited. saveCustomReport writes exactly one
 *   service-level CREATE/UPDATE audit row and reuses the shared sales
 *   persistence invariants (50-active limit + case-insensitive name
 *   uniqueness) via SalesReportsService (Contract C.17).
 */
import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common'
import type { Prisma } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { ContactsService } from '../contacts/contacts.service'
import { DealsService } from '../deals/deals.service'
import { TasksService } from '../tasks/tasks.service'
import { ActivityService } from '../activities/activities.service'
import { SalesReportsService, REPORT_SELECT } from './sales-reports.service'
import { fieldByKey } from './custom-report-catalog'
import {
  evaluateExpression,
  parseCustomReportConfig,
  parseExpression,
  roundCustomNumber,
  validateCustomReportConfig,
} from './custom-report-config'
import { MAX_REPORT_NAME_LENGTH } from './report-config'
import type {
  CustomReportAggregation,
  CustomReportCalculatedField,
  CustomReportColumnRole,
  CustomReportConfig,
  CustomReportDataSource,
  CustomReportDimension,
  CustomReportFilter,
  CustomReportGranularity,
  CustomReportMetric,
  CustomReportSort,
  CustomReportValueType,
  CustomReportWarningCode,
} from './custom-report-types'

// ─── Bounds (Contract C.20) ──────────────────────────────────────────────────

export const MAX_CUSTOM_SCOPE_ROWS = 10_000
export const MAX_GROUPED_ROWS = 500
const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 100

const MIXED_CURRENCY_MESSAGE =
  'Mixed currencies detected — money values are null until a single currency filter or a currency dimension is used (no FX conversion).'

// ─── Result types (Pothos refs derive from these) ────────────────────────────

export type CustomReportWarning = {
  code: CustomReportWarningCode
  message: string
}

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
  label: string
  value: number | null
}

export type CustomReportSeries = {
  metricId: string
  label: string
  points: CustomReportSeriesPoint[]
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
  truncated: false
}

export type CustomReportOutput = {
  id: string
  name: string
  isPublic: boolean
  createdAt: Date
  updatedAt: Date
  createdBy: string
  config: CustomReportConfig
}

export type CustomReportPaginationInput = {
  page?: number
  pageSize?: number
}

export type CustomReportSaveInput = {
  reportId?: string | null
  name: string
  config: unknown
  isPublic?: boolean
}

// ─── Row shapes (bounded superset selects) ──────────────────────────────────

type RawRow = Record<string, unknown>

function idOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

const CONTACT_ROW_SELECT = {
  id: true,
  ownerId: true,
  teamId: true,
  company: true,
  jobTitle: true,
  addressCity: true,
  addressCountry: true,
  department: true,
  timezone: true,
  language: true,
  source: true,
  createdAt: true,
  updatedAt: true,
  owner: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      teamId: true,
      team: { select: { id: true, name: true } },
    },
  },
  team: { select: { id: true, name: true } },
  tags: { select: { tag: { select: { id: true, name: true } } } },
} as const

const DEAL_ROW_SELECT = {
  id: true,
  value: true,
  probability: true,
  currency: true,
  stageId: true,
  ownerId: true,
  contactId: true,
  createdAt: true,
  updatedAt: true,
  expectedCloseDate: true,
  actualCloseDate: true,
  stage: { select: { id: true, name: true, order: true, isWon: true, isLost: true } },
  owner: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      teamId: true,
      team: { select: { id: true, name: true } },
    },
  },
  contact: { select: { id: true, firstName: true, lastName: true } },
  lineItems: {
    where: { deletedAt: null },
    select: {
      productId: true,
      quantity: true,
      discount: true,
      total: true,
      product: { select: { id: true, name: true, isActive: true, deletedAt: true } },
    },
  },
} as const

const TASK_ROW_SELECT = {
  id: true,
  title: true,
  status: true,
  priority: true,
  dueDate: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  assignedTo: true,
  contactId: true,
  dealId: true,
  isRecurring: true,
  recurrencePattern: true,
  assignee: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      teamId: true,
      team: { select: { id: true, name: true } },
    },
  },
  contact: { select: { id: true, firstName: true, lastName: true } },
  deal: { select: { id: true, title: true } },
} as const

const ACTIVITY_ROW_SELECT = {
  id: true,
  type: true,
  source: true,
  createdBy: true,
  createdAt: true,
  contactId: true,
  contact: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      ownerId: true,
      owner: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          teamId: true,
          team: { select: { id: true, name: true } },
        },
      },
      tags: { select: { tag: { select: { id: true, name: true } } } },
    },
  },
} as const

// ─── Extracted field values ──────────────────────────────────────────────────

type DimValue =
  | { kind: 'string'; value: string | null }
  | { kind: 'number'; value: number | null }
  | { kind: 'boolean'; value: boolean | null }
  | { kind: 'date'; value: Date | null; granularity: CustomReportGranularity | null }
  | { kind: 'relation'; id: string | null; label: string | null }
  | { kind: 'multi'; items: Array<{ id: string; label: string }>; emptyLabel: string }

type GroupAcc = {
  key: string
  dimValues: DimValue[]
  metrics: MetricAcc[]
}

type MetricAcc = {
  nonNull: number
  distinct: Set<string>
  sum: number
  min: number | null
  max: number | null
}

type InternalRow = {
  key: string
  dimKeys: Array<string | null>
  dimLabels: Array<string | null>
  dimValues: DimValue[]
  metricValues: Array<number | null>
  calcValues: Array<number | null>
}

function freshAcc(): MetricAcc {
  return { nonNull: 0, distinct: new Set<string>(), sum: 0, min: null, max: null }
}

function contribute(acc: MetricAcc, value: unknown): void {
  if (value === null || value === undefined) return
  acc.nonNull += 1
  acc.distinct.add(String(value))
  if (typeof value === 'number') {
    acc.sum += value
    if (acc.min === null || value < acc.min) acc.min = value
    if (acc.max === null || value > acc.max) acc.max = value
  }
}

function fullName(
  user: { firstName?: string | null; lastName?: string | null } | null | undefined,
): string | null {
  if (!user) return null
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
  return name.length > 0 ? name : null
}

function isActiveLineItem(li: RawRow): boolean {
  const product = li.product as RawRow | null
  return product !== null && product.isActive === true && product.deletedAt === null
}

// ─── Date bucketing (UTC, deterministic) ─────────────────────────────────────

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function isoWeek(date: Date): number {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNr = (target.getUTCDay() + 6) % 7
  target.setUTCDate(target.getUTCDate() - dayNr + 3)
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4))
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3)
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000))
}

export function bucketKey(date: Date, granularity: CustomReportGranularity): string {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth() + 1
  switch (granularity) {
    case 'DAY':
      return `${y}-${pad2(m)}-${pad2(date.getUTCDate())}`
    case 'WEEK':
      return `${y}-W${pad2(isoWeek(date))}`
    case 'MONTH':
      return `${y}-${pad2(m)}`
    case 'QUARTER':
      return `${y}-Q${Math.floor((m - 1) / 3) + 1}`
    case 'YEAR':
      return `${y}`
  }
}

export function bucketStart(date: Date, granularity: CustomReportGranularity): Date {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth()
  switch (granularity) {
    case 'DAY':
      return new Date(Date.UTC(y, m, date.getUTCDate()))
    case 'WEEK': {
      const day = (date.getUTCDay() + 6) % 7 // Monday = 0
      return new Date(Date.UTC(y, m, date.getUTCDate() - day))
    }
    case 'MONTH':
      return new Date(Date.UTC(y, m, 1))
    case 'QUARTER':
      return new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1))
    case 'YEAR':
      return new Date(Date.UTC(y, 0, 1))
  }
}

export function bucketLabel(date: Date, granularity: CustomReportGranularity): string {
  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth()
  switch (granularity) {
    case 'DAY':
      return `${MONTHS[m]} ${date.getUTCDate()}, ${y}`
    case 'WEEK':
      return `Week of ${MONTHS[m]} ${date.getUTCDate()}, ${y}`
    case 'MONTH':
      return `${MONTHS[m]} ${y}`
    case 'QUARTER':
      return `Q${Math.floor(m / 3) + 1} ${y}`
    case 'YEAR':
      return `${y}`
  }
}

// ─── Group engine (per source) ───────────────────────────────────────────────

type DimSpec = {
  id: string
  fieldId: string | null
  label: string
  valueType: CustomReportValueType
  granularity: CustomReportGranularity | null
  extract: (row: RawRow) => DimValue
}

type MetricSpec = {
  id: string
  fieldId: string
  label: string
  valueType: CustomReportValueType
  aggregation: CustomReportAggregation
  alias: string
  isMoney: boolean
  extractValues: (row: RawRow) => Array<{ value: unknown }>
}

class GroupEngine {
  private readonly dimSpecs: DimSpec[]
  private readonly metricSpecs: MetricSpec[]
  private readonly calcSpecs: CustomReportCalculatedField[]
  private readonly baseAliases: ReadonlySet<string>
  private readonly calcAstCache = new Map<string, ReturnType<typeof parseExpression>>()
  private readonly dimIndexByTargetId = new Map<string, number>()
  private readonly metricIndexByTargetId = new Map<string, number>()
  private readonly calcIndexByTargetId = new Map<string, number>()
  private readonly stageOrderByName = new Map<string, number>()

  constructor(
    private readonly source: CustomReportDataSource,
    private readonly config: CustomReportConfig,
    private readonly creatorLabels: ReadonlyMap<string, string>,
  ) {
    this.dimSpecs = config.dimensions.map((d) => this.buildDimSpec(d))
    this.metricSpecs = config.metrics.map((m) => this.buildMetricSpec(m))
    this.calcSpecs = config.calculatedFields
    this.baseAliases = new Set(this.metricSpecs.map((s) => s.alias))
    this.dimSpecs.forEach((s, i) => this.dimIndexByTargetId.set(s.id, i))
    this.metricSpecs.forEach((s, i) => this.metricIndexByTargetId.set(s.id, i))
    this.calcSpecs.forEach((s, i) => this.calcIndexByTargetId.set(s.id, i))
  }

  // ── field extraction (closed catalogue keys only) ─────────────────────

  private extractField(fieldId: string): (row: RawRow) => DimValue {
    switch (fieldId) {
      // CONTACTS
      case 'contact.id':
        return (r) => ({ kind: 'string', value: String(r.id ?? '') })
      case 'contact.createdAt':
      case 'contact.updatedAt':
        return (r) => ({
          kind: 'date',
          value: (r[fieldId.slice('contact.'.length)] as Date) ?? null,
          granularity: null,
        })
      case 'contact.owner':
        return (r) => {
          const owner = r.owner as RawRow | null
          return { kind: 'relation', id: idOf(owner?.id), label: fullName(owner) }
        }
      case 'contact.team':
        return (r) => {
          const team = r.team as RawRow | null
          return { kind: 'relation', id: idOf(team?.id), label: (team?.name as string) ?? null }
        }
      case 'contact.company':
      case 'contact.jobTitle':
      case 'contact.addressCity':
      case 'contact.addressCountry':
      case 'contact.department':
      case 'contact.timezone':
      case 'contact.language':
      case 'contact.source':
        return (r) => {
          const value = r[fieldId.slice('contact.'.length)]
          return {
            kind: 'string',
            value: typeof value === 'string' && value.length > 0 ? value : null,
          }
        }
      case 'contact.tags':
        return (r) => this.multiFrom(r.tags, 'Untagged')
      // DEALS
      case 'deal.id':
        return (r) => ({ kind: 'string', value: String(r.id ?? '') })
      case 'deal.createdAt':
      case 'deal.updatedAt':
      case 'deal.expectedCloseDate':
      case 'deal.actualCloseDate':
        return (r) => ({
          kind: 'date',
          value: (r[fieldId.slice('deal.'.length)] as Date) ?? null,
          granularity: null,
        })
      case 'deal.owner':
        return (r) => {
          const owner = r.owner as RawRow | null
          return { kind: 'relation', id: idOf(owner?.id), label: fullName(owner) }
        }
      case 'deal.ownerTeam':
        return (r) => {
          const team = (r.owner as RawRow | null)?.team as RawRow | null
          return { kind: 'relation', id: idOf(team?.id), label: (team?.name as string) ?? null }
        }
      case 'deal.stage':
        return (r) => {
          const stage = r.stage as RawRow | null
          return { kind: 'relation', id: idOf(stage?.id), label: (stage?.name as string) ?? null }
        }
      case 'deal.status':
        return (r) => {
          const stage = r.stage as RawRow | null
          const status = stage?.isWon ? 'WON' : stage?.isLost ? 'LOST' : 'OPEN'
          return { kind: 'string', value: status }
        }
      case 'deal.contact':
        return (r) => {
          const contact = r.contact as RawRow | null
          return { kind: 'relation', id: idOf(contact?.id), label: fullName(contact) }
        }
      case 'deal.currency':
        return (r) => ({
          kind: 'string',
          value: typeof r.currency === 'string' ? r.currency : null,
        })
      case 'deal.product':
        return (r) => {
          const items = ((r.lineItems as RawRow[]) ?? []).filter(isActiveLineItem).map((li) => ({
            id: String(li.productId),
            label: String((li.product as RawRow).name ?? li.productId),
          }))
          return { kind: 'multi', items, emptyLabel: 'No product' }
        }
      case 'deal.value':
        return (r) => ({ kind: 'number', value: typeof r.value === 'number' ? r.value : null })
      case 'deal.probability':
        return (r) => ({
          kind: 'number',
          value: typeof r.probability === 'number' ? r.probability : null,
        })
      // TASKS
      case 'task.id':
        return (r) => ({ kind: 'string', value: String(r.id ?? '') })
      case 'task.createdAt':
      case 'task.updatedAt':
      case 'task.dueDate':
      case 'task.completedAt':
        return (r) => ({
          kind: 'date',
          value: (r[fieldId.slice('task.'.length)] as Date) ?? null,
          granularity: null,
        })
      case 'task.assignee':
        return (r) => {
          const assignee = r.assignee as RawRow | null
          return { kind: 'relation', id: idOf(assignee?.id), label: fullName(assignee) }
        }
      case 'task.assigneeTeam':
        return (r) => {
          const team = (r.assignee as RawRow | null)?.team as RawRow | null
          return { kind: 'relation', id: idOf(team?.id), label: (team?.name as string) ?? null }
        }
      case 'task.status':
      case 'task.priority':
        return (r) => ({
          kind: 'string',
          value:
            typeof r[fieldId.slice('task.'.length)] === 'string'
              ? (r[fieldId.slice('task.'.length)] as string)
              : null,
        })
      case 'task.contact':
        return (r) => {
          const contact = r.contact as RawRow | null
          return { kind: 'relation', id: idOf(contact?.id), label: fullName(contact) }
        }
      case 'task.deal':
        return (r) => {
          const deal = r.deal as RawRow | null
          return { kind: 'relation', id: idOf(deal?.id), label: (deal?.title as string) ?? null }
        }
      case 'task.isRecurring':
        return (r) => ({
          kind: 'boolean',
          value: typeof r.isRecurring === 'boolean' ? r.isRecurring : null,
        })
      case 'task.recurrencePattern':
        return (r) => ({
          kind: 'string',
          value: typeof r.recurrencePattern === 'string' ? r.recurrencePattern : null,
        })
      // ACTIVITIES
      case 'activity.id':
        return (r) => ({ kind: 'string', value: String(r.id ?? '') })
      case 'activity.createdAt':
        return (r) => ({ kind: 'date', value: (r.createdAt as Date) ?? null, granularity: null })
      case 'activity.type':
        return (r) => ({ kind: 'string', value: typeof r.type === 'string' ? r.type : null })
      case 'activity.source':
        return (r) => ({
          kind: 'string',
          value:
            typeof r.source === 'string' && (r.source as string).length > 0
              ? (r.source as string)
              : null,
        })
      case 'activity.creator':
        return (r) => {
          const creatorId = typeof r.createdBy === 'string' ? r.createdBy : null
          return {
            kind: 'relation',
            id: creatorId,
            label: creatorId ? this.creatorLabels.get(creatorId) ?? creatorId : null,
          }
        }
      case 'activity.contact':
        return (r) => {
          const contact = r.contact as RawRow | null
          return { kind: 'relation', id: idOf(contact?.id), label: fullName(contact) }
        }
      case 'activity.contactOwner':
        return (r) => {
          const owner = (r.contact as RawRow | null)?.owner as RawRow | null
          return { kind: 'relation', id: idOf(owner?.id), label: fullName(owner) }
        }
      case 'activity.contactTeam':
        return (r) => {
          const team = ((r.contact as RawRow | null)?.owner as RawRow | null)?.team as RawRow | null
          return { kind: 'relation', id: idOf(team?.id), label: (team?.name as string) ?? null }
        }
      case 'activity.contactTags':
        return (r) => this.multiFrom((r.contact as RawRow | null)?.tags, 'Untagged')
      default:
        throw new Error(`Unsupported custom report field: ${fieldId}`)
    }
  }

  private multiFrom(tags: unknown, emptyLabel: string): DimValue {
    const list = (Array.isArray(tags) ? tags : []) as RawRow[]
    return {
      kind: 'multi',
      items: list
        .map((entry) => {
          const tag = entry.tag as RawRow | null
          if (!tag) return null
          return { id: String(tag.id), label: String(tag.name ?? tag.id) }
        })
        .filter((x): x is { id: string; label: string } => x !== null),
      emptyLabel,
    }
  }

  private buildDimSpec(dimension: CustomReportDimension): DimSpec {
    if (dimension.calculation) {
      if (dimension.calculation.kind === 'DATE_PART') {
        const granularity = dimension.calculation.granularity
        const extractDate = this.extractField(dimension.calculation.sourceFieldId)
        return {
          id: dimension.id,
          fieldId: null,
          label: `Date part (${dimension.calculation.sourceFieldId})`,
          valueType: 'DATE',
          granularity,
          extract: (row): DimValue => {
            const raw = extractDate(row)
            const date = raw.kind === 'date' ? raw.value : null
            if (!date) return { kind: 'date', value: null, granularity }
            return { kind: 'date', value: bucketStart(date, granularity), granularity }
          },
        }
      }
      const bucketSize = dimension.calculation.bucketSize
      const extractNumber = this.extractField(dimension.calculation.sourceFieldId)
      return {
        id: dimension.id,
        fieldId: null,
        label: `Bucket (${dimension.calculation.sourceFieldId})`,
        valueType: 'NUMBER',
        granularity: null,
        extract: (row): DimValue => {
          const raw = extractNumber(row)
          const value = raw.kind === 'number' ? raw.value : null
          if (value === null) return { kind: 'number', value: null }
          return { kind: 'number', value: Math.floor(value / bucketSize) * bucketSize }
        },
      }
    }
    const fieldId = dimension.fieldId as string
    const field = fieldByKey(this.source, fieldId)
    const extract = this.extractField(fieldId)
    const granularity = dimension.granularity
    if (field?.isDate && granularity) {
      return {
        id: dimension.id,
        fieldId,
        label: field.label,
        valueType: 'DATE',
        granularity,
        extract: (row): DimValue => {
          const raw = extract(row)
          const date = raw.kind === 'date' ? raw.value : null
          if (!date) return { kind: 'date', value: null, granularity }
          return { kind: 'date', value: bucketStart(date, granularity), granularity }
        },
      }
    }
    return {
      id: dimension.id,
      fieldId,
      label: field?.label ?? fieldId,
      valueType: field?.valueType ?? 'STRING',
      granularity: null,
      extract,
    }
  }

  private buildMetricSpec(metric: CustomReportMetric): MetricSpec {
    const field = fieldByKey(this.source, metric.fieldId)
    const isLineItem = metric.fieldId.startsWith('deal.lineItem.')
    const isMoney =
      this.source === 'DEALS' &&
      (metric.fieldId === 'deal.value' || metric.fieldId === 'deal.lineItem.total')
    const extractValues = (row: RawRow): Array<{ value: unknown }> => {
      if (isLineItem) {
        const items = ((row.lineItems as RawRow[]) ?? []).filter(isActiveLineItem)
        const key = metric.fieldId.slice('deal.lineItem.'.length)
        return items.map((li) => ({ value: li[key] ?? null }))
      }
      const raw = this.extractField(metric.fieldId)(row)
      let value: unknown = null
      switch (raw.kind) {
        case 'string':
          value = raw.value
          break
        case 'number':
          value = raw.value
          break
        case 'boolean':
          value = raw.value
          break
        case 'date':
          value = raw.value
          break
        case 'relation':
          value = raw.id
          break
        case 'multi':
          // A multi-valued field (tags/products) as a metric counts the row
          // once per item — consistent with the multi-dimension grouping.
          value = raw.items.length > 0 ? raw.items[0]?.id ?? null : null
          break
      }
      return [{ value }]
    }
    return {
      id: metric.id,
      fieldId: metric.fieldId,
      label: field?.label ?? metric.fieldId,
      valueType:
        isMoney &&
        (metric.aggregation === 'SUM' ||
          metric.aggregation === 'AVERAGE' ||
          metric.aggregation === 'MIN' ||
          metric.aggregation === 'MAX')
          ? 'CURRENCY'
          : 'NUMBER',
      aggregation: metric.aggregation,
      alias: metric.alias,
      isMoney,
      extractValues,
    }
  }

  // ── grouping ──────────────────────────────────────────────────────────

  group(rows: RawRow[]): Map<string, GroupAcc> {
    const groups = new Map<string, GroupAcc>()
    for (const row of rows) {
      const dimValues = this.dimSpecs.map((s) => s.extract(row))

      // Stage order capture for FUNNEL series ordering (by stage order, not value).
      const stage = row.stage as RawRow | null
      if (stage && typeof stage.name === 'string' && typeof stage.order === 'number') {
        if (!this.stageOrderByName.has(stage.name)) {
          this.stageOrderByName.set(stage.name, stage.order)
        }
      }

      // Expand multi-valued dimensions (tags/products) into combinations.
      let expansions: DimValue[][] = [[]]
      for (const dimValue of dimValues) {
        if (dimValue.kind === 'multi') {
          const items =
            dimValue.items.length > 0
              ? dimValue.items.map((item) => ({
                  kind: 'relation' as const,
                  id: item.id,
                  label: item.label,
                }))
              : [{ kind: 'relation' as const, id: 'unassigned', label: dimValue.emptyLabel }]
          const next: DimValue[][] = []
          for (const combo of expansions) {
            for (const item of items) {
              next.push([...combo, item])
            }
          }
          expansions = next
        } else {
          for (const combo of expansions) combo.push(dimValue)
        }
      }

      for (const combo of expansions) {
        // Null dimension values group under the stable `unassigned` key while
        // the internal dimKeys keep null for nulls-last sorting.
        const keys = combo.map((v) => this.dimKey(v) ?? 'unassigned')
        const key = keys.join('|')
        let group = groups.get(key)
        if (!group) {
          group = { key, dimValues: combo, metrics: this.metricSpecs.map(() => freshAcc()) }
          groups.set(key, group)
        }
        this.metricSpecs.forEach((spec, i) => {
          const acc = group.metrics[i]
          for (const contribution of spec.extractValues(row)) {
            contribute(acc, contribution.value)
          }
        })
      }
    }
    return groups
  }

  private dimKey(value: DimValue): string | null {
    switch (value.kind) {
      case 'string':
        return value.value
      case 'number':
        return value.value === null ? null : String(value.value)
      case 'boolean':
        return value.value === null ? null : String(value.value)
      case 'date':
        return value.value === null ? null : bucketKey(value.value, value.granularity ?? 'DAY')
      case 'relation':
        return value.id
      case 'multi':
        return null
    }
  }

  private dimLabel(value: DimValue): string {
    switch (value.kind) {
      case 'string':
        return value.value ?? 'Unassigned'
      case 'number':
        return value.value === null ? 'Unassigned' : String(value.value)
      case 'boolean':
        return value.value === null ? 'Unassigned' : String(value.value)
      case 'date':
        return value.value === null
          ? 'Unassigned'
          : bucketLabel(value.value, value.granularity ?? 'DAY')
      case 'relation':
        return value.label ?? 'Unassigned'
      case 'multi':
        return 'Unassigned'
    }
  }

  // ── metric finalization ───────────────────────────────────────────────

  metricValuesFor(
    group: GroupAcc,
    moneyNullIndexes: ReadonlySet<number> | null,
  ): Array<number | null> {
    return group.metrics.map((acc, i) => {
      const spec = this.metricSpecs[i]
      let value: number | null
      switch (spec.aggregation) {
        case 'COUNT':
          value = acc.nonNull
          break
        case 'DISTINCT_COUNT':
          value = acc.distinct.size
          break
        case 'SUM':
          value = acc.nonNull > 0 ? roundCustomNumber(acc.sum) : null
          break
        case 'AVERAGE':
          value = acc.nonNull > 0 ? roundCustomNumber(acc.sum / acc.nonNull) : null
          break
        case 'MIN':
          value = acc.min
          break
        case 'MAX':
          value = acc.max
          break
      }
      if (moneyNullIndexes && moneyNullIndexes.has(i) && spec.isMoney) {
        return null
      }
      return value
    })
  }

  calcValuesFor(
    _group: GroupAcc,
    metricValues: Array<number | null>,
    warnings: CustomReportWarning[],
    warningCodes: Set<string>,
  ): Array<number | null> {
    if (this.calcSpecs.length === 0) return []
    const aliasToValue = new Map<string, number | null>()
    this.metricSpecs.forEach((spec, i) => aliasToValue.set(spec.alias, metricValues[i]))
    return this.calcSpecs.map((calc) => {
      let node = this.calcAstCache.get(calc.expression)
      if (!node) {
        // The strict validator already guaranteed the expression is safe; a
        // parse failure here is a programming error and must fail loudly.
        node = parseExpression(calc.expression, this.baseAliases)
        this.calcAstCache.set(calc.expression, node)
      }
      const result = evaluateExpression(node, aliasToValue)
      if (result.divByZero && !warningCodes.has('DIVISION_BY_ZERO')) {
        warningCodes.add('DIVISION_BY_ZERO')
        warnings.push({
          code: 'DIVISION_BY_ZERO',
          message: `Calculated field ${calc.alias}: division by zero produced null`,
        })
      }
      if (result.nonFinite && !warningCodes.has('NON_FINITE_RESULT')) {
        warningCodes.add('NON_FINITE_RESULT')
        warnings.push({
          code: 'NON_FINITE_RESULT',
          message: `Calculated field ${calc.alias}: non-finite result produced null`,
        })
      }
      return result.value === null ? null : roundCustomNumber(result.value)
    })
  }

  toInternalRow(
    group: GroupAcc,
    metricValues: Array<number | null>,
    calcValues: Array<number | null>,
  ): InternalRow {
    return {
      key: group.key,
      dimKeys: group.dimValues.map((v) => this.dimKey(v)),
      dimLabels: group.dimValues.map((v) => this.dimLabel(v)),
      dimValues: group.dimValues,
      metricValues,
      calcValues,
    }
  }

  columns(): CustomReportColumn[] {
    const dimColumns: CustomReportColumn[] = this.dimSpecs.map((spec) => ({
      fieldId: spec.id,
      label: spec.label,
      valueType: spec.valueType,
      role: 'DIMENSION',
      aggregation: null,
      granularity: spec.granularity,
      isCalculated: spec.fieldId === null,
    }))
    const metricColumns: CustomReportColumn[] = this.metricSpecs.map((spec) => ({
      fieldId: spec.id,
      label: spec.label,
      valueType: spec.valueType,
      role: 'METRIC',
      aggregation: spec.aggregation,
      granularity: null,
      isCalculated: false,
    }))
    const calcColumns: CustomReportColumn[] = this.calcSpecs.map((calc) => ({
      fieldId: calc.id,
      label: calc.label ?? calc.alias,
      valueType: 'NUMBER',
      role: 'METRIC',
      aggregation: null,
      granularity: null,
      isCalculated: true,
    }))
    return [...dimColumns, ...metricColumns, ...calcColumns]
  }

  renderRow(row: InternalRow): CustomReportRow {
    const cells: CustomReportCell[] = []
    this.dimSpecs.forEach((spec, i) => {
      const value = row.dimValues[i]
      const base: {
        fieldId: string
        label: string
        valueType: CustomReportValueType
        stringValue: string | null
        numberValue: number | null
        booleanValue: boolean | null
        dateValue: string | null
      } = {
        fieldId: spec.id,
        label: spec.label,
        valueType: spec.valueType,
        stringValue: null,
        numberValue: null,
        booleanValue: null,
        dateValue: null,
      }
      let isNull = true
      switch (value.kind) {
        case 'string':
          base.stringValue = value.value
          isNull = value.value === null
          break
        case 'number':
          base.numberValue = value.value
          isNull = value.value === null
          break
        case 'boolean':
          base.booleanValue = value.value
          isNull = value.value === null
          break
        case 'date':
          base.dateValue = value.value ? value.value.toISOString().slice(0, 10) : null
          isNull = value.value === null
          break
        case 'relation':
          base.stringValue = value.label ?? 'Unassigned'
          isNull = value.id === null
          break
        case 'multi':
          base.stringValue = value.items[0]?.label ?? null
          isNull = value.items.length === 0
          break
      }
      cells.push({ ...base, isNull })
    })
    this.metricSpecs.forEach((spec, i) => {
      const value = row.metricValues[i]
      cells.push({
        fieldId: spec.id,
        label: spec.label,
        valueType: spec.valueType,
        stringValue: null,
        numberValue: value,
        booleanValue: null,
        dateValue: null,
        isNull: value === null,
      })
    })
    this.calcSpecs.forEach((calc, i) => {
      const value = row.calcValues[i]
      cells.push({
        fieldId: calc.id,
        label: calc.label ?? calc.alias,
        valueType: 'NUMBER',
        stringValue: null,
        numberValue: value,
        booleanValue: null,
        dateValue: null,
        isNull: value === null,
      })
    })
    return { key: row.key, cells }
  }

  // ── sorting (Contract A.9) ────────────────────────────────────────────

  sortRows(rows: InternalRow[], sorts: CustomReportSort[]): void {
    rows.sort((a, b) => {
      for (const sort of sorts) {
        const cmp = this.compareForSort(a, b, sort.targetId)
        if (cmp !== 0) return sort.direction === 'DESC' ? -cmp : cmp
      }
      return a.key.localeCompare(b.key)
    })
  }

  private compareForSort(a: InternalRow, b: InternalRow, targetId: string): number {
    const dimIndex = this.dimIndexByTargetId.get(targetId)
    if (dimIndex !== undefined) {
      return compareNullableString(a.dimKeys[dimIndex], b.dimKeys[dimIndex])
    }
    const metricIndex = this.metricIndexByTargetId.get(targetId)
    if (metricIndex !== undefined) {
      return compareNullableNumber(a.metricValues[metricIndex], b.metricValues[metricIndex])
    }
    const calcIndex = this.calcIndexByTargetId.get(targetId)
    if (calcIndex !== undefined) {
      return compareNullableNumber(a.calcValues[calcIndex], b.calcValues[calcIndex])
    }
    return 0
  }

  // ── series ────────────────────────────────────────────────────────────

  buildSeries(rows: InternalRow[]): CustomReportSeries[] {
    const series: CustomReportSeries[] = []
    const seriesDefs: Array<{
      id: string
      label: string
      values: (r: InternalRow) => number | null
    }> = []
    this.metricSpecs.forEach((spec, i) => {
      seriesDefs.push({ id: spec.id, label: spec.alias, values: (r) => r.metricValues[i] })
    })
    this.calcSpecs.forEach((calc, i) => {
      seriesDefs.push({ id: calc.id, label: calc.alias, values: (r) => r.calcValues[i] })
    })
    for (const def of seriesDefs) {
      series.push({
        metricId: def.id,
        label: def.label,
        points: rows.map((r) => ({ label: r.dimLabels.join(' · '), value: def.values(r) })),
      })
    }

    if (this.config.visualization.type === 'PIE' && series.length === 1) {
      // Top 10 slices + combined `Other` remainder (Contract A.10).
      const points = series[0].points
      const sorted = [...points].sort((x, y) => (y.value ?? -Infinity) - (x.value ?? -Infinity))
      const top = sorted.slice(0, 10)
      const rest = sorted.slice(10)
      if (rest.length > 0) {
        top.push({ label: 'Other', value: rest.reduce((sum, p) => sum + (p.value ?? 0), 0) })
      }
      series[0].points = top
    }

    if (this.config.visualization.type === 'FUNNEL' && series.length === 1) {
      // Stages ordered by DealStage.order, never by metric value (Contract A.10).
      series[0].points.sort(
        (x, y) =>
          (this.stageOrderByName.get(x.label) ?? Number.MAX_SAFE_INTEGER) -
          (this.stageOrderByName.get(y.label) ?? Number.MAX_SAFE_INTEGER),
      )
    }

    return series
  }
}

function compareNullableString(a: string | null | undefined, b: string | null | undefined): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1
  if (b === null || b === undefined) return -1
  return a.localeCompare(b)
}

function compareNullableNumber(a: number | null | undefined, b: number | null | undefined): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1
  if (b === null || b === undefined) return -1
  return a - b
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class CustomReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contactsService: ContactsService,
    private readonly dealsService: DealsService,
    private readonly tasksService: TasksService,
    private readonly activityService: ActivityService,
    private readonly salesReports: SalesReportsService,
    private readonly audit: AuditService,
    @Optional() private readonly clock: () => Date = () => new Date(),
  ) {}

  // ─── Public surface ───────────────────────────────────────────────────

  async preview(
    tenantId: string,
    userId: string,
    rawConfig: unknown,
    pagination: CustomReportPaginationInput,
  ): Promise<CustomReportResult> {
    const config = this.validate(rawConfig)
    return this.execute(tenantId, userId, config, pagination, null)
  }

  async resolveReportDataSource(
    tenantId: string,
    userId: string,
    reportId: string,
  ): Promise<CustomReportDataSource> {
    const report = await this.findOwnedOrPublicCustomReport(tenantId, userId, reportId)
    const parsed = parseCustomReportConfig(report.config)
    if (!parsed.ok) {
      throw new BadRequestException(`Saved custom report config is invalid: ${parsed.warnings[0]}`)
    }
    return parsed.config.dataSource
  }

  async customReportData(
    tenantId: string,
    userId: string,
    reportId: string,
    pagination: CustomReportPaginationInput,
  ): Promise<CustomReportResult> {
    const report = await this.findOwnedOrPublicCustomReport(tenantId, userId, reportId)
    const parsed = parseCustomReportConfig(report.config)
    if (!parsed.ok) {
      // Contract A.3: explicit invalid-config result — never a silent rewrite.
      throw new BadRequestException(`Saved custom report config is invalid: ${parsed.warnings[0]}`)
    }
    return this.execute(tenantId, userId, parsed.config, pagination, report.id)
  }

  async saveCustomReport(
    tenantId: string,
    userId: string,
    input: CustomReportSaveInput,
  ): Promise<CustomReportOutput> {
    const name = input.name.trim()
    if (!name) {
      throw new BadRequestException('Report name is required')
    }
    if (name.length > MAX_REPORT_NAME_LENGTH) {
      throw new BadRequestException(
        `Report name must be at most ${MAX_REPORT_NAME_LENGTH} characters`,
      )
    }
    const config = this.validate(input.config)

    if (input.reportId) {
      return this.updateCustomReport(
        tenantId,
        userId,
        input.reportId,
        name,
        config,
        input.isPublic ?? false,
      )
    }
    return this.createCustomReport(tenantId, userId, name, config, input.isPublic ?? false)
  }

  // ─── Persistence (Contract C.17-C.18) ─────────────────────────────────

  private async createCustomReport(
    tenantId: string,
    userId: string,
    name: string,
    config: CustomReportConfig,
    isPublic: boolean,
  ): Promise<CustomReportOutput> {
    // Shared 50-active limit + case-insensitive name uniqueness (Story 6.2).
    await this.salesReports.assertUnderActiveLimit(tenantId, userId)
    await this.salesReports.assertNameAvailable(tenantId, userId, name)

    const row = await this.prisma.report.create({
      data: {
        tenantId,
        name,
        type: 'CUSTOM',
        config: config as unknown as Prisma.InputJsonValue,
        createdBy: userId,
        updatedBy: userId,
        isPublic,
      },
      select: REPORT_SELECT,
    })

    // Exactly one service-level audit row per create (Contract C.17).
    await this.audit.log({
      tenantId,
      userId,
      action: 'CREATE',
      entity: 'REPORT',
      entityId: row.id,
      details: { name, dataSource: config.dataSource },
    })

    return this.toOutput(row, config)
  }

  private async updateCustomReport(
    tenantId: string,
    userId: string,
    reportId: string,
    name: string,
    config: CustomReportConfig,
    isPublic: boolean,
  ): Promise<CustomReportOutput> {
    // Creator-owned active CUSTOM row only; any other id shape (missing,
    // private non-owner, cross-tenant, wrong-type, soft-deleted) is identical
    // `Report not found` (Contract C.18).
    const current = await this.prisma.report.findFirst({
      where: { id: reportId, tenantId, createdBy: userId, type: 'CUSTOM', deletedAt: null },
      select: REPORT_SELECT,
    })
    if (!current) {
      throw new NotFoundException('Report not found')
    }

    await this.salesReports.assertNameAvailable(tenantId, userId, name, reportId)

    const row = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        name,
        config: config as unknown as Prisma.InputJsonValue,
        isPublic,
        updatedBy: userId,
      },
      select: REPORT_SELECT,
    })

    // Exactly one service-level audit row per update (Contract C.17).
    await this.audit.log({
      tenantId,
      userId,
      action: 'UPDATE',
      entity: 'REPORT',
      entityId: reportId,
      details: { name, dataSource: config.dataSource },
    })

    return this.toOutput(row, config)
  }

  private toOutput(
    row: {
      id: string
      name: string
      isPublic: boolean
      createdAt: Date
      updatedAt: Date
      createdBy: string
    },
    config: CustomReportConfig,
  ): CustomReportOutput {
    return {
      id: row.id,
      name: row.name,
      isPublic: row.isPublic,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdBy: row.createdBy,
      config,
    }
  }

  private async findOwnedOrPublicCustomReport(
    tenantId: string,
    userId: string,
    reportId: string,
  ): Promise<{ id: string; config: unknown }> {
    const row = await this.prisma.report.findFirst({
      where: {
        id: reportId,
        tenantId,
        deletedAt: null,
        type: 'CUSTOM',
        OR: [{ createdBy: userId }, { isPublic: true }],
      },
      select: { id: true, config: true },
    })
    if (!row) {
      throw new NotFoundException('Report not found')
    }
    return row
  }

  private validate(rawConfig: unknown): CustomReportConfig {
    try {
      return validateCustomReportConfig(rawConfig)
    } catch (err) {
      throw new BadRequestException((err as Error).message)
    }
  }

  // ─── Execution engine ─────────────────────────────────────────────────

  private async execute(
    tenantId: string,
    userId: string,
    config: CustomReportConfig,
    pagination: CustomReportPaginationInput,
    reportId: string | null,
  ): Promise<CustomReportResult> {
    const generatedAt = this.clock().toISOString()
    const page = Math.max(pagination.page ?? 1, 1)
    const pageSize = Math.min(Math.max(pagination.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
    const warnings: CustomReportWarning[] = []
    const warningCodes = new Set<string>()
    const source = config.dataSource

    // 1. Shared visibility predicate (Contract C.14).
    const base = await this.buildBaseWhere(tenantId, userId, source)

    // 2. Same-tenant relation filter validation (Contract C.18, S2/S9).
    await this.validateRelationFilterIds(tenantId, config)

    // 3. Filters always NARROW the visible scope (Contract C.14).
    let where: Record<string, unknown> = base
    for (const filter of config.filters) {
      where = this.withAnd(where, this.buildFilterCondition(source, filter))
    }

    // 4. Money no-FX guard (Contract A.7): mixed currencies null money metrics
    //    unless a currency filter or currency dimension narrows the scope.
    const moneyMetricIndexes = new Set<number>()
    config.metrics.forEach((metric, i) => {
      if (
        source === 'DEALS' &&
        (metric.fieldId === 'deal.value' || metric.fieldId === 'deal.lineItem.total')
      ) {
        moneyMetricIndexes.add(i)
      }
    })
    // A currency filter only pins a single currency when it narrows to exactly
    // one value (EQ one value, or IN with one element). NOT_EQ / multi-value IN
    // still span multiple currencies — fall through to normal detection so
    // unlike currencies are never summed (Contract A.7).
    const hasCurrencyFilter = config.filters.some((f) => {
      if (f.fieldId !== 'deal.currency') return false
      if (f.operator === 'EQ' && f.stringValue) return true
      if (f.operator === 'IN' && f.stringValues?.length === 1) return true
      return false
    })
    const hasCurrencyDimension = config.dimensions.some((d) => d.fieldId === 'deal.currency')
    let mixedCurrencies = false
    if (
      moneyMetricIndexes.size > 0 &&
      !hasCurrencyFilter &&
      !hasCurrencyDimension &&
      source === 'DEALS'
    ) {
      const currencies = await this.detectCurrencies(where)
      mixedCurrencies = currencies.length > 1
      if (mixedCurrencies) {
        warnings.push({ code: 'MIXED_CURRENCY', message: MIXED_CURRENCY_MESSAGE })
      }
    }

    // 5. Bounded reads (Contract C.20): explicit failure, never truncation.
    const total = await this.countRows(source, where)
    if (total > MAX_CUSTOM_SCOPE_ROWS) {
      throw new BadRequestException(
        `This report scope exceeds ${MAX_CUSTOM_SCOPE_ROWS} rows — narrow your filters or date range and try again`,
      )
    }
    const rows = await this.fetchRows(source, where)

    // Activity creator labels (one bounded same-tenant lookup).
    let creatorLabels: ReadonlyMap<string, string> = new Map()
    if (source === 'ACTIVITIES' && rows.length > 0) {
      creatorLabels = await this.loadCreatorLabels(tenantId, rows)
    }

    // 6. In-memory group/aggregate/sort with deterministic ordering.
    const engine = new GroupEngine(source, config, creatorLabels)
    const groups = engine.group(rows)
    const moneyNullIndexes = mixedCurrencies ? moneyMetricIndexes : null
    const internalRows: InternalRow[] = Array.from(groups.values()).map((group) => {
      const metricValues = engine.metricValuesFor(group, moneyNullIndexes)
      const calcValues = engine.calcValuesFor(group, metricValues, warnings, warningCodes)
      return engine.toInternalRow(group, metricValues, calcValues)
    })

    engine.sortRows(internalRows, config.sort)

    if (internalRows.length > MAX_GROUPED_ROWS) {
      throw new BadRequestException(
        `This report produces more than ${MAX_GROUPED_ROWS} groups — narrow your filters or date range and try again`,
      )
    }

    // 7. Pagination + typed rows/series.
    const totalRows = internalRows.length
    const totalPages = totalRows === 0 ? 0 : Math.ceil(totalRows / pageSize)
    const slice = internalRows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)

    return {
      reportId,
      generatedAt,
      config,
      columns: engine.columns(),
      rows: slice.map((r) => engine.renderRow(r)),
      totalRows,
      // Contract C.21: empty scopes return zero series — never a stub series.
      series: internalRows.length === 0 ? [] : engine.buildSeries(slice),
      warnings,
      pagination: { page, pageSize, totalPages },
      truncated: false,
    }
  }

  private async buildBaseWhere(
    tenantId: string,
    userId: string,
    source: CustomReportDataSource,
  ): Promise<Record<string, unknown>> {
    switch (source) {
      case 'CONTACTS':
        return (await this.contactsService.buildContactWhere(
          tenantId,
          userId,
          {},
        )) as unknown as Record<string, unknown>
      case 'DEALS':
        return (await this.dealsService.buildDealWhere(tenantId, userId, {})) as unknown as Record<
          string,
          unknown
        >
      case 'TASKS':
        return (await this.tasksService.buildTaskWhere(tenantId, userId, {})) as unknown as Record<
          string,
          unknown
        >
      case 'ACTIVITIES':
        return (await this.activityService.buildFeedWhere(
          tenantId,
          userId,
          {},
        )) as unknown as Record<string, unknown>
    }
  }

  private withAnd(
    base: Record<string, unknown>,
    cond: Record<string, unknown>,
  ): Record<string, unknown> {
    const existing = base.AND
    const ands: Record<string, unknown>[] = []
    if (Array.isArray(existing)) ands.push(...(existing as Record<string, unknown>[]))
    else if (existing) ands.push(existing as Record<string, unknown>)
    ands.push(cond)
    return { ...base, AND: ands }
  }

  private async validateRelationFilterIds(
    tenantId: string,
    config: CustomReportConfig,
  ): Promise<void> {
    const checks: Array<{
      kind: 'user' | 'team' | 'stage' | 'contact' | 'product' | 'tag' | 'deal'
      ids: string[]
    }> = []
    for (const filter of config.filters) {
      const field = fieldByKey(config.dataSource, filter.fieldId)
      if (!field) continue
      const ids: string[] = []
      if (filter.stringValue) ids.push(filter.stringValue)
      if (filter.stringValues) ids.push(...filter.stringValues)
      if (ids.length === 0) continue
      const unique = [...new Set(ids)]
      let kind: 'user' | 'team' | 'stage' | 'contact' | 'product' | 'tag' | 'deal' | null = null
      if (field.valueType === 'TAGS') {
        kind = 'tag'
      } else {
        switch (field.relationKind) {
          case 'OWNER':
          case 'ASSIGNEE':
          case 'CREATOR':
            kind = 'user'
            break
          case 'TEAM':
            kind = 'team'
            break
          case 'STAGE':
            kind = 'stage'
            break
          case 'CONTACT':
            kind = 'contact'
            break
          case 'PRODUCT':
            kind = 'product'
            break
          case 'DEAL':
            kind = 'deal'
            break
        }
      }
      if (kind) checks.push({ kind, ids: unique })
    }
    for (const check of checks) {
      const found = await this.findActiveIds(tenantId, check.kind, check.ids)
      if (found.length !== check.ids.length) {
        throw new BadRequestException(
          'Invalid report filter: a referenced record does not exist in this tenant',
        )
      }
    }
  }

  private async findActiveIds(
    tenantId: string,
    kind: 'user' | 'team' | 'stage' | 'contact' | 'product' | 'tag' | 'deal',
    ids: string[],
  ): Promise<string[]> {
    switch (kind) {
      case 'user': {
        const rows = await this.prisma.user.findMany({
          where: { id: { in: ids }, tenantId, deletedAt: null },
          select: { id: true },
        })
        return rows.map((r) => r.id)
      }
      case 'team': {
        const rows = await this.prisma.team.findMany({
          where: { id: { in: ids }, tenantId, deletedAt: null },
          select: { id: true },
        })
        return rows.map((r) => r.id)
      }
      case 'stage': {
        const rows = await this.prisma.dealStage.findMany({
          where: { id: { in: ids }, tenantId, deletedAt: null },
          select: { id: true },
        })
        return rows.map((r) => r.id)
      }
      case 'contact': {
        const rows = await this.prisma.contact.findMany({
          where: { id: { in: ids }, tenantId, deletedAt: null },
          select: { id: true },
        })
        return rows.map((r) => r.id)
      }
      case 'product': {
        const rows = await this.prisma.product.findMany({
          where: { id: { in: ids }, tenantId, deletedAt: null },
          select: { id: true },
        })
        return rows.map((r) => r.id)
      }
      case 'deal': {
        const rows = await this.prisma.deal.findMany({
          where: { id: { in: ids }, tenantId, deletedAt: null },
          select: { id: true },
        })
        return rows.map((r) => r.id)
      }
      case 'tag': {
        const rows = await this.prisma.tag.findMany({
          where: { id: { in: ids }, tenantId },
          select: { id: true },
        })
        return rows.map((r) => r.id)
      }
    }
  }

  // ─── Filter → Prisma condition (closed catalogue keys only) ────────────────

  private buildFilterCondition(
    source: CustomReportDataSource,
    filter: CustomReportFilter,
  ): Record<string, unknown> {
    const key = filter.fieldId
    const dayStart = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`)
    const dayEnd = (iso: string): Date => new Date(`${iso}T23:59:59.999Z`)
    const singleString = (): string => filter.stringValue as string
    const singleNumber = (): number => filter.numberValue as number
    const singleDate = (): string => filter.dateValue as string
    const listStrings = (): string[] => (filter.stringValues as string[]) ?? []
    const listNumbers = (): [number, number] => [
      filter.numberValues?.[0] ?? 0,
      filter.numberValues?.[1] ?? 0,
    ]
    const listDates = (): [string, string] => [
      filter.dateValues?.[0] ?? '',
      filter.dateValues?.[1] ?? '',
    ]
    const op = filter.operator

    const eqNumber = (): Record<string, unknown> => {
      switch (op) {
        case 'EQ':
          return { equals: singleNumber() }
        case 'GT':
          return { gt: singleNumber() }
        case 'GTE':
          return { gte: singleNumber() }
        case 'LT':
          return { lt: singleNumber() }
        case 'LTE':
          return { lte: singleNumber() }
        case 'BETWEEN': {
          const [a, b] = listNumbers()
          return { gte: a, lte: b }
        }
        default:
          return { equals: singleNumber() }
      }
    }

    const eqDate = (): Record<string, unknown> => {
      switch (op) {
        case 'ON':
          return { gte: dayStart(singleDate()), lte: dayEnd(singleDate()) }
        case 'BEFORE':
          return { lt: dayStart(singleDate()) }
        case 'AFTER':
          return { gt: dayEnd(singleDate()) }
        case 'BETWEEN': {
          const [a, b] = listDates()
          return { gte: dayStart(a), lte: dayEnd(b) }
        }
        default:
          return { equals: dayStart(singleDate()) }
      }
    }

    const eqString = (): unknown => {
      switch (op) {
        case 'EQ':
          return singleString()
        case 'NOT_EQ':
          return { not: singleString() }
        case 'CONTAINS':
          return { contains: singleString(), mode: 'insensitive' }
        case 'IN':
          return { in: listStrings() }
        default:
          return singleString()
      }
    }

    const eqIdList = (): unknown => {
      switch (op) {
        case 'EQ':
          return singleString()
        case 'NOT_EQ':
          return { not: singleString() }
        case 'IN':
          return { in: listStrings() }
        default:
          return singleString()
      }
    }

    const eqBoolean = (): unknown => {
      return filter.booleanValue ?? false
    }

    const tagsCondition = (): Record<string, unknown> => {
      const ids = listStrings()
      if (op === 'HAS_ALL') {
        return { AND: ids.map((id) => ({ tags: { some: { tagId: id } } })) }
      }
      return { tags: { some: { tagId: { in: ids } } } }
    }

    // ── CONTACTS ──────────────────────────────────────────────────────
    if (source === 'CONTACTS') {
      switch (key) {
        case 'contact.id':
          return { id: eqIdList() }
        case 'contact.createdAt':
          return { createdAt: eqDate() }
        case 'contact.updatedAt':
          return { updatedAt: eqDate() }
        case 'contact.owner':
          return { ownerId: eqIdList() }
        case 'contact.team':
          return { teamId: eqIdList() }
        case 'contact.company':
          return { company: eqString() }
        case 'contact.jobTitle':
          return { jobTitle: eqString() }
        case 'contact.addressCity':
          return { addressCity: eqString() }
        case 'contact.addressCountry':
          return { addressCountry: eqString() }
        case 'contact.department':
          return { department: eqString() }
        case 'contact.timezone':
          return { timezone: eqString() }
        case 'contact.language':
          return { language: eqString() }
        case 'contact.source':
          return { source: eqString() }
        case 'contact.tags':
          return tagsCondition()
      }
    }

    // ── DEALS ─────────────────────────────────────────────────────────
    if (source === 'DEALS') {
      switch (key) {
        case 'deal.id':
          return { id: eqIdList() }
        case 'deal.createdAt':
          return { createdAt: eqDate() }
        case 'deal.updatedAt':
          return { updatedAt: eqDate() }
        case 'deal.expectedCloseDate':
          return { expectedCloseDate: eqDate() }
        case 'deal.actualCloseDate':
          return { actualCloseDate: eqDate() }
        case 'deal.owner':
          return { ownerId: eqIdList() }
        case 'deal.ownerTeam':
          return { owner: { teamId: eqIdList() } }
        case 'deal.stage':
          return { stageId: eqIdList() }
        case 'deal.status':
          return this.statusCondition(filter)
        case 'deal.contact':
          return { contactId: eqIdList() }
        case 'deal.currency':
          return { currency: eqIdList() }
        case 'deal.product':
          return {
            lineItems: {
              some: {
                productId: singleString(),
                deletedAt: null,
                product: { isActive: true, deletedAt: null },
              },
            },
          }
        case 'deal.value':
          return { value: eqNumber() }
        case 'deal.probability':
          return { probability: eqNumber() }
      }
    }

    // ── TASKS ─────────────────────────────────────────────────────────
    if (source === 'TASKS') {
      switch (key) {
        case 'task.id':
          return { id: eqIdList() }
        case 'task.createdAt':
          return { createdAt: eqDate() }
        case 'task.updatedAt':
          return { updatedAt: eqDate() }
        case 'task.dueDate':
          return { dueDate: eqDate() }
        case 'task.completedAt':
          return { completedAt: eqDate() }
        case 'task.assignee':
          return { assignedTo: eqIdList() }
        case 'task.assigneeTeam':
          return { assignee: { teamId: eqIdList() } }
        case 'task.status':
          return { status: eqIdList() as unknown }
        case 'task.priority':
          return { priority: eqIdList() as unknown }
        case 'task.contact':
          return { contactId: eqIdList() }
        case 'task.deal':
          return { dealId: eqIdList() }
        case 'task.isRecurring':
          return { isRecurring: eqBoolean() }
        case 'task.recurrencePattern':
          return { recurrencePattern: eqIdList() as unknown }
      }
    }

    // ── ACTIVITIES ────────────────────────────────────────────────────
    if (source === 'ACTIVITIES') {
      switch (key) {
        case 'activity.id':
          return { id: eqIdList() }
        case 'activity.createdAt':
          return { createdAt: eqDate() }
        case 'activity.type':
          return { type: eqIdList() as unknown }
        case 'activity.source':
          return { source: eqString() }
        case 'activity.creator':
          return { createdBy: eqIdList() }
        case 'activity.contact':
          return { contactId: eqIdList() }
        case 'activity.contactOwner':
          return { contact: { ownerId: eqIdList() } }
        case 'activity.contactTeam':
          return { contact: { owner: { teamId: eqIdList() } } }
        case 'activity.contactTags':
          return this.activityTagsCondition(filter)
      }
    }

    throw new Error(`Unsupported custom report filter field: ${key}`)
  }

  private statusCondition(filter: CustomReportFilter): Record<string, unknown> {
    const DEAL_STATUS_VALUES = ['OPEN', 'WON', 'LOST'] as const
    const candidates =
      filter.operator === 'IN'
        ? ((filter.stringValues ?? []) as string[])
        : [filter.stringValue as string]
    for (const value of candidates) {
      if (!DEAL_STATUS_VALUES.includes(value as (typeof DEAL_STATUS_VALUES)[number])) {
        throw new BadRequestException(`deal.status filter value must be one of OPEN, WON or LOST`)
      }
    }
    const statusPredicate = (value: string): Record<string, unknown> => {
      switch (value) {
        case 'WON':
          return { stage: { isWon: true } }
        case 'LOST':
          return { stage: { isLost: true } }
        default:
          return { stage: { isWon: false, isLost: false } }
      }
    }
    switch (filter.operator) {
      case 'EQ':
        return statusPredicate(filter.stringValue as string)
      case 'NOT_EQ': {
        const value = filter.stringValue as string
        if (value === 'WON') return { stage: { isWon: false } }
        if (value === 'LOST') return { stage: { isLost: false } }
        return { stage: { OR: [{ isWon: true }, { isLost: true }] } }
      }
      case 'IN': {
        const values = (filter.stringValues ?? []) as string[]
        return { stage: { OR: values.map(statusPredicate) } }
      }
      default:
        return statusPredicate(filter.stringValue as string)
    }
  }

  private activityTagsCondition(filter: CustomReportFilter): Record<string, unknown> {
    const ids = (filter.stringValues ?? []) as string[]
    if (filter.operator === 'HAS_ALL') {
      return { contact: { AND: ids.map((id) => ({ tags: { some: { tagId: id } } })) } }
    }
    return { contact: { tags: { some: { tagId: { in: ids } } } } }
  }

  // ─── Bounded reads ───────────────────────────────────────────────────

  private async detectCurrencies(where: Record<string, unknown>): Promise<string[]> {
    const grouped = await this.prisma.deal.groupBy({
      by: ['currency'],
      where: where as Prisma.DealWhereInput,
      _count: { _all: true },
    })
    return grouped.map((g) => g.currency || 'USD').sort()
  }

  private async countRows(
    source: CustomReportDataSource,
    where: Record<string, unknown>,
  ): Promise<number> {
    switch (source) {
      case 'CONTACTS':
        return this.prisma.contact.count({ where: where as Prisma.ContactWhereInput })
      case 'DEALS':
        return this.prisma.deal.count({ where: where as Prisma.DealWhereInput })
      case 'TASKS':
        return this.prisma.task.count({ where: where as Prisma.TaskWhereInput })
      case 'ACTIVITIES':
        return this.prisma.activity.count({ where: where as Prisma.ActivityWhereInput })
    }
  }

  private async fetchRows(
    source: CustomReportDataSource,
    where: Record<string, unknown>,
  ): Promise<RawRow[]> {
    switch (source) {
      case 'CONTACTS':
        return (await this.prisma.contact.findMany({
          where: where as Prisma.ContactWhereInput,
          select: CONTACT_ROW_SELECT,
          take: MAX_CUSTOM_SCOPE_ROWS,
        })) as unknown as RawRow[]
      case 'DEALS':
        return (await this.prisma.deal.findMany({
          where: where as Prisma.DealWhereInput,
          select: DEAL_ROW_SELECT,
          take: MAX_CUSTOM_SCOPE_ROWS,
        })) as unknown as RawRow[]
      case 'TASKS':
        return (await this.prisma.task.findMany({
          where: where as Prisma.TaskWhereInput,
          select: TASK_ROW_SELECT,
          take: MAX_CUSTOM_SCOPE_ROWS,
        })) as unknown as RawRow[]
      case 'ACTIVITIES':
        return (await this.prisma.activity.findMany({
          where: where as Prisma.ActivityWhereInput,
          select: ACTIVITY_ROW_SELECT,
          take: MAX_CUSTOM_SCOPE_ROWS,
        })) as unknown as RawRow[]
    }
  }

  private async loadCreatorLabels(
    tenantId: string,
    rows: RawRow[],
  ): Promise<ReadonlyMap<string, string>> {
    const creatorIds = [
      ...new Set(
        rows
          .map((r) => (typeof r.createdBy === 'string' ? r.createdBy : null))
          .filter((x): x is string => x !== null),
      ),
    ]
    if (creatorIds.length === 0) return new Map()
    const users = await this.prisma.user.findMany({
      where: { id: { in: creatorIds }, tenantId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    })
    return new Map(
      users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.id]),
    )
  }
}
