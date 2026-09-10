import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import { CacheService } from '../cache/cache.service'
import { parseWidgetConfig } from './widget-config'
import { WIDGET_SOURCES } from './widget-types'
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async widgetData(
    tenantId: string,
    userId: string,
    widgetId: string,
    context: WidgetContext,
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
    } catch (error) {
      if (error instanceof ForbiddenException) return this.empty(widget.id, source, type, true)
      throw error
    }
    // Permission checks always run before the cache is read. The result key is
    // tenant- and user-scoped because task widgets may expose user-specific data.
    const result = await this.cache.getOrSetTenantJson(
      'dashboard-widget',
      tenantId,
      `${userId}:${widget.id}:${source}:${config.limit}`,
      30,
      () => this.resolve(tenantId, userId, source, config.limit),
    )
    return {
      widgetId: widget.id,
      source,
      type,
      generatedAt: new Date().toISOString(),
      permissionLimited: false,
      currency: null,
      ...result,
    }
  }

  private async resolve(
    tenantId: string,
    userId: string,
    source: WidgetSource,
    limit: number,
  ): Promise<Pick<WidgetDataResult, 'metric' | 'series' | 'rows' | 'total'>> {
    if (source === 'CONTACT_COUNT') {
      const total = await this.prisma.contact.count({ where: { tenantId, deletedAt: null } })
      return {
        metric: {
          label: 'Contacts',
          value: total,
          unit: null,
          trendPercent: null,
          trendDirection: null,
        },
        series: [],
        rows: [],
        total,
      }
    }
    if (source === 'LEAD_FUNNEL') {
      const grouped = await this.prisma.contact.groupBy({
        by: ['leadStatus'],
        where: { tenantId, deletedAt: null },
        _count: { _all: true },
      })
      const points = grouped.map((row) => ({
        key: row.leadStatus,
        label: row.leadStatus.replaceAll('_', ' '),
        value: row._count._all,
        secondaryValue: null,
      }))
      return {
        metric: null,
        series: [{ key: 'lead-funnel', label: 'Lead funnel', color: '#4f46e5', points }],
        rows: [],
        total: points.reduce((sum, point) => sum + point.value, 0),
      }
    }
    if (source === 'MY_TASKS') {
      const tasks = await this.prisma.task.findMany({
        where: {
          tenantId,
          assignedTo: userId,
          deletedAt: null,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        take: limit,
        select: { id: true, title: true, dueDate: true, priority: true },
      })
      return {
        metric: null,
        series: [],
        rows: tasks.map((task) => ({
          id: task.id,
          primaryLabel: task.title,
          secondaryLabel: task.dueDate?.toISOString() ?? null,
          value: task.priority,
          href: `/tasks/${task.id}`,
          badgeLabel: task.priority,
          badgeTone: task.priority === 'URGENT' ? 'DANGER' : 'NEUTRAL',
        })),
        total: tasks.length,
      }
    }
    if (source === 'TASK_STATS') {
      const [open, completed] = await Promise.all([
        this.prisma.task.count({
          where: {
            tenantId,
            assignedTo: userId,
            deletedAt: null,
            status: { in: ['TODO', 'IN_PROGRESS'] },
          },
        }),
        this.prisma.task.count({
          where: { tenantId, assignedTo: userId, deletedAt: null, status: 'COMPLETED' },
        }),
      ])
      return {
        metric: {
          label: 'Open tasks',
          value: open,
          unit: null,
          trendPercent: null,
          trendDirection: null,
        },
        series: [
          {
            key: 'tasks',
            label: 'Tasks',
            color: '#2563eb',
            points: [
              { key: 'open', label: 'Open', value: open, secondaryValue: null },
              { key: 'completed', label: 'Completed', value: completed, secondaryValue: null },
            ],
          },
        ],
        rows: [],
        total: open + completed,
      }
    }
    const activities = await this.prisma.activity.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, title: true, createdAt: true, contactId: true, type: true },
    })
    return {
      metric: null,
      series: [],
      rows: activities.map((activity) => ({
        id: activity.id,
        primaryLabel: activity.title,
        secondaryLabel: activity.createdAt.toISOString(),
        value: activity.type,
        href: `/contacts/${activity.contactId}`,
        badgeLabel: null,
        badgeTone: null,
      })),
      total: activities.length,
    }
  }

  private empty(
    widgetId: string,
    source: WidgetSource,
    type: WidgetType,
    permissionLimited: boolean,
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
}
