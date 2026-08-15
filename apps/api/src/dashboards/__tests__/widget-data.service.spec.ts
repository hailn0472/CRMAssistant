import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { WidgetDataService } from '../widget-data.service'

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('../widget-config', () => ({
  parseWidgetConfig: jest.fn((raw: unknown) => {
    const cfg = (raw as Record<string, unknown>) ?? {}
    return {
      source: (cfg.source as string) ?? 'TASK_STATS',
      dateRangeDays: (cfg.dateRangeDays as number) ?? 30,
      stageId: (cfg.stageId as string | null) ?? null,
      ownerId: (cfg.ownerId as string | null) ?? null,
      limit: (cfg.limit as number) ?? 5,
    }
  }),
}))

describe('WidgetDataService', () => {
  let service: WidgetDataService
  let mockPrisma: any
  let mockDeals: any
  let mockDealStages: any
  let mockDealHealth: any
  let mockTasks: any
  let mockActivities: any
  let mockContacts: any
  let mockForecast: any
  let mockWinLoss: any
  let mockProductivity: any

  // Named-field factory (not positional new) — AC 29 Trap T8
  function buildService(overrides: Record<string, any> = {}): WidgetDataService {
    return new WidgetDataService(
      overrides.prisma ?? mockPrisma,
      overrides.deals ?? mockDeals,
      overrides.dealStages ?? mockDealStages,
      overrides.dealHealth ?? mockDealHealth,
      overrides.tasks ?? mockTasks,
      overrides.activities ?? mockActivities,
      overrides.contacts ?? mockContacts,
      overrides.forecast ?? mockForecast,
      overrides.winLoss ?? mockWinLoss,
      overrides.productivity ?? mockProductivity,
    )
  }

  const tenantId = 't-1'
  const userId = 'u-1'
  const widgetId = 'w-1'
  const now = new Date('2026-08-12T12:00:00.000Z')

  const context = (
    opts: { report?: boolean; source?: boolean } = {},
  ): {
    requirePermission: jest.Mock
  } => ({
    requirePermission: jest.fn((resource: string) => {
      if (resource === 'REPORT' && opts.report === false) {
        throw new ForbiddenException('report denied')
      }
      if (resource !== 'REPORT' && opts.source === false) {
        throw new ForbiddenException('source denied')
      }
    }),
  })

  beforeEach(() => {
    jest.clearAllMocks()

    mockPrisma = {
      widget: {
        findFirst: jest.fn().mockResolvedValue({
          id: widgetId,
          type: 'METRIC_CARD',
          config: { source: 'TASK_STATS', dateRangeDays: 30 },
        }),
      },
    }
    mockDeals = { pipelineSummary: jest.fn().mockResolvedValue([]) }
    mockDealStages = { findMany: jest.fn().mockResolvedValue([]) }
    mockDealHealth = { findAtRisk: jest.fn().mockResolvedValue({ items: [], total: 0 }) }
    mockTasks = {
      findMany: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      getStats: jest
        .fn()
        .mockResolvedValue({ openTasks: 0, dueToday: 0, overdue: 0, completedThisWeek: 0 }),
    }
    mockActivities = { findFeed: jest.fn().mockResolvedValue({ items: [], total: 0 }) }
    mockContacts = {
      getStats: jest
        .fn()
        .mockResolvedValue({ total: 0, addedThisMonth: 0, withOpenDeals: 0, unassigned: 0 }),
    }
    mockForecast = {
      salesForecast: jest.fn().mockResolvedValue({ buckets: [], commit: { totalValue: 0 } }),
    }
    mockWinLoss = {
      winLossAnalysis: jest.fn().mockResolvedValue({ wonCount: 0, lostCount: 0, totalClosed: 0 }),
    }
    mockProductivity = {
      productivityReport: jest.fn().mockResolvedValue({ buckets: [], totalSeconds: 0 }),
    }

    service = buildService()
  })

  describe('widgetData — permission gates', () => {
    it('throws when REPORT:READ is denied (first gate)', async () => {
      await expect(
        service.widgetData(tenantId, userId, widgetId, context({ report: false }), now),
      ).rejects.toThrow(ForbiddenException)
    })

    it('returns permissionLimited when the source permission is denied (second gate)', async () => {
      const result = await service.widgetData(
        tenantId,
        userId,
        widgetId,
        context({ source: false }),
        now,
      )
      expect(result.permissionLimited).toBe(true)
      expect(result.metric).toBeNull()
      expect(result.series).toEqual([])
      expect(result.rows).toEqual([])
    })

    it('throws BadRequestException when the widget is not found', async () => {
      mockPrisma.widget.findFirst.mockResolvedValue(null)
      await expect(service.widgetData(tenantId, userId, widgetId, context(), now)).rejects.toThrow(
        BadRequestException,
      )
    })
  })

  describe('resolvePipeline', () => {
    beforeEach(() => {
      mockDeals.pipelineSummary.mockResolvedValue([
        { stageId: 's-1', totalValue: 1000, count: 2 },
        { stageId: 's-2', totalValue: 500, count: 1 },
      ])
      mockDealStages.findMany.mockResolvedValue([
        { id: 's-1', name: 'Qualify' },
        { id: 's-2', name: 'Proposal' },
      ])
    })

    it('PIPELINE_BY_STAGE returns a series with stage labels and totals', async () => {
      mockPrisma.widget.findFirst.mockResolvedValue({
        id: widgetId,
        type: 'BAR_CHART',
        config: { source: 'PIPELINE_BY_STAGE' },
      })
      const result = await service.widgetData(tenantId, userId, widgetId, context(), now)
      expect(result.series).toHaveLength(1)
      expect(result.series[0].points).toHaveLength(2)
      expect(result.series[0].points[0].label).toBe('Qualify')
      expect(result.total).toBe(1500)
    })

    it('PIPELINE_VALUE returns a metric with the summed value', async () => {
      mockPrisma.widget.findFirst.mockResolvedValue({
        id: widgetId,
        type: 'METRIC_CARD',
        config: { source: 'PIPELINE_VALUE' },
      })
      const result = await service.widgetData(tenantId, userId, widgetId, context(), now)
      expect(result.metric?.value).toBe(1500)
      expect(result.metric?.unit).toBe('USD')
    })
  })

  describe('resolveSalesForecast', () => {
    beforeEach(() => {
      mockForecast.salesForecast.mockResolvedValue({
        buckets: [
          { key: '2026-07', label: 'Jul', totalValue: 100, count: 1 },
          { key: '2026-08', label: 'Aug', totalValue: 200, count: 2 },
        ],
        commit: { totalValue: 300 },
      })
      mockPrisma.widget.findFirst.mockResolvedValue({
        id: widgetId,
        type: 'LINE_CHART',
        config: { source: 'SALES_FORECAST', dateRangeDays: 30 },
      })
    })

    it('returns series points from forecast buckets', async () => {
      const result = await service.widgetData(tenantId, userId, widgetId, context(), now)
      expect(result.series[0].points).toHaveLength(2)
      expect(result.total).toBe(300)
    })

    it('uses a non-violet series color (AC 61 — violet reserved for AI)', async () => {
      const result = await service.widgetData(tenantId, userId, widgetId, context(), now)
      expect(result.series[0].color).not.toMatch(/^(#8b5cf6|#a855f7|#7c3aed|#6d28d9)$/i)
    })

    it('throws when points exceed MAX_CHART_POINTS', async () => {
      mockForecast.salesForecast.mockResolvedValue({
        buckets: Array.from({ length: 30 }, (_, i) => ({
          key: `k-${i}`,
          label: `L${i}`,
          totalValue: i,
          count: 1,
        })),
        commit: { totalValue: 0 },
      })
      await expect(service.widgetData(tenantId, userId, widgetId, context(), now)).rejects.toThrow(
        BadRequestException,
      )
    })
  })

  describe('resolveWinLoss', () => {
    beforeEach(() => {
      mockWinLoss.winLossAnalysis.mockResolvedValue({
        wonCount: 3,
        lostCount: 2,
        totalClosed: 5,
      })
      mockPrisma.widget.findFirst.mockResolvedValue({
        id: widgetId,
        type: 'PIE_CHART',
        config: { source: 'WIN_LOSS' },
      })
    })

    it('returns won/lost points', async () => {
      const result = await service.widgetData(tenantId, userId, widgetId, context(), now)
      expect(result.series[0].points).toHaveLength(2)
      expect(result.total).toBe(5)
    })

    it('computes win rate as a percentage when type is METRIC_CARD', async () => {
      mockPrisma.widget.findFirst.mockResolvedValue({
        id: widgetId,
        type: 'METRIC_CARD',
        config: { source: 'WIN_LOSS' },
      })
      const result = await service.widgetData(tenantId, userId, widgetId, context(), now)
      expect(result.metric?.value).toBe(60)
      expect(result.metric?.unit).toBe('%')
    })

    it('returns win rate 0 when nothing is closed', async () => {
      mockPrisma.widget.findFirst.mockResolvedValue({
        id: widgetId,
        type: 'METRIC_CARD',
        config: { source: 'WIN_LOSS' },
      })
      mockWinLoss.winLossAnalysis.mockResolvedValue({ wonCount: 0, lostCount: 0, totalClosed: 0 })
      const result = await service.widgetData(tenantId, userId, widgetId, context(), now)
      expect(result.metric?.value).toBe(0)
    })
  })

  describe('resolveAtRiskDeals', () => {
    beforeEach(() => {
      mockDealHealth.findAtRisk.mockResolvedValue({
        items: [
          { deal: { id: 'deal-1', title: 'Big deal', healthStatus: 'AT_RISK' } },
          { deal: { id: 'deal-2', title: 'Healthy', healthStatus: 'HEALTHY' } },
          { deal: { id: 'deal-3', title: 'Unknown', healthStatus: null } },
          { deal: { id: 'deal-4', title: 'Critical', healthStatus: 'CRITICAL' } },
        ],
        total: 4,
      })
      mockPrisma.widget.findFirst.mockResolvedValue({
        id: widgetId,
        type: 'TABLE',
        config: { source: 'AT_RISK_DEALS' },
      })
    })

    it('maps health status to badge tones', async () => {
      const result = await service.widgetData(tenantId, userId, widgetId, context(), now)
      expect(result.rows).toHaveLength(4)
      expect(result.rows[0].badgeTone).toBe('WARNING')
      expect(result.rows[1].badgeTone).toBe('SUCCESS')
      expect(result.rows[2].badgeTone).toBeNull()
      expect(result.rows[3].badgeTone).toBe('DANGER')
      expect(result.rows[0].href).toBe('/deals/deal-1')
    })
  })

  describe('resolveMyTasks', () => {
    beforeEach(() => {
      mockTasks.findMany.mockResolvedValue({
        items: [
          { id: 'task-1', title: 'Call client', dueDate: '2026-08-13', priority: 'HIGH' },
          { id: 'task-2', title: 'Follow up', dueDate: null, priority: 'MEDIUM' },
          { id: 'task-3', title: 'Notes', dueDate: '2026-08-14', priority: 'LOW' },
        ],
        total: 3,
      })
      mockPrisma.widget.findFirst.mockResolvedValue({
        id: widgetId,
        type: 'TASK_LIST',
        config: { source: 'MY_TASKS' },
      })
    })

    it('maps task priority to badge tones', async () => {
      const result = await service.widgetData(tenantId, userId, widgetId, context(), now)
      expect(result.rows).toHaveLength(3)
      expect(result.rows[0].badgeTone).toBe('DANGER')
      expect(result.rows[1].badgeTone).toBe('WARNING')
      expect(result.rows[2].badgeTone).toBe('NEUTRAL')
    })

    it('filters to open statuses (TODO + IN_PROGRESS)', async () => {
      await service.widgetData(tenantId, userId, widgetId, context(), now)
      expect(mockTasks.findMany).toHaveBeenCalledWith(
        tenantId,
        userId,
        expect.objectContaining({ assignedTo: userId, statuses: ['TODO', 'IN_PROGRESS'] }),
        { page: 1, pageSize: 5 },
        { field: 'DUE_DATE', direction: 'ASC' },
      )
    })
  })

  describe('resolveTaskStats', () => {
    beforeEach(() => {
      mockTasks.getStats.mockResolvedValue({
        openTasks: 10,
        dueToday: 2,
        overdue: 3,
        completedThisWeek: 5,
      })
      mockPrisma.widget.findFirst.mockResolvedValue({
        id: widgetId,
        type: 'METRIC_CARD',
        config: { source: 'TASK_STATS' },
      })
    })

    it('returns open tasks metric with overdue trend', async () => {
      const result = await service.widgetData(tenantId, userId, widgetId, context(), now)
      expect(result.metric?.value).toBe(10)
      expect(result.metric?.trendPercent).toBe(3)
      expect(result.metric?.trendDirection).toBe('UP')
    })
  })

  describe('resolveRecentActivity', () => {
    beforeEach(() => {
      mockActivities.findFeed.mockResolvedValue({
        items: [
          { id: 'a-1', title: 'Deal updated', type: 'DEAL', createdAt: '2026-08-12' },
          { id: 'a-2', title: null, type: 'NOTE', createdAt: null },
        ],
        total: 2,
      })
      mockPrisma.widget.findFirst.mockResolvedValue({
        id: widgetId,
        type: 'ACTIVITY_FEED',
        config: { source: 'RECENT_ACTIVITY' },
      })
    })

    it('uses title or type as primary label', async () => {
      const result = await service.widgetData(tenantId, userId, widgetId, context(), now)
      expect(result.rows[0].primaryLabel).toBe('Deal updated')
      expect(result.rows[1].primaryLabel).toBe('NOTE')
    })
  })

  describe('resolveTimeTracked', () => {
    beforeEach(() => {
      mockProductivity.productivityReport.mockResolvedValue({
        buckets: [
          { bucketStart: '2026-08-10', totalSeconds: 7200 },
          { bucketStart: '2026-08-11', totalSeconds: 3600 },
        ],
        totalSeconds: 10800,
      })
      mockPrisma.widget.findFirst.mockResolvedValue({
        id: widgetId,
        type: 'BAR_CHART',
        config: { source: 'TIME_TRACKED' },
      })
    })

    it('converts seconds to hours in the series', async () => {
      const result = await service.widgetData(tenantId, userId, widgetId, context(), now)
      expect(result.series[0].points[0].value).toBe(2) // 7200s = 2h
      expect(result.total).toBe(10800)
    })

    it('buckets by WEEK so the 30-day default stays under MAX_CHART_POINTS', async () => {
      await service.widgetData(tenantId, userId, widgetId, context(), now)
      expect(mockProductivity.productivityReport).toHaveBeenCalledWith(
        tenantId,
        userId,
        expect.objectContaining({ bucket: 'WEEK' }),
      )
    })

    it('returns metric with hours for METRIC_CARD', async () => {
      mockPrisma.widget.findFirst.mockResolvedValue({
        id: widgetId,
        type: 'METRIC_CARD',
        config: { source: 'TIME_TRACKED' },
      })
      const result = await service.widgetData(tenantId, userId, widgetId, context(), now)
      expect(result.metric?.value).toBe(3) // 10800s = 3h
      expect(result.metric?.unit).toBe('hrs')
    })
  })

  describe('resolveContactCount', () => {
    beforeEach(() => {
      mockContacts.getStats.mockResolvedValue({
        total: 42,
        addedThisMonth: 7,
        withOpenDeals: 3,
        unassigned: 0,
      })
      mockPrisma.widget.findFirst.mockResolvedValue({
        id: widgetId,
        type: 'METRIC_CARD',
        config: { source: 'CONTACT_COUNT' },
      })
    })

    it('returns contact total with added-this-month trend', async () => {
      const result = await service.widgetData(tenantId, userId, widgetId, context(), now)
      expect(result.metric?.value).toBe(42)
      expect(result.metric?.trendPercent).toBe(7)
      expect(result.metric?.trendDirection).toBe('UP')
    })
  })
})
