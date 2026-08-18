/**
 * Story 6.2 — SalesReportsService.
 *
 * Saved-report CRUD (AC 11-22), the comparison engine (AC 23-45), and the
 * drill-down contract (AC 46-53). Reuses DealsService.buildDealWhere as the
 * single visibility/tenant/deleted-row predicate (AC 27, never copied), and
 * COMPOSES ForecastService.salesForecast / WinLossService.winLossAnalysis
 * instead of duplicating their math (AC 34-35). Aggregations go through
 * Prisma aggregate/groupBy/count and bounded selects — never DealsService
 * findMany, which clamps at 100 (AC 29).
 *
 * All calculations are computed on read. No new persistence, snapshot table,
 * server cache, cron or materialized view (AC 45) — the existing
 * ForecastSnapshot write-through inside ForecastService is preserved.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import type { Prisma } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { DealsService } from '../deals/deals.service'
import { ForecastService } from './forecast.service'
import { WinLossService } from './win-loss.service'
import { REPORT_DRILL_METRICS, isReportMetricKey, isReportType } from './report-types'
import type {
  ReportType,
  ReportGroupBy,
  ReportMetricKey,
  ReportTrendDirection,
  ReportDisplayToken,
  DatePreset,
  ComparisonMode,
} from './report-types'
import {
  parseReportConfig,
  validateReportConfig,
  MAX_ACTIVE_REPORTS_PER_CREATOR,
  MAX_REPORT_NAME_LENGTH,
} from './report-config'
import type { ReportConfig } from './report-config'
import {
  resolveCurrentRange,
  resolveComparisonRange,
  mapTimeBucketToComparison,
  MS_PER_DAY,
} from './report-periods'
import type { DayRange } from './report-periods'

// ─── Select / row shapes ─────────────────────────────────────────────────────

/** Every field the Report Pothos ref exposes must be selected here (AC 9). */
export const REPORT_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  type: true,
  config: true,
  createdBy: true,
  isPublic: true,
  createdAt: true,
  updatedAt: true,
  updatedBy: true,
  deletedAt: true,
} as const

export type ReportRow = Prisma.ReportGetPayload<{ select: typeof REPORT_SELECT }>

export type ReportConnection = {
  items: ReportRow[]
  total: number
  page: number
  pageSize: number
}

// ─── Input types ─────────────────────────────────────────────────────────────

export type ReportFiltersInput = {
  datePreset?: DatePreset
  startDate?: string | null
  endDate?: string | null
  comparisonMode?: ComparisonMode
  comparisonStartDate?: string | null
  comparisonEndDate?: string | null
  groupBy?: ReportGroupBy
  ownerId?: string | null
  teamId?: string | null
  stageId?: string | null
  productId?: string | null
  currency?: string | null
}

export type ReportConfigInput = ReportFiltersInput

export type CreateReportInput = {
  name: string
  type: ReportType
  config: ReportConfigInput
  isPublic?: boolean
}

export type UpdateReportInput = {
  name?: string
  type?: ReportType
  config?: ReportConfigInput
  isPublic?: boolean
}

export type ReportDrillDownInput = {
  metricKey: string
  bucketKey?: string
  page?: number
  pageSize?: number
  scope?: 'CURRENT' | 'COMPARISON'
}

// ─── Result types (Pothos refs derive from these — AC 55) ───────────────────

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

// ─── Pure helpers ────────────────────────────────────────────────────────────

function round2(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100
  return Number.isFinite(rounded) ? rounded : 0
}

function round1(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 10) / 10
  return Number.isFinite(rounded) ? rounded : 0
}

function changeFor(
  current: number | null,
  comparison: number | null,
): Pick<ReportMetric, 'percentageChange' | 'direction' | 'displayToken'> {
  if (current === null || comparison === null) {
    return { percentageChange: null, direction: null, displayToken: 'NONE' }
  }
  if (current === 0 && comparison === 0) {
    return { percentageChange: 0, direction: 'FLAT', displayToken: 'NONE' }
  }
  if (comparison === 0) {
    // Never produce Infinity/NaN (AC 25): display token NEW instead.
    return {
      percentageChange: null,
      direction: current > 0 ? 'UP' : 'DOWN',
      displayToken: 'NEW',
    }
  }
  const pct = round1(((current - comparison) / Math.abs(comparison)) * 100)
  const direction: ReportTrendDirection = pct > 0 ? 'UP' : pct < 0 ? 'DOWN' : 'FLAT'
  return { percentageChange: pct, direction, displayToken: 'NONE' }
}

/** Merge a condition into an existing base where without clobbering base AND. */
function withAnd(base: Prisma.DealWhereInput, cond: Prisma.DealWhereInput): Prisma.DealWhereInput {
  const existing = base.AND
  const ands: Prisma.DealWhereInput[] = []
  if (Array.isArray(existing)) ands.push(...existing)
  else if (existing) ands.push(existing)
  ands.push(cond)
  return { ...base, AND: ands }
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function timeBucketKey(date: Date, groupBy: 'MONTH' | 'QUARTER' | 'YEAR'): string {
  const year = date.getUTCFullYear()
  if (groupBy === 'MONTH') return `${year}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
  if (groupBy === 'QUARTER') return `${year}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`
  return `${year}`
}

function timeBucketLabel(key: string, groupBy: 'MONTH' | 'QUARTER' | 'YEAR'): string {
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
  if (groupBy === 'MONTH') {
    const [y, m] = key.split('-')
    return `${MONTHS[Number(m) - 1]} ${y}`
  }
  if (groupBy === 'QUARTER') return key.replace('-Q', ' Q')
  return key
}

function timeBucketStart(date: Date, groupBy: 'MONTH' | 'QUARTER' | 'YEAR'): Date {
  const year = date.getUTCFullYear()
  if (groupBy === 'MONTH') return new Date(Date.UTC(year, date.getUTCMonth(), 1))
  if (groupBy === 'QUARTER')
    return new Date(Date.UTC(year, Math.floor(date.getUTCMonth() / 3) * 3, 1))
  return new Date(Date.UTC(year, 0, 1))
}

function nextTimeBucket(date: Date, groupBy: 'MONTH' | 'QUARTER' | 'YEAR'): Date {
  const year = date.getUTCFullYear()
  if (groupBy === 'MONTH') return new Date(Date.UTC(year, date.getUTCMonth() + 1, 1))
  if (groupBy === 'QUARTER') return new Date(Date.UTC(year, date.getUTCMonth() + 3, 1))
  return new Date(Date.UTC(year + 1, 0, 1))
}

const TIME_KEY_PATTERN = /^\d{4}(-\d{2}|-Q[1-4])?$/

/**
 * Sentinel used when a COMPARISON-scope time-bucket drill has no equivalent
 * bucket in the comparison range (AC 53): matches no real deal, so the drill
 * returns an empty result instead of current-period rows.
 */
const NO_DRILL_MATCH_DATE = new Date('9999-12-31T00:00:00.000Z')

/** Parse a time bucket key into a sub-range (used by drill bucket narrowing). */
export function parseTimeBucketKey(key: string, groupBy: ReportGroupBy): DayRange {
  if (!TIME_KEY_PATTERN.test(key)) {
    throw new BadRequestException(`Invalid bucket key for ${groupBy} grouping`)
  }
  if (groupBy === 'MONTH' && /^\d{4}-\d{2}$/.test(key)) {
    const [y, m] = key.split('-').map(Number)
    return {
      start: new Date(Date.UTC(y, m - 1, 1)),
      end: new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)),
    }
  }
  if (groupBy === 'QUARTER' && /^\d{4}-Q[1-4]$/.test(key)) {
    const y = Number(key.slice(0, 4))
    const q = Number(key.slice(-1)) - 1
    return {
      start: new Date(Date.UTC(y, q * 3, 1)),
      end: new Date(Date.UTC(y, q * 3 + 3, 0, 23, 59, 59, 999)),
    }
  }
  if (groupBy === 'YEAR' && /^\d{4}$/.test(key)) {
    const y = Number(key)
    return {
      start: new Date(Date.UTC(y, 0, 1)),
      end: new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999)),
    }
  }
  throw new BadRequestException(`Invalid bucket key for ${groupBy} grouping`)
}

const DATE_FIELD_BY_TYPE: Record<ReportType, 'actualCloseDate' | 'expectedCloseDate'> = {
  SALES_OVERVIEW: 'actualCloseDate',
  PIPELINE_ANALYSIS: 'expectedCloseDate',
  WIN_LOSS: 'actualCloseDate',
  REVENUE_FORECAST: 'expectedCloseDate',
  TEAM_PERFORMANCE: 'actualCloseDate',
  DEAL_VELOCITY: 'actualCloseDate',
}

const CALCULATION_NOTE_BY_TYPE: Record<ReportType, string> = {
  SALES_OVERVIEW:
    'Closed metrics use actualCloseDate. Stage breakdown is a current-stage snapshot of deals created in the period — not historical stage conversion.',
  PIPELINE_ANALYSIS:
    'Open deals are filtered by expectedCloseDate within the period. Pipeline value is unweighted; weighted value applies the stage probability.',
  WIN_LOSS:
    'Closed deals are filtered by actualCloseDate. Win/loss metrics compose WinLossService; stage/product filters narrow breakdowns and drill-down.',
  REVENUE_FORECAST:
    'Open deals are filtered by expectedCloseDate. Forecast bands compose ForecastService with month/quarter/owner/team grouping semantics.',
  TEAM_PERFORMANCE:
    'Won metrics use actualCloseDate. Deals without a team are grouped under "No team".',
  DEAL_VELOCITY:
    'Cycle duration is actualCloseDate minus createdAt in days for closed deals; negative durations are excluded and counted in EXCLUDED_ROWS.',
}

const MIXED_CURRENCY_NOTE =
  ' Mixed currencies detected — money values are null until a single currency is selected (no FX conversion).'

// Deal row shape for in-memory bucketing / currency work. Reads are bounded
// (AC 29): fetchBucketRows caps the fetch at MAX_BUCKET_ROWS and fails
// explicitly when the scope exceeds it — never a silent truncation.
export const MAX_BUCKET_ROWS = 10_000

const BUCKET_ROW_SELECT = {
  id: true,
  value: true,
  probability: true,
  currency: true,
  ownerId: true,
  actualCloseDate: true,
  expectedCloseDate: true,
  createdAt: true,
  owner: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      teamId: true,
      team: { select: { id: true, name: true } },
    },
  },
  lineItems: {
    where: { deletedAt: null },
    select: { productId: true, total: true, product: { select: { name: true } } },
  },
} as const

type BucketRow = {
  id: string
  value: number
  probability: number
  currency: string
  ownerId: string
  actualCloseDate: Date | null
  expectedCloseDate: Date | null
  createdAt: Date
  owner: {
    id: string
    firstName: string
    lastName: string
    teamId: string | null
    team: { id: string; name: string } | null
  } | null
  lineItems: Array<{ productId: string; total: number; product: { name: string } | null }>
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class SalesReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dealsService: DealsService,
    private readonly forecastService: ForecastService,
    private readonly winLossService: WinLossService,
    private readonly audit: AuditService,
    @Optional() private readonly clock: () => Date = () => new Date(),
  ) {}

  // ─── CRUD (AC 11-22) ───────────────────────────────────────────────────────

  async reports(
    tenantId: string,
    userId: string,
    pagination: { page?: number; pageSize?: number } = {},
    filter: { type?: ReportType } = {},
  ): Promise<ReportConnection> {
    const page = Math.max(pagination.page ?? 1, 1)
    const pageSize = Math.min(Math.max(pagination.pageSize ?? 20, 1), 100)

    // Caller's active reports + active public reports in the same tenant,
    // deduplicated (a public report the caller owns appears once) (AC 11).
    const where: Prisma.ReportWhereInput = {
      tenantId,
      deletedAt: null,
      OR: [{ createdBy: userId }, { isPublic: true }],
      ...(filter.type ? { type: filter.type } : {}),
    }

    const [items, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        select: REPORT_SELECT,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.report.count({ where }),
    ])

    return { items, total, page, pageSize }
  }

  async report(tenantId: string, userId: string, id: string): Promise<ReportRow> {
    const row = await this.prisma.report.findFirst({
      where: {
        id,
        tenantId,
        deletedAt: null,
        OR: [{ createdBy: userId }, { isPublic: true }],
      },
      select: REPORT_SELECT,
    })
    if (!row) {
      throw new NotFoundException('Report not found')
    }
    return row
  }

  async createReport(
    tenantId: string,
    userId: string,
    input: CreateReportInput,
  ): Promise<ReportRow> {
    const name = input.name.trim()
    if (!name) {
      throw new BadRequestException('Report name is required')
    }
    if (name.length > MAX_REPORT_NAME_LENGTH) {
      throw new BadRequestException(
        `Report name must be at most ${MAX_REPORT_NAME_LENGTH} characters`,
      )
    }
    if (!isReportType(input.type)) {
      throw new BadRequestException('Unsupported report type')
    }

    let config: ReportConfig
    try {
      config = validateReportConfig(input.config)
    } catch (err) {
      throw new BadRequestException((err as Error).message)
    }

    // Max 50 active reports per creator (AC 8).
    await this.assertUnderActiveLimit(tenantId, userId)

    // Case-insensitive active-name uniqueness per (tenantId, createdBy) (AC 8).
    await this.assertNameAvailable(tenantId, userId, name)

    const row = await this.prisma.report.create({
      data: {
        tenantId,
        name,
        type: input.type,
        config: config as unknown as Prisma.InputJsonValue,
        createdBy: userId,
        updatedBy: userId,
        isPublic: input.isPublic ?? false,
      },
      select: REPORT_SELECT,
    })

    await this.audit.log({
      tenantId,
      userId,
      action: 'CREATE',
      entity: 'REPORT',
      entityId: row.id,
      details: { name },
    })

    return row
  }

  async updateReport(
    tenantId: string,
    userId: string,
    id: string,
    input: UpdateReportInput,
  ): Promise<ReportRow> {
    // Re-load by (id, tenantId, createdBy, deletedAt:null) — creator-only (AC 14).
    const current = await this.prisma.report.findFirst({
      where: { id, tenantId, createdBy: userId, deletedAt: null },
      select: REPORT_SELECT,
    })
    if (!current) {
      throw new NotFoundException('Report not found')
    }

    const data: Prisma.ReportUpdateInput = { updatedBy: userId }

    if (input.name !== undefined) {
      const name = input.name.trim()
      if (!name) {
        throw new BadRequestException('Report name is required')
      }
      if (name.length > MAX_REPORT_NAME_LENGTH) {
        throw new BadRequestException(
          `Report name must be at most ${MAX_REPORT_NAME_LENGTH} characters`,
        )
      }
      await this.assertNameAvailable(tenantId, userId, name, id)
      data.name = name
    }

    if (input.type !== undefined) {
      if (!isReportType(input.type)) {
        throw new BadRequestException('Unsupported report type')
      }
      data.type = input.type
    }

    if (input.config !== undefined) {
      try {
        data.config = validateReportConfig(input.config) as unknown as Prisma.InputJsonValue
      } catch (err) {
        throw new BadRequestException((err as Error).message)
      }
    }

    if (input.isPublic !== undefined) {
      data.isPublic = input.isPublic
    }

    const row = await this.prisma.report.update({ where: { id }, data, select: REPORT_SELECT })

    await this.audit.log({
      tenantId,
      userId,
      action: 'UPDATE',
      entity: 'REPORT',
      entityId: id,
      details: { name: input.name ?? current.name },
    })

    return row
  }

  async deleteReport(tenantId: string, userId: string, id: string): Promise<boolean> {
    // Creator-only soft delete (AC 15). Repeated/non-owner/cross-tenant
    // deletes hit the same NotFoundException path.
    const current = await this.prisma.report.findFirst({
      where: { id, tenantId, createdBy: userId, deletedAt: null },
      select: REPORT_SELECT,
    })
    if (!current) {
      throw new NotFoundException('Report not found')
    }

    await this.prisma.report.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: userId },
    })

    await this.audit.log({
      tenantId,
      userId,
      action: 'DELETE',
      entity: 'REPORT',
      entityId: id,
      details: { name: current.name },
    })

    return true
  }

  /**
   * Shared persistence invariant (Story 6.2 AC 8, reused by Story 6.3 custom
   * save): at most MAX_ACTIVE_REPORTS_PER_CREATOR active reports per creator,
   * counting every type (sales + custom).
   */
  async assertUnderActiveLimit(tenantId: string, userId: string): Promise<void> {
    const count = await this.prisma.report.count({
      where: { tenantId, createdBy: userId, deletedAt: null },
    })
    if (count >= MAX_ACTIVE_REPORTS_PER_CREATOR) {
      throw new BadRequestException(
        `You cannot have more than ${MAX_ACTIVE_REPORTS_PER_CREATOR} reports`,
      )
    }
  }

  /**
   * Shared persistence invariant (Story 6.2 AC 8, reused by Story 6.3 custom
   * save): case-insensitive active-name uniqueness per (tenantId, createdBy).
   */
  async assertNameAvailable(
    tenantId: string,
    userId: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.prisma.report.findMany({
      where: {
        tenantId,
        createdBy: userId,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { name: true },
    })
    if (existing.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
      throw new ConflictException('A report with this name already exists')
    }
  }

  // ─── Report data (AC 41-45) ────────────────────────────────────────────────

  /**
   * Idempotent report computation. `runReport` and `reportData` share this
   * code path; neither writes the database nor creates an audit row (AC 17,
   * AC 28 arbitration).
   */
  async reportData(
    tenantId: string,
    userId: string,
    reportId: string,
    filters?: ReportFiltersInput,
    drillDown?: ReportDrillDownInput,
  ): Promise<ReportData> {
    const report = await this.report(tenantId, userId, reportId)
    // Story 6.3 (Contract C.22): CUSTOM is a platform report type but never
    // enters the six-type sales calculation map — reject it before dispatch.
    if (report.type === 'CUSTOM') {
      throw new BadRequestException('Custom reports must be executed through customReportData')
    }
    if (!isReportType(report.type)) {
      throw new BadRequestException('Unsupported report type')
    }
    const config = this.resolveConfig(report, filters)
    return this.computeReportData(tenantId, userId, report, config, drillDown)
  }

  /**
   * Story 6.6 (Contract B10/M7): execute a sales report DIRECTLY from an
   * already-normalized effective config — the immutable export snapshot —
   * without re-parsing/re-merging the CURRENT saved config. This is what
   * makes replay structural: fields added or changed on the saved report
   * after the export was requested cannot alter the export scope.
   */
  async reportDataWithConfig(
    tenantId: string,
    userId: string,
    report: ReportRow,
    config: ReportConfig,
    drillDown?: ReportDrillDownInput,
  ): Promise<ReportData> {
    if (report.type === 'CUSTOM') {
      throw new BadRequestException('Custom reports must be executed through customReportData')
    }
    if (!isReportType(report.type)) {
      throw new BadRequestException('Unsupported report type')
    }
    return this.computeReportData(tenantId, userId, report, config, drillDown)
  }

  /** Compatibility mutation — same ReportData, no persistence, no audit (AC 28). */
  async runReport(
    tenantId: string,
    userId: string,
    reportId: string,
    filters?: ReportFiltersInput,
  ): Promise<ReportData> {
    return this.reportData(tenantId, userId, reportId, filters)
  }

  private resolveConfig(report: ReportRow, filters?: ReportFiltersInput): ReportConfig {
    // Defensive read of the persisted row (AC 7) — one corrupt row cannot blank the list.
    const base = parseReportConfig(report.config, report.type)
    if (!filters) {
      return base
    }
    // Runtime overrides apply field-by-field without mutating persisted config (AC 24).
    const merged: ReportConfig = { ...base }
    for (const key of Object.keys(filters) as (keyof ReportFiltersInput)[]) {
      const value = filters[key]
      if (value !== undefined) {
        ;(merged as unknown as Record<string, unknown>)[key] = value
      }
    }
    try {
      return validateReportConfig(merged as unknown as Record<string, unknown>)
    } catch (err) {
      throw new BadRequestException((err as Error).message)
    }
  }

  private async computeReportData(
    tenantId: string,
    userId: string,
    report: ReportRow,
    config: ReportConfig,
    drillDown?: ReportDrillDownInput,
  ): Promise<ReportData> {
    const type = report.type as ReportType
    const now = this.clock()

    let current: DayRange
    let comparison: DayRange | null
    try {
      current = resolveCurrentRange(config, now)
      comparison = resolveComparisonRange(config, current)
    } catch (err) {
      throw new BadRequestException((err as Error).message)
    }

    // Validate filter IDs against active same-tenant rows (AC 28).
    await this.validateFilterIds(tenantId, config)

    // Currency metadata across current + comparison scopes (AC 30).
    const scopeCurrent = await this.buildScopeWhere(type, tenantId, userId, config, current)
    const scopeComparison = comparison
      ? await this.buildScopeWhere(type, tenantId, userId, config, comparison)
      : null

    const allCurrencies = await this.detectCurrencies([scopeCurrent, scopeComparison])

    // Composed services (WinLoss/Forecast) cannot narrow by currency internally;
    // trust their money values only when the scope is single-currency (AC 30).
    const composeSemantics = type === 'WIN_LOSS' || type === 'REVENUE_FORECAST'
    let currency: string | null
    let mixedCurrencies: boolean
    if (config.currency) {
      if (
        composeSemantics &&
        (allCurrencies.length > 1 ||
          (allCurrencies.length === 1 && allCurrencies[0] !== config.currency))
      ) {
        currency = null
        mixedCurrencies = true
      } else {
        currency = config.currency
        mixedCurrencies = false
      }
    } else {
      mixedCurrencies = allCurrencies.length > 1
      currency = mixedCurrencies ? null : allCurrencies[0] ?? null
    }

    const narrowedCurrent =
      currency && !composeSemantics ? { ...scopeCurrent, currency } : scopeCurrent
    const narrowedComparison =
      comparison !== null
        ? currency && !composeSemantics
          ? { ...scopeComparison, currency }
          : scopeComparison
        : null

    const currentPeriod = await this.computePeriod(
      type,
      tenantId,
      userId,
      current,
      config,
      narrowedCurrent,
    )
    const comparisonPeriod =
      comparison !== null
        ? await this.computePeriod(
            type,
            tenantId,
            userId,
            comparison,
            config,
            narrowedComparison as Prisma.DealWhereInput,
          )
        : null

    this.attachComparison(currentPeriod, comparisonPeriod)

    if (mixedCurrencies) {
      this.nullMoney(currentPeriod, comparisonPeriod)
    }

    let drillConnection: ReportDrillConnection | null = null
    if (drillDown) {
      drillConnection = await this.computeDrillDown(
        tenantId,
        userId,
        type,
        config,
        narrowedCurrent,
        narrowedComparison,
        current,
        comparison,
        drillDown,
      )
    }

    const note = CALCULATION_NOTE_BY_TYPE[type] + (mixedCurrencies ? MIXED_CURRENCY_NOTE : '')

    return {
      reportId: report.id,
      reportType: type,
      generatedAt: now.toISOString(),
      dateField: DATE_FIELD_BY_TYPE[type],
      calculationNote: note,
      currency,
      mixedCurrencies,
      availableCurrencies: allCurrencies,
      appliedFilters: config,
      current: currentPeriod,
      comparison: comparisonPeriod,
      drillDown: drillConnection,
    }
  }

  private async detectCurrencies(wheres: Array<Prisma.DealWhereInput | null>): Promise<string[]> {
    const found = new Set<string>()
    for (const where of wheres) {
      if (!where) continue
      const grouped = await this.prisma.deal.groupBy({
        by: ['currency'],
        where,
        _count: { _all: true },
      })
      for (const g of grouped) {
        found.add(g.currency || 'USD')
      }
    }
    return Array.from(found).sort()
  }

  private async validateFilterIds(tenantId: string, config: ReportConfig): Promise<void> {
    if (config.ownerId) {
      const user = await this.prisma.user.findFirst({
        where: { id: config.ownerId, tenantId, deletedAt: null },
        select: { id: true },
      })
      if (!user) throw new BadRequestException('Invalid report filter: owner does not exist')
    }
    if (config.teamId) {
      const team = await this.prisma.team.findFirst({
        where: { id: config.teamId, tenantId, deletedAt: null },
        select: { id: true },
      })
      if (!team) throw new BadRequestException('Invalid report filter: team does not exist')
    }
    if (config.stageId) {
      const stage = await this.prisma.dealStage.findFirst({
        where: { id: config.stageId, tenantId, deletedAt: null },
        select: { id: true },
      })
      if (!stage) throw new BadRequestException('Invalid report filter: stage does not exist')
    }
    if (config.productId) {
      const product = await this.prisma.product.findFirst({
        where: { id: config.productId, tenantId, deletedAt: null },
        select: { id: true },
      })
      if (!product) throw new BadRequestException('Invalid report filter: product does not exist')
    }
  }

  /**
   * Base scope predicate: buildDealWhere visibility + tenant + deleted, then
   * narrow for team/stage/product/currency. Filters always NARROW — they can
   * never expand caller visibility (AC 40). No date semantics — callers add
   * the type-specific date filter themselves.
   */
  private async buildFilteredBaseWhere(
    tenantId: string,
    userId: string,
    config: ReportConfig,
  ): Promise<Prisma.DealWhereInput> {
    const base = await this.dealsService.buildDealWhere(tenantId, userId, {
      ownerId: config.ownerId ?? undefined,
    })

    let where: Prisma.DealWhereInput = base

    if (config.teamId) {
      where = withAnd(where, { owner: { teamId: config.teamId, deletedAt: null } })
    }
    if (config.stageId) {
      where = withAnd(where, { stageId: config.stageId })
    }
    if (config.productId) {
      where = withAnd(where, {
        lineItems: { some: { productId: config.productId, deletedAt: null } },
      })
    }
    if (config.currency) {
      where = withAnd(where, { currency: config.currency })
    }

    return where
  }

  private async buildScopeWhere(
    type: ReportType,
    tenantId: string,
    userId: string,
    config: ReportConfig,
    range: DayRange,
  ): Promise<Prisma.DealWhereInput> {
    const base = await this.buildFilteredBaseWhere(tenantId, userId, config)

    // Date semantics at the top level (mirrors win-loss.service.ts) — the base
    // predicate never touches these date fields.
    const dateField = DATE_FIELD_BY_TYPE[type]
    let where: Prisma.DealWhereInput = {
      ...base,
      [dateField]: { gte: range.start, lte: range.end },
    }

    // Pipeline / forecast scopes contain open deals only (AC 33, AC 35).
    if (type === 'PIPELINE_ANALYSIS' || type === 'REVENUE_FORECAST') {
      where = withAnd(where, { stage: { isWon: false, isLost: false } })
    }

    return where
  }

  /**
   * Bounded in-memory fetch for bucketing/median/weighting work (AC 29 + the
   * velocity guardrail): caps the fetch at MAX_BUCKET_ROWS and fails explicitly
   * when the scope exceeds the cap — calculations never silently truncate.
   */
  private async fetchBucketRows(
    where: Prisma.DealWhereInput,
    reportLabel: string,
  ): Promise<BucketRow[]> {
    const rows = (await this.prisma.deal.findMany({
      where,
      select: BUCKET_ROW_SELECT,
      take: MAX_BUCKET_ROWS + 1,
    })) as unknown as BucketRow[]
    if (rows.length > MAX_BUCKET_ROWS) {
      throw new BadRequestException(
        `${reportLabel} scope exceeds ${MAX_BUCKET_ROWS} deals — narrow your filters to run this report`,
      )
    }
    return rows
  }

  // ─── Per-type period computation (AC 31-37) ────────────────────────────────

  private async computePeriod(
    type: ReportType,
    tenantId: string,
    userId: string,
    range: DayRange,
    config: ReportConfig,
    scopeWhere: Prisma.DealWhereInput,
  ): Promise<ReportPeriod> {
    switch (type) {
      case 'SALES_OVERVIEW':
        return this.computeSalesOverview(tenantId, userId, range, config, scopeWhere)
      case 'PIPELINE_ANALYSIS':
        return this.computePipelineAnalysis(tenantId, userId, range, config, scopeWhere)
      case 'WIN_LOSS':
        return this.computeWinLoss(tenantId, userId, range, config, scopeWhere)
      case 'REVENUE_FORECAST':
        return this.computeRevenueForecast(tenantId, userId, range, config, scopeWhere)
      case 'TEAM_PERFORMANCE':
        return this.computeTeamPerformance(tenantId, userId, range, config, scopeWhere)
      case 'DEAL_VELOCITY':
        return this.computeDealVelocity(range, config, scopeWhere)
      default:
        // Exhaustive dispatch over the six REPORT_TYPES (AC 42); unknown
        // persisted types fail closed earlier, at reportData entry.
        throw new BadRequestException('Unsupported report type')
    }
  }

  private metric(
    key: ReportMetricKey,
    label: string,
    value: number | null,
    unit: ReportMetric['unit'],
  ): ReportMetric {
    return {
      key,
      label,
      value,
      unit,
      comparisonValue: null,
      percentageChange: null,
      direction: null,
      displayToken: 'NONE',
    }
  }

  private async computeSalesOverview(
    tenantId: string,
    _userId: string,
    range: DayRange,
    config: ReportConfig,
    scopeWhere: Prisma.DealWhereInput,
  ): Promise<ReportPeriod> {
    const wonWhere: Prisma.DealWhereInput = {
      ...scopeWhere,
      stage: { isWon: true },
      actualCloseDate: { gte: range.start, lte: range.end },
    }
    const lostWhere: Prisma.DealWhereInput = {
      ...scopeWhere,
      stage: { isLost: true },
      actualCloseDate: { gte: range.start, lte: range.end },
    }

    const [wonAgg, lostAgg] = await Promise.all([
      this.prisma.deal.aggregate({
        where: wonWhere,
        _sum: { value: true },
        _count: { _all: true },
      }),
      this.prisma.deal.aggregate({
        where: lostWhere,
        _sum: { value: true },
        _count: { _all: true },
      }),
    ])

    const wonValue = wonAgg._sum.value ?? 0
    const wonCount = wonAgg._count._all ?? 0
    const lostCount = lostAgg._count._all ?? 0
    const totalClosed = wonCount + lostCount
    const winRate = totalClosed > 0 ? round1((wonCount / totalClosed) * 100) : 0
    const avgDealSize = wonCount > 0 ? round2(wonValue / wonCount) : 0

    const wonRows = await this.fetchBucketRows(wonWhere, 'Sales overview')

    const buckets = this.buildBuckets(wonRows, config.groupBy, range, 'value', 'actualCloseDate')

    // AC 32: the created-date cohort must NOT inherit the closed-deal date
    // filter — it is a cohort of deals CREATED in the period (open deals too).
    const cohortWhere = withAnd(await this.buildFilteredBaseWhere(tenantId, _userId, config), {
      createdAt: { gte: range.start, lte: range.end },
    })
    const stageBreakdown = await this.computeStageSnapshot(tenantId, cohortWhere)

    return {
      startDate: isoDay(range.start),
      endDate: isoDay(range.end),
      metrics: [
        this.metric('TOTAL_REVENUE', 'Total revenue', round2(wonValue), 'CURRENCY'),
        this.metric('WON_DEALS', 'Won deals', wonCount, 'COUNT'),
        this.metric('LOST_DEALS', 'Lost deals', lostCount, 'COUNT'),
        this.metric('WIN_RATE', 'Win rate', winRate, 'PERCENT'),
        this.metric('AVERAGE_DEAL_SIZE', 'Average deal size', avgDealSize, 'CURRENCY'),
      ],
      buckets,
      stageBreakdown,
    }
  }

  /** AC 32: current-stage snapshot over the created-date cohort. */
  private async computeStageSnapshot(
    tenantId: string,
    cohortWhere: Prisma.DealWhereInput,
  ): Promise<ReportStageBreakdown[]> {
    const [grouped, stages] = await Promise.all([
      this.prisma.deal.groupBy({
        by: ['stageId'],
        where: cohortWhere,
        _count: { _all: true },
      }),
      this.prisma.dealStage.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { order: 'asc' },
        select: { id: true, name: true, order: true, color: true },
      }),
    ])

    const countByStage = new Map<string, number>()
    let cohortTotal = 0
    for (const g of grouped) {
      const count = g._count._all ?? 0
      countByStage.set(g.stageId, count)
      cohortTotal += count
    }

    return stages.map((stage) => {
      const dealCount = countByStage.get(stage.id) ?? 0
      return {
        stageId: stage.id,
        stageName: stage.name,
        order: stage.order,
        color: stage.color,
        dealCount,
        stageSharePct: cohortTotal > 0 ? round1((dealCount / cohortTotal) * 100) : 0,
        value: null,
      }
    })
  }

  private async computePipelineAnalysis(
    tenantId: string,
    _userId: string,
    range: DayRange,
    config: ReportConfig,
    scopeWhere: Prisma.DealWhereInput,
  ): Promise<ReportPeriod> {
    const openWhere: Prisma.DealWhereInput = {
      ...scopeWhere,
      expectedCloseDate: { gte: range.start, lte: range.end },
    }

    const [openAgg, stageGroup] = await Promise.all([
      this.prisma.deal.aggregate({
        where: openWhere,
        _sum: { value: true },
        _count: { _all: true },
      }),
      this.prisma.deal.groupBy({
        by: ['stageId'],
        where: openWhere,
        _count: { _all: true },
        _sum: { value: true },
      }),
    ])

    const openRows = await this.fetchBucketRows(openWhere, 'Pipeline analysis')

    const openCount = openAgg._count._all ?? 0
    const pipelineValue = openAgg._sum.value ?? 0
    let weightedValue = 0
    for (const row of openRows) {
      weightedValue += (row.value * row.probability) / 100
    }

    const buckets = this.buildBuckets(openRows, config.groupBy, range, 'value', 'expectedCloseDate')

    const stages = await this.prisma.dealStage.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { order: 'asc' },
      select: { id: true, name: true, order: true, color: true },
    })
    const valueByStage = new Map<string, number>()
    const countByStage = new Map<string, number>()
    for (const g of stageGroup) {
      valueByStage.set(g.stageId, g._sum.value ?? 0)
      countByStage.set(g.stageId, g._count._all ?? 0)
    }
    const stageBreakdown: ReportStageBreakdown[] = stages.map((stage) => ({
      stageId: stage.id,
      stageName: stage.name,
      order: stage.order,
      color: stage.color,
      dealCount: countByStage.get(stage.id) ?? 0,
      stageSharePct:
        openCount > 0 ? round1(((countByStage.get(stage.id) ?? 0) / openCount) * 100) : 0,
      value: round2(valueByStage.get(stage.id) ?? 0),
    }))

    return {
      startDate: isoDay(range.start),
      endDate: isoDay(range.end),
      metrics: [
        this.metric('OPEN_DEALS', 'Open deals', openCount, 'COUNT'),
        this.metric('PIPELINE_VALUE', 'Pipeline value', round2(pipelineValue), 'CURRENCY'),
        this.metric(
          'WEIGHTED_PIPELINE_VALUE',
          'Weighted pipeline value',
          round2(weightedValue),
          'CURRENCY',
        ),
      ],
      buckets,
      stageBreakdown,
    }
  }

  /** AC 34: compose WinLossService — never a second reason/competitor formula. */
  private async computeWinLoss(
    tenantId: string,
    userId: string,
    range: DayRange,
    config: ReportConfig,
    scopeWhere: Prisma.DealWhereInput,
  ): Promise<ReportPeriod> {
    // Stage/product/currency filters are forwarded into the composed service
    // (AC 24/28/40) so headline metrics agree with the scope-built buckets and
    // drill — the composed service narrows its own predicate identically.
    const result = await this.winLossService.winLossAnalysis(tenantId, userId, {
      startDate: isoDay(range.start),
      endDate: isoDay(range.end),
      ownerId: config.ownerId ?? undefined,
      teamId: config.teamId ?? undefined,
      stageId: config.stageId ?? undefined,
      productId: config.productId ?? undefined,
      currency: config.currency ?? undefined,
    })

    const closedWhere: Prisma.DealWhereInput = {
      ...scopeWhere,
      stage: { OR: [{ isWon: true }, { isLost: true }] },
    }
    const closedRows = await this.fetchBucketRows(closedWhere, 'Win/loss')

    const buckets = this.buildBuckets(closedRows, config.groupBy, range, 'value', 'actualCloseDate')

    return {
      startDate: isoDay(range.start),
      endDate: isoDay(range.end),
      metrics: [
        this.metric('TOTAL_CLOSED', 'Total closed', result.totalClosed, 'COUNT'),
        this.metric('WON_DEALS', 'Won deals', result.wonCount, 'COUNT'),
        this.metric('LOST_DEALS', 'Lost deals', result.lostCount, 'COUNT'),
        this.metric('WIN_RATE', 'Win rate', result.winRate, 'PERCENT'),
        this.metric('WON_VALUE', 'Won value', round2(result.wonValue), 'CURRENCY'),
        this.metric('LOST_VALUE', 'Lost value', round2(result.lostValue), 'CURRENCY'),
      ],
      buckets,
      stageBreakdown: [],
    }
  }

  /** AC 35: compose ForecastService.salesForecast for current/comparison scopes. */
  private async computeRevenueForecast(
    tenantId: string,
    userId: string,
    range: DayRange,
    config: ReportConfig,
    scopeWhere: Prisma.DealWhereInput,
  ): Promise<ReportPeriod> {
    const groupBy =
      config.groupBy === 'YEAR' || config.groupBy === 'PRODUCT' ? 'MONTH' : config.groupBy
    // Stage/product/currency filters are forwarded into the composed service
    // (AC 24/28/40) so headline bands agree with the scope-built buckets and
    // drill — the composed service narrows its own predicate identically.
    const result = await this.forecastService.salesForecast(tenantId, userId, {
      startDate: isoDay(range.start),
      endDate: isoDay(range.end),
      groupBy,
      ownerId: config.ownerId ?? undefined,
      teamId: config.teamId ?? undefined,
      stageId: config.stageId ?? undefined,
      productId: config.productId ?? undefined,
      currency: config.currency ?? undefined,
    })

    let buckets: ReportBucket[]
    if (config.groupBy === 'PRODUCT') {
      const openWhere: Prisma.DealWhereInput = {
        ...scopeWhere,
        expectedCloseDate: { gte: range.start, lte: range.end },
      }
      const openRows = await this.fetchBucketRows(openWhere, 'Revenue forecast')
      buckets = this.buildBuckets(openRows, 'PRODUCT', range, 'value', 'expectedCloseDate')
    } else {
      buckets = result.buckets.map((b) => ({
        key: b.key,
        label: b.label,
        value: round2(b.weightedValue),
        count: b.count,
        comparisonValue: null,
        percentageChange: null,
        direction: null,
        displayToken: 'NONE',
      }))
    }

    return {
      startDate: isoDay(range.start),
      endDate: isoDay(range.end),
      metrics: [
        this.metric(
          'FORECAST_COMMIT',
          'Forecast commit',
          round2(result.commit.weightedValue),
          'CURRENCY',
        ),
        this.metric(
          'FORECAST_BEST_CASE',
          'Forecast best case',
          round2(result.bestCase.weightedValue),
          'CURRENCY',
        ),
        this.metric(
          'FORECAST_PIPELINE',
          'Forecast pipeline',
          round2(result.pipeline.weightedValue),
          'CURRENCY',
        ),
        this.metric('OPEN_DEALS', 'Open deals', result.pipeline.count, 'COUNT'),
      ],
      buckets,
      stageBreakdown: [],
    }
  }

  /** AC 36: won metrics grouped by owner or team; missing team → "No team". */
  private async computeTeamPerformance(
    _tenantId: string,
    _userId: string,
    range: DayRange,
    config: ReportConfig,
    scopeWhere: Prisma.DealWhereInput,
  ): Promise<ReportPeriod> {
    const wonWhere: Prisma.DealWhereInput = {
      ...scopeWhere,
      stage: { isWon: true },
      actualCloseDate: { gte: range.start, lte: range.end },
    }
    const lostCount = await this.prisma.deal.count({
      where: {
        ...scopeWhere,
        stage: { isLost: true },
        actualCloseDate: { gte: range.start, lte: range.end },
      },
    })

    const wonRows = await this.fetchBucketRows(wonWhere, 'Team performance')

    const wonCount = wonRows.length
    let wonValue = 0
    for (const row of wonRows) wonValue += row.value
    const winRate = wonCount + lostCount > 0 ? round1((wonCount / (wonCount + lostCount)) * 100) : 0
    const avgWonDealSize = wonCount > 0 ? round2(wonValue / wonCount) : 0

    const buckets = this.buildBuckets(wonRows, config.groupBy, range, 'value', 'actualCloseDate')

    return {
      startDate: isoDay(range.start),
      endDate: isoDay(range.end),
      metrics: [
        this.metric('WON_REVENUE', 'Won revenue', round2(wonValue), 'CURRENCY'),
        this.metric('WON_DEALS', 'Won deals', wonCount, 'COUNT'),
        this.metric('LOST_DEALS', 'Lost deals', lostCount, 'COUNT'),
        this.metric('WIN_RATE', 'Win rate', winRate, 'PERCENT'),
        this.metric('AVG_WON_DEAL_SIZE', 'Average won deal size', avgWonDealSize, 'CURRENCY'),
      ],
      buckets,
      stageBreakdown: [],
    }
  }

  /** AC 37: average/median days createdAt → actualCloseDate for closed deals. */
  private async computeDealVelocity(
    range: DayRange,
    config: ReportConfig,
    scopeWhere: Prisma.DealWhereInput,
  ): Promise<ReportPeriod> {
    const closedRows = await this.fetchBucketRows(
      { ...scopeWhere, actualCloseDate: { gte: range.start, lte: range.end } },
      'Deal velocity',
    )

    const durations: number[] = []
    let excludedRowCount = 0
    for (const row of closedRows) {
      if (!row.actualCloseDate) continue
      const days = (row.actualCloseDate.getTime() - row.createdAt.getTime()) / MS_PER_DAY
      if (days < 0) {
        excludedRowCount += 1
        continue
      }
      durations.push(days)
    }

    const avg =
      durations.length > 0 ? round1(durations.reduce((a, b) => a + b, 0) / durations.length) : 0
    const sorted = [...durations].sort((a, b) => a - b)
    let median = 0
    if (sorted.length > 0) {
      const mid = Math.floor(sorted.length / 2)
      median =
        sorted.length % 2 === 0 ? round1((sorted[mid - 1] + sorted[mid]) / 2) : round1(sorted[mid])
    }

    const buckets = this.buildBuckets(closedRows, config.groupBy, range, 'days', 'actualCloseDate')

    return {
      startDate: isoDay(range.start),
      endDate: isoDay(range.end),
      metrics: [
        this.metric('CLOSED_DEALS', 'Closed deals', closedRows.length, 'COUNT'),
        this.metric('AVG_CYCLE_DAYS', 'Average cycle days', avg, 'DAYS'),
        this.metric('MEDIAN_CYCLE_DAYS', 'Median cycle days', median, 'DAYS'),
        this.metric(
          'EXCLUDED_ROWS',
          'Excluded rows (negative duration)',
          excludedRowCount,
          'COUNT',
        ),
      ],
      buckets,
      stageBreakdown: [],
    }
  }

  // ─── Buckets (AC 38-39) ────────────────────────────────────────────────────

  private buildBuckets(
    rows: BucketRow[],
    groupBy: ReportGroupBy,
    range: DayRange,
    mode: 'value' | 'days',
    dateField: 'actualCloseDate' | 'expectedCloseDate',
  ): ReportBucket[] {
    if (groupBy === 'MONTH' || groupBy === 'QUARTER' || groupBy === 'YEAR') {
      return this.buildDenseTimeBuckets(rows, groupBy, range, mode, dateField)
    }
    if (groupBy === 'OWNER') return this.buildOwnerBuckets(rows, mode)
    if (groupBy === 'TEAM') return this.buildTeamBuckets(rows, mode)
    return this.buildProductBuckets(rows, mode)
  }

  /** Time buckets are dense (zero-filled) (AC 38). */
  private buildDenseTimeBuckets(
    rows: BucketRow[],
    groupBy: 'MONTH' | 'QUARTER' | 'YEAR',
    range: DayRange,
    mode: 'value' | 'days',
    dateField: 'actualCloseDate' | 'expectedCloseDate',
  ): ReportBucket[] {
    const buckets: ReportBucket[] = []
    const bucketMap = new Map<string, { value: number; durations: number[]; count: number }>()

    for (const row of rows) {
      const date = row[dateField]
      if (!date) continue
      const key = timeBucketKey(date, groupBy)
      const entry = bucketMap.get(key) ?? { value: 0, durations: [], count: 0 }
      if (mode === 'value') {
        entry.value += row.value
      } else if (row.actualCloseDate) {
        entry.durations.push((row.actualCloseDate.getTime() - row.createdAt.getTime()) / MS_PER_DAY)
      }
      entry.count += 1
      bucketMap.set(key, entry)
    }

    let cursor = timeBucketStart(range.start, groupBy)
    while (cursor <= range.end) {
      const key = timeBucketKey(cursor, groupBy)
      const entry = bucketMap.get(key)
      let value: number | null
      if (mode === 'value') {
        value = entry ? round2(entry.value) : 0
      } else {
        const durations = entry?.durations ?? []
        value =
          durations.length > 0 ? round1(durations.reduce((a, b) => a + b, 0) / durations.length) : 0
      }
      buckets.push({
        key,
        label: timeBucketLabel(key, groupBy),
        value,
        count: entry?.count ?? 0,
        comparisonValue: null,
        percentageChange: null,
        direction: null,
        displayToken: 'NONE',
      })
      cursor = nextTimeBucket(cursor, groupBy)
    }
    return buckets
  }

  /** Owner buckets: sparse, sorted by primary metric desc then label asc (AC 38). */
  private buildOwnerBuckets(rows: BucketRow[], mode: 'value' | 'days'): ReportBucket[] {
    const map = new Map<
      string,
      { label: string; value: number; durations: number[]; count: number }
    >()
    for (const row of rows) {
      const key = row.owner?.id ?? 'unassigned'
      const label = row.owner ? `${row.owner.firstName} ${row.owner.lastName}`.trim() : 'Unassigned'
      const entry = map.get(key) ?? { label, value: 0, durations: [], count: 0 }
      if (mode === 'value') entry.value += row.value
      else if (row.actualCloseDate) {
        entry.durations.push((row.actualCloseDate.getTime() - row.createdAt.getTime()) / MS_PER_DAY)
      }
      entry.count += 1
      map.set(key, entry)
    }
    return this.finalizeSparseBuckets(map, mode)
  }

  /** Team buckets: missing team → stable key `unassigned` / label `No team` (AC 36). */
  private buildTeamBuckets(rows: BucketRow[], mode: 'value' | 'days'): ReportBucket[] {
    const map = new Map<
      string,
      { label: string; value: number; durations: number[]; count: number }
    >()
    for (const row of rows) {
      const key = row.owner?.teamId ?? 'unassigned'
      const label = row.owner?.team?.name ?? 'No team'
      const entry = map.get(key) ?? { label, value: 0, durations: [], count: 0 }
      if (mode === 'value') entry.value += row.value
      else if (row.actualCloseDate) {
        entry.durations.push((row.actualCloseDate.getTime() - row.createdAt.getTime()) / MS_PER_DAY)
      }
      entry.count += 1
      map.set(key, entry)
    }
    return this.finalizeSparseBuckets(map, mode)
  }

  /**
   * Product buckets: revenue attributed by active DealLineItem.total, counts
   * are distinct deals per bucket — one deal with multiple products is never
   * counted twice within a bucket (AC 39).
   */
  private buildProductBuckets(rows: BucketRow[], mode: 'value' | 'days'): ReportBucket[] {
    const map = new Map<
      string,
      { label: string; value: number; durations: number[]; deals: Set<string> }
    >()
    for (const row of rows) {
      for (const lineItem of row.lineItems) {
        // Human label from product.name, never the raw productId UUID (AC 41);
        // fall back to the id only when the product row is missing (deleted).
        const label = lineItem.product?.name ?? lineItem.productId
        const entry = map.get(lineItem.productId) ?? {
          label,
          value: 0,
          durations: [],
          deals: new Set<string>(),
        }
        if (mode === 'value') {
          entry.value += lineItem.total
        } else if (row.actualCloseDate) {
          entry.durations.push(
            (row.actualCloseDate.getTime() - row.createdAt.getTime()) / MS_PER_DAY,
          )
        }
        entry.deals.add(row.id)
        map.set(lineItem.productId, entry)
      }
    }
    const buckets: ReportBucket[] = Array.from(map.entries()).map(([key, entry]) => ({
      key,
      label: entry.label,
      value: mode === 'value' ? round2(entry.value) : 0,
      count: entry.deals.size,
      comparisonValue: null,
      percentageChange: null,
      direction: null,
      displayToken: 'NONE',
    }))
    buckets.sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || a.label.localeCompare(b.label))
    return buckets
  }

  private finalizeSparseBuckets(
    map: Map<string, { label: string; value: number; durations: number[]; count: number }>,
    mode: 'value' | 'days',
  ): ReportBucket[] {
    const buckets: ReportBucket[] = Array.from(map.entries()).map(([key, entry]) => {
      let value: number | null
      if (mode === 'value') {
        value = round2(entry.value)
      } else {
        value =
          entry.durations.length > 0
            ? round1(entry.durations.reduce((a, b) => a + b, 0) / entry.durations.length)
            : 0
      }
      return {
        key,
        label: entry.label,
        value,
        count: entry.count,
        comparisonValue: null,
        percentageChange: null,
        direction: null,
        displayToken: 'NONE',
      }
    })
    // Deterministic: primary metric desc, then label asc (AC 38).
    buckets.sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || a.label.localeCompare(b.label))
    return buckets
  }

  // ─── Comparison attachment (AC 25-26) ──────────────────────────────────────

  private attachComparison(current: ReportPeriod, comparison: ReportPeriod | null): void {
    if (!comparison) return
    for (const metric of current.metrics) {
      const comp = comparison.metrics.find((m) => m.key === metric.key)
      if (!comp) continue
      metric.comparisonValue = comp.value
      Object.assign(metric, changeFor(metric.value, comp.value))
    }
    const compByKey = new Map(comparison.buckets.map((b) => [b.key, b]))
    for (const bucket of current.buckets) {
      const comp = compByKey.get(bucket.key)
      if (!comp) continue
      bucket.comparisonValue = comp.value
      Object.assign(bucket, changeFor(bucket.value, comp.value))
    }
  }

  /** AC 30: mixed currencies → money metrics/series null until a currency is selected. */
  private nullMoney(current: ReportPeriod, comparison: ReportPeriod | null): void {
    const nullify = (period: ReportPeriod): void => {
      for (const metric of period.metrics) {
        if (metric.unit !== 'CURRENCY') continue
        metric.value = null
        metric.comparisonValue = null
        metric.percentageChange = null
        metric.direction = null
        metric.displayToken = 'NONE'
      }
      for (const bucket of period.buckets) {
        bucket.value = null
        bucket.comparisonValue = null
        bucket.percentageChange = null
        bucket.direction = null
        bucket.displayToken = 'NONE'
      }
    }
    nullify(current)
    if (comparison) nullify(comparison)
  }

  // ─── Drill-down (AC 46-53) ─────────────────────────────────────────────────

  private async computeDrillDown(
    tenantId: string,
    _userId: string,
    type: ReportType,
    config: ReportConfig,
    currentWhere: Prisma.DealWhereInput,
    comparisonWhere: Prisma.DealWhereInput | null,
    currentRange: DayRange,
    comparisonRange: DayRange | null,
    drill: ReportDrillDownInput,
  ): Promise<ReportDrillConnection> {
    const scope: 'CURRENT' | 'COMPARISON' = drill.scope === 'COMPARISON' ? 'COMPARISON' : 'CURRENT'
    if (scope === 'COMPARISON' && (!comparisonWhere || !comparisonRange)) {
      throw new BadRequestException(
        'Comparison scope requested but no comparison period is configured',
      )
    }
    const baseWhere =
      scope === 'COMPARISON' ? (comparisonWhere as Prisma.DealWhereInput) : currentWhere

    if (!isReportMetricKey(drill.metricKey)) {
      throw new BadRequestException('Invalid drill metric')
    }
    const drillable = REPORT_DRILL_METRICS[type]
    if (!drillable.includes(drill.metricKey as ReportMetricKey)) {
      throw new BadRequestException(`Metric ${drill.metricKey} is not drillable for ${type} report`)
    }

    const where = await this.buildDrillPredicate(
      type,
      tenantId,
      config,
      baseWhere,
      drill.metricKey as ReportMetricKey,
      drill.bucketKey,
      scope,
      currentRange,
      comparisonRange,
    )

    const page = Math.max(drill.page ?? 1, 1)
    const pageSize = Math.min(Math.max(drill.pageSize ?? 20, 1), 100)

    const [items, total] = await Promise.all([
      this.prisma.deal.findMany({
        where,
        select: DRILL_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.deal.count({ where }),
    ])

    return {
      items: items.map((row) => this.toDrillRow(row as unknown as DrillRowRaw)),
      total,
      page,
      pageSize,
    }
  }

  /**
   * Closed metric → predicate mapping (AC 46, 50). The drill predicate exactly
   * matches the clicked metric/bucket on top of the scope (visibility + filters
   * + date semantics). A drill row can never escape buildDealWhere visibility
   * (AC 52) because baseWhere always derives from it.
   */
  private async buildDrillPredicate(
    type: ReportType,
    tenantId: string,
    config: ReportConfig,
    baseWhere: Prisma.DealWhereInput,
    metricKey: ReportMetricKey,
    bucketKey: string | undefined,
    scope: 'CURRENT' | 'COMPARISON',
    currentRange: DayRange,
    comparisonRange: DayRange | null,
  ): Promise<Prisma.DealWhereInput> {
    const where: Prisma.DealWhereInput = { ...baseWhere }

    switch (metricKey) {
      case 'TOTAL_REVENUE':
      case 'WON_DEALS':
      case 'WON_VALUE':
      case 'WON_REVENUE':
      case 'AVERAGE_DEAL_SIZE':
      case 'AVG_WON_DEAL_SIZE':
        where.stage = { isWon: true }
        break
      case 'LOST_DEALS':
      case 'LOST_VALUE':
        where.stage = { isLost: true }
        break
      case 'TOTAL_CLOSED':
        where.stage = { OR: [{ isWon: true }, { isLost: true }] }
        break
      case 'OPEN_DEALS':
      case 'PIPELINE_VALUE':
      case 'WEIGHTED_PIPELINE_VALUE':
      case 'FORECAST_PIPELINE':
        where.stage = { isWon: false, isLost: false }
        break
      case 'FORECAST_BEST_CASE':
        where.stage = { isWon: false, isLost: false }
        where.probability = { gte: 50 }
        break
      case 'FORECAST_COMMIT':
        where.stage = { isWon: false, isLost: false }
        where.probability = { gte: 75 }
        break
      case 'CLOSED_DEALS':
        // actualCloseDate range already in baseWhere.
        break
      default:
        throw new BadRequestException(`Metric ${metricKey} is not drillable`)
    }

    if (bucketKey) {
      switch (config.groupBy) {
        case 'OWNER':
          where.ownerId = bucketKey
          break
        case 'TEAM':
          if (bucketKey === 'unassigned') {
            where.owner = { teamId: null }
          } else {
            const team = await this.prisma.team.findFirst({
              where: { id: bucketKey, tenantId, deletedAt: null },
              select: { id: true },
            })
            if (!team) throw new BadRequestException('Invalid bucket key')
            where.owner = { teamId: bucketKey }
          }
          break
        case 'PRODUCT':
          where.lineItems = { some: { productId: bucketKey, deletedAt: null } }
          break
        case 'MONTH':
        case 'QUARTER':
        case 'YEAR': {
          if (TIME_KEY_PATTERN.test(bucketKey)) {
            const sub = parseTimeBucketKey(bucketKey, config.groupBy)
            const dateField = DATE_FIELD_BY_TYPE[type]
            if (scope === 'COMPARISON' && comparisonRange) {
              // AC 53: the drill re-runs the same closed predicate against
              // the comparison period — map the current bucket to the
              // comparison period's bucket by INDEX (the current bucket is
              // the Nth bucket from the current range start; the comparison
              // bucket is the Nth bucket from the comparison range start).
              // Never re-apply the current bucketKey's date range on top of
              // the comparison baseWhere. When the ranges have no equivalent
              // bucket (e.g. a CUSTOM comparison with different alignment),
              // return an EMPTY result rather than current-period data.
              const mapped = mapTimeBucketToComparison(
                sub.start,
                config.groupBy,
                currentRange,
                comparisonRange,
              )
              where[dateField] = mapped
                ? { gte: mapped.start, lte: mapped.end }
                : { gte: NO_DRILL_MATCH_DATE }
            } else {
              where[dateField] = { gte: sub.start, lte: sub.end }
            }
          } else if (type === 'PIPELINE_ANALYSIS') {
            // Stage-bucket drill for the pipeline stage breakdown.
            where.stageId = bucketKey
          } else {
            throw new BadRequestException('Invalid bucket key')
          }
          break
        }
      }
    }

    return where
  }

  private toDrillRow(row: DrillRowRaw): ReportDrillRow {
    const productNames = Array.from(
      new Set(
        (row.lineItems ?? [])
          .map((li) => li.product?.name)
          .filter((n): n is string => typeof n === 'string'),
      ),
    ).sort()

    const contactName = row.contact
      ? [row.contact.firstName, row.contact.lastName].filter(Boolean).join(' ').trim() || null
      : null
    const ownerName = row.owner
      ? [row.owner.firstName, row.owner.lastName].filter(Boolean).join(' ').trim() || null
      : null

    return {
      id: row.id,
      title: row.title,
      value: row.value,
      currency: row.currency,
      probability: row.probability,
      stageId: row.stageId,
      stageName: row.stage?.name ?? null,
      contactId: row.contactId,
      contactName,
      ownerId: row.ownerId,
      ownerName,
      teamId: row.owner?.teamId ?? null,
      teamName: row.owner?.team?.name ?? null,
      productNames,
      createdAt: row.createdAt.toISOString(),
      expectedCloseDate: row.expectedCloseDate ? row.expectedCloseDate.toISOString() : null,
      actualCloseDate: row.actualCloseDate ? row.actualCloseDate.toISOString() : null,
      dealHref: `/deals/${row.id}`,
      contactHref: row.contactId ? `/contacts/${row.contactId}` : null,
    }
  }
}

// One bounded Prisma query + count for drill-down (AC 51) — no per-row lookups.
const DRILL_SELECT = {
  id: true,
  title: true,
  value: true,
  currency: true,
  probability: true,
  stageId: true,
  contactId: true,
  ownerId: true,
  createdAt: true,
  expectedCloseDate: true,
  actualCloseDate: true,
  stage: { select: { id: true, name: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  owner: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      teamId: true,
      team: { select: { id: true, name: true } },
    },
  },
  lineItems: {
    where: { deletedAt: null },
    select: { product: { select: { name: true } } },
  },
} as const

type DrillRowRaw = {
  id: string
  title: string
  value: number
  currency: string
  probability: number
  stageId: string
  contactId: string | null
  ownerId: string
  createdAt: Date
  expectedCloseDate: Date | null
  actualCloseDate: Date | null
  stage: { id: string; name: string } | null
  contact: { id: string; firstName: string; lastName: string } | null
  owner: {
    id: string
    firstName: string
    lastName: string
    teamId: string | null
    team: { id: string; name: string } | null
  } | null
  lineItems: Array<{ product: { name: string } | null }>
}
