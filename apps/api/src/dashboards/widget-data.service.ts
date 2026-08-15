/**
 * WidgetDataService (Story 6.1) — aggregates data for dashboard widgets.
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types */
import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { DealsService } from '../deals/deals.service'
import { DealStageService } from '../deals/deal-stages.service'
import { DealHealthService } from '../deal-health/deal-health.service'
import { TasksService } from '../tasks/tasks.service'
import { ActivityService } from '../activities/activities.service'
import { ContactsService } from '../contacts/contacts.service'
import { ForecastService } from '../reports/forecast.service'
import { WinLossService } from '../reports/win-loss.service'
import { ProductivityService } from '../reports/productivity.service'
import { parseWidgetConfig } from './widget-config'
import { WIDGET_SOURCES, MAX_LIST_WIDGET_ROWS, MAX_CHART_POINTS } from './widget-types'
import type { WidgetSource, WidgetType } from './widget-types'

type WidgetMetric = {
  label: string
  value: number
  unit: string | null
  trendPercent: number | null
  trendDirection: 'UP' | 'DOWN' | 'FLAT' | null
}
type WidgetPoint = { key: string; label: string; value: number; secondaryValue: number | null }
type WidgetSeries = { key: string; label: string; color: string; points: WidgetPoint[] }
type WidgetRow = {
  id: string
  primaryLabel: string
  secondaryLabel: string | null
  value: string | null
  href: string | null
  badgeLabel: string | null
  badgeTone: 'NEUTRAL' | 'WARNING' | 'DANGER' | 'SUCCESS' | null
}

export type WidgetDataResult = {
  widgetId: string
  source: WidgetSource
  type: WidgetType
  generatedAt: string
  permissionLimited: boolean
  currency: string | null
  metric: WidgetMetric | null
  series: WidgetSeries[]
  rows: WidgetRow[]
  total: number | null
}

type WidgetContext = {
  requirePermission: (resource: string, action: string) => Promise<void> | void
}

@Injectable()
export class WidgetDataService {
  private readonly logger = new Logger(WidgetDataService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly deals: DealsService,
    private readonly dealStages: DealStageService,
    private readonly dealHealth: DealHealthService,
    private readonly tasks: TasksService,
    private readonly activities: ActivityService,
    private readonly contacts: ContactsService,
    private readonly forecast: ForecastService,
    private readonly winLoss: WinLossService,
    private readonly productivity: ProductivityService,
  ) {}

  async widgetData(
    tenantId: string,
    userId: string,
    widgetId: string,
    context: WidgetContext,
    now: Date = new Date(),
  ): Promise<WidgetDataResult> {
    await context.requirePermission('REPORT', 'READ')

    const widget = await this.prisma.widget.findFirst({
      where: { id: widgetId, tenantId, deletedAt: null },
      select: { id: true, type: true, config: true },
    })
    if (!widget) throw new BadRequestException('Widget not found')

    const config = parseWidgetConfig(widget.config)
    const source = config.source
    const type = widget.type as WidgetType

    try {
      await context.requirePermission(
        WIDGET_SOURCES[source].permission.resource,
        WIDGET_SOURCES[source].permission.action,
      )
    } catch (e) {
      if (e instanceof ForbiddenException) {
        this.logger.warn(`Permission limited for widget ${widgetId} (source: ${source})`)
        return emptyResult(widgetId, source, type, true)
      }
      throw e
    }

    try {
      const resolved = await this.resolveSource(tenantId, userId, source, type, config, now)
      // currency: no data source currently supplies a per-tenant currency, so
      // USD is the fixed default. If a source ever provides one, thread it
      // through here instead of hardcoding.
      return {
        widgetId,
        source,
        type,
        generatedAt: new Date().toISOString(),
        permissionLimited: false,
        currency: 'USD',
        ...resolved,
      }
    } catch (e) {
      this.logger.error(
        `Widget data failed for ${widgetId} (source: ${source})`,
        (e as Error).stack,
      )
      throw e
    }
  }

  private async resolveSource(
    tenantId: string,
    userId: string,
    source: WidgetSource,
    type: WidgetType,
    config: ReturnType<typeof parseWidgetConfig>,
    now: Date,
  ): Promise<
    Omit<
      WidgetDataResult,
      'widgetId' | 'source' | 'type' | 'generatedAt' | 'permissionLimited' | 'currency'
    >
  > {
    switch (source) {
      case 'PIPELINE_BY_STAGE':
      case 'PIPELINE_VALUE':
        return this.resolvePipeline(tenantId, userId, source, type)
      case 'SALES_FORECAST':
        return this.resolveSalesForecast(tenantId, userId, type, config, now)
      case 'WIN_LOSS':
        return this.resolveWinLoss(tenantId, userId, type, config, now)
      case 'AT_RISK_DEALS':
        return this.resolveAtRiskDeals(tenantId, userId)
      case 'MY_TASKS':
        return this.resolveMyTasks(tenantId, userId)
      case 'TASK_STATS':
        return this.resolveTaskStats(tenantId, userId, type)
      case 'RECENT_ACTIVITY':
        return this.resolveRecentActivity(tenantId, userId)
      case 'TIME_TRACKED':
        return this.resolveTimeTracked(tenantId, userId, type, config, now)
      case 'CONTACT_COUNT':
        return this.resolveContactCount(tenantId, userId, type)
    }
  }

  private async resolvePipeline(
    tenantId: string,
    userId: string,
    source: WidgetSource,
    type: WidgetType,
  ): Promise<
    Omit<
      WidgetDataResult,
      'widgetId' | 'source' | 'type' | 'generatedAt' | 'permissionLimited' | 'currency'
    >
  > {
    const stages = await this.dealStages.findMany(tenantId)
    const summary = await this.deals.pipelineSummary(tenantId, userId)
    const pipelineValue = summary.reduce(
      (s: number, st: { totalValue: number }) => s + st.totalValue,
      0,
    )
    const stageMap = new Map(stages.map((st) => [st.id, st]))

    if (source === 'PIPELINE_VALUE') {
      return {
        metric: {
          label: 'Pipeline Value',
          value: pipelineValue,
          unit: 'USD',
          trendPercent: null,
          trendDirection: null,
        },
        series: [],
        rows: [],
        total: pipelineValue,
      }
    }
    const points = summary.map((s) => {
      const stage = stageMap.get(s.stageId) as Record<string, unknown> | undefined
      return {
        key: s.stageId,
        label: (stage?.name as string) ?? s.stageId,
        value: s.totalValue,
        secondaryValue: s.count,
      }
    })
    return {
      metric:
        type === 'METRIC_CARD'
          ? {
              label: 'Total Pipeline',
              value: pipelineValue,
              unit: 'USD',
              trendPercent: null,
              trendDirection: null,
            }
          : null,
      series: [{ key: 'pipeline', label: 'Pipeline', color: '#3b82f6', points }],
      rows: [],
      total: pipelineValue,
    }
  }

  private async resolveSalesForecast(
    tenantId: string,
    userId: string,
    type: WidgetType,
    config: ReturnType<typeof parseWidgetConfig>,
    now: Date,
  ): Promise<
    Omit<
      WidgetDataResult,
      'widgetId' | 'source' | 'type' | 'generatedAt' | 'permissionLimited' | 'currency'
    >
  > {
    const start = new Date(now.getTime() - config.dateRangeDays * 86400000).toISOString()
    const result = await this.forecast.salesForecast(tenantId, userId, {
      startDate: start,
      endDate: now.toISOString(),
      groupBy: 'MONTH',
    })
    const points: WidgetPoint[] = result.buckets.map((b) => ({
      key: b.key,
      label: b.label,
      value: b.totalValue,
      secondaryValue: b.count,
    }))
    if (points.length > MAX_CHART_POINTS)
      throw new BadRequestException(`Forecast data exceeds ${MAX_CHART_POINTS} points.`)
    const total = result.commit.totalValue
    return {
      metric:
        type === 'METRIC_CARD'
          ? {
              label: 'Forecast',
              value: total,
              unit: 'USD',
              trendPercent: null,
              trendDirection: null,
            }
          : null,
      series: [{ key: 'forecast', label: 'Forecast', color: '#0ea5e9', points }],
      rows: [],
      total,
    }
  }

  private async resolveWinLoss(
    tenantId: string,
    userId: string,
    type: WidgetType,
    config: ReturnType<typeof parseWidgetConfig>,
    now: Date,
  ) {
    const start = new Date(now.getTime() - config.dateRangeDays * 86400000).toISOString()
    const result = await this.winLoss.winLossAnalysis(tenantId, userId, {
      startDate: start,
      endDate: now.toISOString(),
    })
    const winRate =
      result.totalClosed > 0 ? Math.round((result.wonCount / result.totalClosed) * 100) : 0
    return {
      metric:
        type === 'METRIC_CARD'
          ? {
              label: 'Win Rate',
              value: winRate,
              unit: '%',
              trendPercent: null,
              trendDirection: null,
            }
          : null,
      series: [
        {
          key: 'winloss',
          label: 'Win/Loss',
          color: '#22c55e',
          points: [
            { key: 'won', label: 'Won', value: result.wonCount, secondaryValue: null },
            { key: 'lost', label: 'Lost', value: result.lostCount, secondaryValue: null },
          ],
        },
      ],
      rows: [],
      total: result.totalClosed,
    }
  }

  private async resolveAtRiskDeals(tenantId: string, userId: string) {
    const result = await this.dealHealth.findAtRisk(tenantId, userId, {
      page: 1,
      pageSize: MAX_LIST_WIDGET_ROWS,
    })
    const rows: WidgetRow[] = result.items.map((entry) => ({
      id: String(entry.deal.id),
      primaryLabel: String((entry.deal as Record<string, unknown>).title ?? ''),
      secondaryLabel: null,
      value: null,
      href: `/deals/${entry.deal.id}`,
      badgeLabel: entry.deal.healthStatus ? String(entry.deal.healthStatus) : '',
      badgeTone: mapHealthTone(entry.deal.healthStatus as string | null | undefined),
    }))
    return { metric: null, series: [], rows, total: result.total }
  }

  private async resolveMyTasks(tenantId: string, userId: string) {
    // Open statuses (TODO + IN_PROGRESS), not just TODO — a task mid-flight is
    // still "mine to work on" (AC 32 "open statuses").
    const result = await this.tasks.findMany(
      tenantId,
      userId,
      { assignedTo: userId, statuses: ['TODO', 'IN_PROGRESS'] },
      { page: 1, pageSize: MAX_LIST_WIDGET_ROWS },
      { field: 'DUE_DATE', direction: 'ASC' },
    )
    const rows: WidgetRow[] = result.items.map((task) => ({
      id: task.id,
      primaryLabel: task.title,
      secondaryLabel: task.dueDate ? String(task.dueDate) : null,
      value: null,
      href: `/tasks/${task.id}`,
      badgeLabel: task.priority ? String(task.priority) : null,
      badgeTone:
        task.priority === 'HIGH' ? 'DANGER' : task.priority === 'MEDIUM' ? 'WARNING' : 'NEUTRAL',
    }))
    return { metric: null, series: [], rows, total: result.total }
  }

  private async resolveTaskStats(tenantId: string, userId: string, type: WidgetType) {
    const stats = await this.tasks.getStats(tenantId, userId)
    return {
      metric:
        type === 'METRIC_CARD'
          ? ({
              label: 'Open Tasks',
              value: stats.openTasks,
              unit: null,
              trendPercent: stats.overdue > 0 ? stats.overdue : null,
              trendDirection: (stats.overdue > 0 ? 'UP' : null) as 'UP' | null,
            } as WidgetMetric)
          : null,
      series: [],
      rows: [],
      total: stats.openTasks,
    }
  }

  private async resolveRecentActivity(tenantId: string, userId: string) {
    const result = await this.activities.findFeed(
      tenantId,
      userId,
      {},
      { page: 1, pageSize: MAX_LIST_WIDGET_ROWS },
    )
    const rows: WidgetRow[] = result.items.map((a) => ({
      id: a.id,
      primaryLabel: a.title ?? String(a.type),
      secondaryLabel: a.createdAt ? String(a.createdAt) : null,
      value: null,
      href: null,
      badgeLabel: String(a.type),
      badgeTone: 'NEUTRAL' as const,
    }))
    return { metric: null, series: [], rows, total: result.total }
  }

  private async resolveTimeTracked(
    tenantId: string,
    userId: string,
    type: WidgetType,
    config: ReturnType<typeof parseWidgetConfig>,
    now: Date,
  ) {
    const start = new Date(now.getTime() - config.dateRangeDays * 86400000).toISOString()
    // Bucket by WEEK, not DAY: the default dateRangeDays (30) would otherwise
    // produce 30 daily points, always exceeding MAX_CHART_POINTS (24) and
    // throwing on every read (dogfood-caught). Weekly totals stay well under
    // the cap for the default 30-day range (~5 points).
    const result = await this.productivity.productivityReport(tenantId, userId, {
      startDate: start,
      endDate: now.toISOString(),
      bucket: 'WEEK',
    })
    const points: WidgetPoint[] = result.buckets.map((b) => ({
      key: b.bucketStart,
      label: b.bucketStart,
      value: Math.round((b.totalSeconds / 3600) * 10) / 10,
      secondaryValue: null,
    }))
    if (points.length > MAX_CHART_POINTS)
      throw new BadRequestException(`Time data exceeds ${MAX_CHART_POINTS} points.`)
    return {
      metric:
        type === 'METRIC_CARD'
          ? {
              label: 'Hours Tracked',
              value: Math.round((result.totalSeconds / 3600) * 10) / 10,
              unit: 'hrs',
              trendPercent: null,
              trendDirection: null,
            }
          : null,
      series: [{ key: 'time', label: 'Hours', color: '#f59e0b', points }],
      rows: [],
      total: result.totalSeconds,
    }
  }

  private async resolveContactCount(tenantId: string, userId: string, type: WidgetType) {
    const stats = await this.contacts.getStats(tenantId, userId)
    return {
      metric:
        type === 'METRIC_CARD'
          ? ({
              label: 'Contacts',
              value: stats.total,
              unit: null,
              trendPercent: stats.addedThisMonth || null,
              trendDirection: (stats.addedThisMonth > 0 ? 'UP' : 'FLAT') as 'UP' | 'FLAT',
            } as WidgetMetric)
          : null,
      series: [],
      rows: [],
      total: stats.total,
    }
  }
}

function emptyResult(
  widgetId: string,
  source: WidgetSource,
  type: WidgetType,
  permissionLimited = false,
): WidgetDataResult {
  return {
    widgetId,
    source,
    type,
    generatedAt: new Date().toISOString(),
    permissionLimited,
    currency: null,
    metric: null,
    series: [],
    rows: [],
    total: null,
  }
}

function mapHealthTone(status: string | null | undefined): WidgetRow['badgeTone'] {
  if (!status) return null
  if (status === 'HEALTHY') return 'SUCCESS'
  if (status === 'AT_RISK') return 'WARNING'
  if (status === 'CRITICAL') return 'DANGER'
  return 'NEUTRAL'
}
