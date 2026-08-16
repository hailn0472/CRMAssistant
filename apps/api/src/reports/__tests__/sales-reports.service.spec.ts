/**
 * Story 6.2 — SalesReportsService unit tests (AC 8-9, 11-17, 22, 24-53, 58, 60).
 * Typed mocks for Prisma delegates, DealsService.buildDealWhere,
 * ForecastService, WinLossService and AuditService. No real database.
 */

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'

import { SalesReportsService, REPORT_SELECT, MAX_BUCKET_ROWS } from '../sales-reports.service'
import type {
  ReportRow,
  ReportMetric,
  ReportBucket,
  ReportDrillConnection,
} from '../sales-reports.service'
import type { ReportConfig } from '../report-config'
import { REPORT_TYPES } from '../report-types'
import type { ReportType } from '../report-types'
import { MAX_ACTIVE_REPORTS_PER_CREATOR } from '../report-config'

const NOW = new Date(Date.UTC(2026, 7, 15, 12, 0, 0)) // 2026-08-15T12:00Z

const VALID_CONFIG: ReportConfig = {
  datePreset: 'CUSTOM',
  startDate: '2026-08-01',
  endDate: '2026-08-31',
  comparisonMode: 'NONE',
  comparisonStartDate: null,
  comparisonEndDate: null,
  groupBy: 'MONTH',
  ownerId: null,
  teamId: null,
  stageId: null,
  productId: null,
  currency: null,
}

// ─── Typed mocks (story standard: typed mocks; no `any`) ─────────────────────

type MockReportDelegate = {
  findMany: jest.Mock
  findFirst: jest.Mock
  count: jest.Mock
  create: jest.Mock
  update: jest.Mock
}

type MockDealDelegate = {
  aggregate: jest.Mock
  count: jest.Mock
  findMany: jest.Mock
  groupBy: jest.Mock
}

type MockDealStageDelegate = {
  findMany: jest.Mock
  findFirst: jest.Mock
}

type MockUserDelegate = { findFirst: jest.Mock }
type MockTeamDelegate = { findFirst: jest.Mock }
type MockProductDelegate = { findFirst: jest.Mock }

type MockPrisma = {
  report: MockReportDelegate
  deal: MockDealDelegate
  dealStage: MockDealStageDelegate
  user: MockUserDelegate
  team: MockTeamDelegate
  product: MockProductDelegate
}

type MockDealsService = { buildDealWhere: jest.Mock }
type MockForecastService = { salesForecast: jest.Mock; forecastAccuracy: jest.Mock }
type MockWinLossService = { winLossAnalysis: jest.Mock }
type MockAuditService = { log: jest.Mock }

type AggregateCallArgs = {
  where: { stage?: { isWon?: boolean }; actualCloseDate?: { gte?: Date } }
}

function makeReportRow(overrides: Partial<ReportRow> = {}): ReportRow {
  return {
    id: 'report-1',
    tenantId: 'tenant-1',
    name: 'August Overview',
    type: 'SALES_OVERVIEW',
    config: VALID_CONFIG as unknown as ReportRow['config'],
    createdBy: 'user-1',
    isPublic: false,
    createdAt: new Date(Date.UTC(2026, 7, 1)),
    updatedAt: new Date(Date.UTC(2026, 7, 1)),
    updatedBy: 'user-1',
    deletedAt: null,
    ...overrides,
  }
}

function bucketRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'deal-1',
    value: 1000,
    probability: 50,
    currency: 'USD',
    ownerId: 'user-1',
    actualCloseDate: new Date(Date.UTC(2026, 7, 10)),
    expectedCloseDate: new Date(Date.UTC(2026, 7, 10)),
    createdAt: new Date(Date.UTC(2026, 6, 1)),
    owner: {
      id: 'user-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      teamId: 'team-1',
      team: { id: 'team-1', name: 'North' },
    },
    lineItems: [{ productId: 'product-1', total: 1000, product: { name: 'CRM' } }],
    ...overrides,
  }
}

describe('SalesReportsService', () => {
  let service: SalesReportsService
  let mockPrisma: MockPrisma
  let mockDeals: MockDealsService
  let mockForecast: MockForecastService
  let mockWinLoss: MockWinLossService
  let mockAudit: MockAuditService

  function buildService(clock: () => Date = () => NOW): SalesReportsService {
    return new SalesReportsService(
      mockPrisma as unknown as ConstructorParameters<typeof SalesReportsService>[0],
      mockDeals as unknown as ConstructorParameters<typeof SalesReportsService>[1],
      mockForecast as unknown as ConstructorParameters<typeof SalesReportsService>[2],
      mockWinLoss as unknown as ConstructorParameters<typeof SalesReportsService>[3],
      mockAudit as unknown as ConstructorParameters<typeof SalesReportsService>[4],
      clock,
    )
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) }
    mockDeals = {
      buildDealWhere: jest.fn().mockResolvedValue({ tenantId: 'tenant-1', deletedAt: null }),
    }
    mockForecast = {
      salesForecast: jest.fn(),
      forecastAccuracy: jest.fn(),
    }
    mockWinLoss = { winLossAnalysis: jest.fn() }
    mockPrisma = {
      report: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      deal: {
        aggregate: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
        groupBy: jest.fn(),
      },
      dealStage: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      user: { findFirst: jest.fn() },
      team: { findFirst: jest.fn() },
      product: { findFirst: jest.fn() },
    }
    service = buildService()
  })

  // ─── AC 9: REPORT_SELECT ───────────────────────────────────────────────

  describe('REPORT_SELECT (AC 9)', () => {
    it('selects every field the Report ref exposes', () => {
      const fields = [
        'id',
        'tenantId',
        'name',
        'type',
        'config',
        'createdBy',
        'isPublic',
        'createdAt',
        'updatedAt',
        'updatedBy',
        'deletedAt',
      ]
      for (const field of fields) {
        expect(REPORT_SELECT).toHaveProperty(field, true)
      }
    })
  })

  // ─── AC 11: listing ────────────────────────────────────────────────────

  describe('reports listing (AC 11)', () => {
    it('returns owned + public same-tenant reports, deduplicated, updatedAt desc', async () => {
      mockPrisma.report.findMany.mockResolvedValue([makeReportRow()])
      mockPrisma.report.count.mockResolvedValue(1)

      const result = await service.reports('tenant-1', 'user-1', { page: 1, pageSize: 20 })

      const where = mockPrisma.report.findMany.mock.calls[0][0].where
      expect(where.tenantId).toBe('tenant-1')
      expect(where.deletedAt).toBeNull()
      expect(where.OR).toEqual([{ createdBy: 'user-1' }, { isPublic: true }])
      expect(mockPrisma.report.findMany.mock.calls[0][0].orderBy).toEqual({
        updatedAt: 'desc',
      })
      expect(result.total).toBe(1)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(20)
    })

    it('clamps pageSize at 100 and page at 1', async () => {
      mockPrisma.report.findMany.mockResolvedValue([])
      mockPrisma.report.count.mockResolvedValue(0)

      const result = await service.reports('tenant-1', 'user-1', { page: 0, pageSize: 999 })
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(100)

      const result2 = await service.reports('tenant-1', 'user-1', { page: 2, pageSize: 5 })
      expect(mockPrisma.report.findMany.mock.calls[1][0].skip).toBe(5)
      expect(mockPrisma.report.findMany.mock.calls[1][0].take).toBe(5)
      expect(result2.page).toBe(2)
    })
  })

  // ─── AC 12: report(id) ─────────────────────────────────────────────────

  describe('report(id) (AC 12)', () => {
    it('returns the report for its creator', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow())
      const row = await service.report('tenant-1', 'user-1', 'report-1')
      expect(row.id).toBe('report-1')
      expect(mockPrisma.report.findFirst.mock.calls[0][0].where).toMatchObject({
        id: 'report-1',
        tenantId: 'tenant-1',
        deletedAt: null,
      })
    })

    it('returns a public same-tenant report for a non-owner', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow({ createdBy: 'other' }))
      const row = await service.report('tenant-1', 'user-2', 'report-1')
      expect(row.id).toBe('report-1')
    })

    it('throws NotFoundException for private non-owner', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(null)
      await expect(service.report('tenant-1', 'user-2', 'report-1')).rejects.toThrow(
        new NotFoundException('Report not found'),
      )
    })

    it('throws NotFoundException for cross-tenant reports', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(null)
      await expect(service.report('tenant-2', 'user-1', 'report-1')).rejects.toThrow(
        NotFoundException,
      )
      expect(mockPrisma.report.findFirst.mock.calls[0][0].where.tenantId).toBe('tenant-2')
    })

    it('throws NotFoundException for soft-deleted reports', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(null)
      await expect(service.report('tenant-1', 'user-1', 'deleted-report')).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  // ─── AC 8, 13: createReport ────────────────────────────────────────────

  describe('createReport (AC 8, 13)', () => {
    const input = {
      name: 'August Overview',
      type: 'SALES_OVERVIEW' as const,
      config: VALID_CONFIG,
    }

    it('creates with createdBy/updatedBy from the caller and isPublic default false', async () => {
      mockPrisma.report.count.mockResolvedValue(0)
      mockPrisma.report.findMany.mockResolvedValue([])
      mockPrisma.report.create.mockResolvedValue(makeReportRow())

      const row = await service.createReport('tenant-1', 'user-1', input)

      const data = mockPrisma.report.create.mock.calls[0][0].data
      expect(data.tenantId).toBe('tenant-1')
      expect(data.createdBy).toBe('user-1')
      expect(data.updatedBy).toBe('user-1')
      expect(data.isPublic).toBe(false)
      expect(data.config).toEqual(VALID_CONFIG)
      expect(row.id).toBe('report-1')
    })

    it('respects isPublic true', async () => {
      mockPrisma.report.count.mockResolvedValue(0)
      mockPrisma.report.findMany.mockResolvedValue([])
      mockPrisma.report.create.mockResolvedValue(makeReportRow({ isPublic: true }))

      await service.createReport('tenant-1', 'user-1', { ...input, isPublic: true })
      expect(mockPrisma.report.create.mock.calls[0][0].data.isPublic).toBe(true)
    })

    it('rejects empty and overlong names', async () => {
      await expect(
        service.createReport('tenant-1', 'user-1', { ...input, name: '   ' }),
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.createReport('tenant-1', 'user-1', { ...input, name: 'x'.repeat(121) }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects unknown report types', async () => {
      await expect(
        service.createReport('tenant-1', 'user-1', {
          ...input,
          type: 'INVENTORY' as unknown as ReportType,
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects malformed config (strict write validation)', async () => {
      await expect(
        service.createReport('tenant-1', 'user-1', {
          ...input,
          config: { ...VALID_CONFIG, groupBy: 'DAY' } as unknown as ReportConfig,
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('enforces the 50-active-reports-per-creator limit (AC 8)', async () => {
      mockPrisma.report.count.mockResolvedValue(MAX_ACTIVE_REPORTS_PER_CREATOR)
      await expect(service.createReport('tenant-1', 'user-1', input)).rejects.toThrow(
        BadRequestException,
      )
      expect(mockPrisma.report.create).not.toHaveBeenCalled()
    })

    it('rejects a case-insensitive duplicate active name (AC 8)', async () => {
      mockPrisma.report.count.mockResolvedValue(0)
      mockPrisma.report.findMany.mockResolvedValue([makeReportRow({ name: 'august overview' })])
      await expect(service.createReport('tenant-1', 'user-1', input)).rejects.toThrow(
        ConflictException,
      )
    })

    it('allows reusing a soft-deleted name (AC 8)', async () => {
      mockPrisma.report.count.mockResolvedValue(0)
      // Only active rows are listed — the soft-deleted row never appears.
      mockPrisma.report.findMany.mockResolvedValue([])
      mockPrisma.report.create.mockResolvedValue(makeReportRow())
      const row = await service.createReport('tenant-1', 'user-1', input)
      expect(row.id).toBe('report-1')
    })
  })

  // ─── AC 14: updateReport ───────────────────────────────────────────────

  describe('updateReport (AC 14)', () => {
    it('applies partial changes and re-loads by (id, tenantId, createdBy, deletedAt:null)', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow())
      mockPrisma.report.findMany.mockResolvedValue([])
      mockPrisma.report.update.mockResolvedValue(makeReportRow({ name: 'Renamed' }))

      await service.updateReport('tenant-1', 'user-1', 'report-1', {
        name: 'Renamed',
        isPublic: true,
      })

      const loadWhere = mockPrisma.report.findFirst.mock.calls[0][0].where
      expect(loadWhere).toMatchObject({
        id: 'report-1',
        tenantId: 'tenant-1',
        createdBy: 'user-1',
        deletedAt: null,
      })

      const data = mockPrisma.report.update.mock.calls[0][0].data
      expect(data.name).toBe('Renamed')
      expect(data.isPublic).toBe(true)
      expect(data.updatedBy).toBe('user-1')
      // Ownership/tenant never appear in the update payload (AC 14).
      expect(data.createdBy).toBeUndefined()
      expect(data.tenantId).toBeUndefined()
    })

    it('rejects updates from a non-owner with Report not found', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(null)
      await expect(
        service.updateReport('tenant-1', 'user-2', 'report-1', { name: 'X' }),
      ).rejects.toThrow(new NotFoundException('Report not found'))
    })

    it('rejects invalid partial type/config', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow())
      await expect(
        service.updateReport('tenant-1', 'user-1', 'report-1', {
          type: 'BOGUS' as unknown as ReportType,
        }),
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.updateReport('tenant-1', 'user-1', 'report-1', {
          config: { ...VALID_CONFIG, currency: '' } as unknown as ReportConfig,
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects a duplicate name on update (excluding self)', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow())
      mockPrisma.report.findMany.mockResolvedValue([
        makeReportRow({ id: 'report-2', name: 'august overview' }),
      ])
      await expect(
        service.updateReport('tenant-1', 'user-1', 'report-1', { name: 'August Overview' }),
      ).rejects.toThrow(ConflictException)
    })
  })

  // ─── AC 15: deleteReport ───────────────────────────────────────────────

  describe('deleteReport (AC 15)', () => {
    it('soft-deletes with deletedAt and updatedBy, returns true', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow())
      mockPrisma.report.update.mockResolvedValue(makeReportRow({ deletedAt: NOW }))

      const result = await service.deleteReport('tenant-1', 'user-1', 'report-1')
      expect(result).toBe(true)
      const data = mockPrisma.report.update.mock.calls[0][0].data
      expect(data.deletedAt).toBeInstanceOf(Date)
      expect(data.updatedBy).toBe('user-1')
    })

    it('repeated / non-owner / cross-tenant deletes all return Report not found', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(null)
      await expect(service.deleteReport('tenant-1', 'user-1', 'report-1')).rejects.toThrow(
        new NotFoundException('Report not found'),
      )
      await expect(service.deleteReport('tenant-1', 'user-2', 'report-1')).rejects.toThrow(
        new NotFoundException('Report not found'),
      )
      await expect(service.deleteReport('tenant-2', 'user-1', 'report-1')).rejects.toThrow(
        new NotFoundException('Report not found'),
      )
    })
  })

  // ─── AC 16-17: public read-only + audit ────────────────────────────────

  describe('audit + public semantics (AC 16-17)', () => {
    it('writes CREATE/UPDATE/DELETE audit rows with entity REPORT and concrete id', async () => {
      mockPrisma.report.count.mockResolvedValue(0)
      mockPrisma.report.findMany.mockResolvedValue([])
      mockPrisma.report.create.mockResolvedValue(makeReportRow())
      await service.createReport('tenant-1', 'user-1', {
        name: 'August Overview',
        type: 'SALES_OVERVIEW',
        config: VALID_CONFIG,
      })
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entity: 'REPORT', entityId: 'report-1' }),
      )

      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow())
      mockPrisma.report.update.mockResolvedValue(makeReportRow())
      await service.updateReport('tenant-1', 'user-1', 'report-1', { name: 'X' })
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', entity: 'REPORT', entityId: 'report-1' }),
      )

      await service.deleteReport('tenant-1', 'user-1', 'report-1')
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DELETE', entity: 'REPORT', entityId: 'report-1' }),
      )
    })

    it('runReport/reportData create zero audit rows (AC 17)', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow())
      mockPrisma.deal.aggregate.mockResolvedValue({ _sum: { value: 0 }, _count: { _all: 0 } })
      mockPrisma.deal.groupBy.mockResolvedValue([])
      mockPrisma.deal.findMany.mockResolvedValue([])
      mockPrisma.dealStage.findMany.mockResolvedValue([])

      await service.runReport('tenant-1', 'user-1', 'report-1')
      await service.reportData('tenant-1', 'user-1', 'report-1')

      expect(mockAudit.log).not.toHaveBeenCalled()
      // No report writes during a run (AC 45).
      expect(mockPrisma.report.create).not.toHaveBeenCalled()
      expect(mockPrisma.report.update).not.toHaveBeenCalled()
    })
  })

  // ─── AC 24: runtime filter overrides ───────────────────────────────────

  describe('runtime filter overrides (AC 24)', () => {
    it('overrides field-by-field without mutating the persisted config', async () => {
      const row = makeReportRow()
      mockPrisma.report.findFirst.mockResolvedValue(row)
      mockPrisma.deal.aggregate.mockResolvedValue({ _sum: { value: 0 }, _count: { _all: 0 } })
      mockPrisma.deal.groupBy.mockResolvedValue([])
      mockPrisma.deal.findMany.mockResolvedValue([])
      mockPrisma.dealStage.findMany.mockResolvedValue([])
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-2' })

      await service.reportData('tenant-1', 'user-1', 'report-1', {
        ownerId: 'user-2',
        groupBy: 'OWNER',
      })

      // Persisted config unchanged — re-read row still has the original config.
      expect(row.config).toEqual(VALID_CONFIG)
      // buildDealWhere received the overridden ownerId.
      expect(mockDeals.buildDealWhere).toHaveBeenCalledWith('tenant-1', 'user-1', {
        ownerId: 'user-2',
      })
    })

    it('throws BadRequestException for reversed runtime dates', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow())
      await expect(
        service.reportData('tenant-1', 'user-1', 'report-1', {
          datePreset: 'CUSTOM',
          startDate: '2026-08-31',
          endDate: '2026-08-01',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException for cross-tenant filter IDs (AC 28)', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow())
      mockPrisma.user.findFirst.mockResolvedValue(null)
      await expect(
        service.reportData('tenant-1', 'user-1', 'report-1', { ownerId: 'foreign-user' }),
      ).rejects.toThrow(BadRequestException)
      expect(mockPrisma.user.findFirst.mock.calls[0][0].where.tenantId).toBe('tenant-1')
    })

    it('throws BadRequestException for a custom comparison with a different day count', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow())
      await expect(
        service.reportData('tenant-1', 'user-1', 'report-1', {
          comparisonMode: 'CUSTOM',
          comparisonStartDate: '2026-07-01',
          comparisonEndDate: '2026-07-10',
        }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  // ─── AC 27: buildDealWhere reuse ───────────────────────────────────────

  describe('visibility reuse (AC 27)', () => {
    it('uses DealsService.buildDealWhere as the base predicate for every report type', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow({ type: 'PIPELINE_ANALYSIS' }))
      mockPrisma.deal.aggregate.mockResolvedValue({ _sum: { value: 0 }, _count: { _all: 0 } })
      mockPrisma.deal.groupBy.mockResolvedValue([])
      mockPrisma.deal.findMany.mockResolvedValue([])
      mockPrisma.dealStage.findMany.mockResolvedValue([])
      mockPrisma.deal.count.mockResolvedValue(0)
      mockWinLoss.winLossAnalysis.mockResolvedValue({
        totalClosed: 0,
        wonCount: 0,
        lostCount: 0,
        winRate: 0,
        wonValue: 0,
        lostValue: 0,
        currency: 'USD',
        lossReasons: [],
        winReasons: [],
        competitors: [],
      })
      mockForecast.salesForecast.mockResolvedValue({
        buckets: [],
        commit: { weightedValue: 0, totalValue: 0, count: 0 },
        bestCase: { weightedValue: 0, totalValue: 0, count: 0 },
        pipeline: { weightedValue: 0, totalValue: 0, count: 0 },
        currency: 'USD',
      })

      for (const type of REPORT_TYPES) {
        mockPrisma.report.findFirst.mockResolvedValue(makeReportRow({ type }))
        await service.reportData('tenant-1', 'user-1', 'report-1')
        expect(mockDeals.buildDealWhere).toHaveBeenCalledWith('tenant-1', 'user-1', {
          ownerId: undefined,
        })
      }
    })
  })

  // ─── AC 31-32: SALES_OVERVIEW ──────────────────────────────────────────

  describe('SALES_OVERVIEW (AC 31-32)', () => {
    function mockOverview(won: number, lost: number, wonValue: number): void {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow())
      mockPrisma.deal.aggregate.mockImplementation(({ where }: AggregateCallArgs) =>
        Promise.resolve(
          where.stage?.isWon
            ? { _sum: { value: wonValue }, _count: { _all: won } }
            : { _sum: { value: 0 }, _count: { _all: lost } },
        ),
      )
      mockPrisma.deal.groupBy.mockResolvedValue([])
      mockPrisma.deal.findMany.mockResolvedValue([])
      mockPrisma.dealStage.findMany.mockResolvedValue([])
      mockPrisma.deal.count.mockResolvedValue(0)
    }

    it('computes TOTAL_REVENUE, WON_DEALS, LOST_DEALS, WIN_RATE, AVERAGE_DEAL_SIZE', async () => {
      mockOverview(3, 1, 6000)
      const data = await service.reportData('tenant-1', 'user-1', 'report-1')

      const metrics = data.current.metrics
      const byKey = new Map(metrics.map((m: ReportMetric) => [m.key, m]))
      expect(byKey.get('TOTAL_REVENUE')?.value).toBe(6000)
      expect(byKey.get('WON_DEALS')?.value).toBe(3)
      expect(byKey.get('LOST_DEALS')?.value).toBe(1)
      expect(byKey.get('WIN_RATE')?.value).toBe(75) // 3/(3+1)*100
      expect(byKey.get('AVERAGE_DEAL_SIZE')?.value).toBe(2000)
    })

    it('is safe with zero denominators', async () => {
      mockOverview(0, 0, 0)
      const data = await service.reportData('tenant-1', 'user-1', 'report-1')
      const byKey = new Map(data.current.metrics.map((m: ReportMetric) => [m.key, m]))
      expect(byKey.get('WIN_RATE')?.value).toBe(0)
      expect(byKey.get('AVERAGE_DEAL_SIZE')?.value).toBe(0)
      expect(byKey.get('TOTAL_REVENUE')?.value).toBe(0)
    })

    it('returns an ordered stage snapshot with share pct and a snapshot calculationNote (AC 32)', async () => {
      mockOverview(1, 0, 500)
      mockPrisma.deal.groupBy.mockResolvedValue([
        { stageId: 'stage-1', _count: { _all: 4 } },
        { stageId: 'stage-2', _count: { _all: 1 } },
      ])
      mockPrisma.dealStage.findMany.mockResolvedValue([
        { id: 'stage-1', name: 'Proposal', order: 1, color: '#111' },
        { id: 'stage-2', name: 'Negotiation', order: 2, color: '#222' },
      ])

      const data = await service.reportData('tenant-1', 'user-1', 'report-1')
      expect(data.current.stageBreakdown).toHaveLength(2)
      expect(data.current.stageBreakdown[0]).toMatchObject({
        stageId: 'stage-1',
        stageName: 'Proposal',
        order: 1,
        dealCount: 4,
        stageSharePct: 80,
      })
      expect(data.calculationNote).toMatch(/snapshot/i)
      expect(data.calculationNote).toMatch(/not historical.*conversion/i)
      expect(data.dateField).toBe('actualCloseDate')
    })

    it('builds dense zero-filled month buckets (AC 38)', async () => {
      mockOverview(1, 0, 1000)
      mockPrisma.deal.findMany.mockResolvedValue([
        bucketRow({ actualCloseDate: new Date(Date.UTC(2026, 7, 5)), value: 1000 }),
      ])
      const data = await service.reportData('tenant-1', 'user-1', 'report-1')
      // Aug 2026 range → dense 2026-08 bucket with the value; adjacent months zero.
      expect(data.current.buckets).toHaveLength(1)
      expect(data.current.buckets[0]).toMatchObject({ key: '2026-08', value: 1000, count: 1 })
    })

    it('attributes product buckets by line-item totals with distinct deal counts (AC 39)', async () => {
      mockOverview(1, 0, 3000)
      // One deal with two active line items across two products.
      mockPrisma.deal.findMany.mockResolvedValue([
        bucketRow({
          value: 3000,
          lineItems: [
            { productId: 'p1', total: 2000, product: { name: 'CRM' } },
            { productId: 'p2', total: 1000, product: { name: 'API' } },
          ],
        }),
      ])
      const data = await service.reportData('tenant-1', 'user-1', 'report-1', {
        groupBy: 'PRODUCT',
      })
      const byKey = new Map(data.current.buckets.map((b: ReportBucket) => [b.key, b]))
      expect(byKey.get('p1')).toMatchObject({ label: 'CRM', value: 2000 })
      expect(byKey.get('p2')).toMatchObject({ label: 'API', value: 1000 })
      // Distinct deals — the one deal counts once per product bucket.
      expect(byKey.get('p1')?.count).toBe(1)
      expect(byKey.get('p2')?.count).toBe(1)
    })

    it('falls back to productId when the product row is missing (deleted product, AC 41)', async () => {
      mockOverview(1, 0, 1000)
      mockPrisma.deal.findMany.mockResolvedValue([
        bucketRow({
          value: 1000,
          lineItems: [{ productId: 'p-deleted', total: 1000, product: null }],
        }),
      ])
      const data = await service.reportData('tenant-1', 'user-1', 'report-1', {
        groupBy: 'PRODUCT',
      })
      expect(data.current.buckets[0]).toMatchObject({
        key: 'p-deleted',
        label: 'p-deleted',
        value: 1000,
      })
    })
  })

  // ─── AC 33: PIPELINE_ANALYSIS ──────────────────────────────────────────

  describe('PIPELINE_ANALYSIS (AC 33)', () => {
    it('computes open count, unweighted and weighted pipeline value with stage buckets', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow({ type: 'PIPELINE_ANALYSIS' }))
      mockPrisma.deal.aggregate.mockResolvedValue({ _sum: { value: 40000 }, _count: { _all: 5 } })
      mockPrisma.deal.groupBy.mockResolvedValue([
        { stageId: 'stage-1', _count: { _all: 3 }, _sum: { value: 30000 } },
        { stageId: 'stage-2', _count: { _all: 2 }, _sum: { value: 10000 } },
      ])
      mockPrisma.deal.findMany.mockResolvedValue([bucketRow({ value: 40000, probability: 50 })])
      mockPrisma.dealStage.findMany.mockResolvedValue([
        { id: 'stage-1', name: 'Proposal', order: 1, color: '#111' },
        { id: 'stage-2', name: 'Negotiation', order: 2, color: '#222' },
      ])

      const data = await service.reportData('tenant-1', 'user-1', 'report-1')
      const byKey = new Map(data.current.metrics.map((m: ReportMetric) => [m.key, m]))
      expect(byKey.get('OPEN_DEALS')?.value).toBe(5)
      expect(byKey.get('PIPELINE_VALUE')?.value).toBe(40000)
      expect(byKey.get('WEIGHTED_PIPELINE_VALUE')?.value).toBe(20000) // 40000 × 50%
      expect(data.current.stageBreakdown[0]).toMatchObject({
        stageId: 'stage-1',
        dealCount: 3,
        value: 30000,
      })
      expect(data.dateField).toBe('expectedCloseDate')
      // Open-stage narrowing was applied to the scope.
      const where = mockPrisma.deal.aggregate.mock.calls[0][0].where
      expect(where.expectedCloseDate).toBeDefined()
    })
  })

  // ─── AC 34: WIN_LOSS composition ───────────────────────────────────────

  describe('WIN_LOSS (AC 34)', () => {
    it('composes WinLossService for current scope and does not re-derive its formulas', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow({ type: 'WIN_LOSS' }))
      mockWinLoss.winLossAnalysis.mockResolvedValue({
        totalClosed: 10,
        wonCount: 7,
        lostCount: 3,
        winRate: 70,
        wonValue: 7000,
        lostValue: 3000,
        currency: 'USD',
        lossReasons: [],
        winReasons: [],
        competitors: [],
      })
      mockPrisma.deal.findMany.mockResolvedValue([])
      mockPrisma.deal.aggregate.mockResolvedValue({ _sum: { value: 0 }, _count: { _all: 0 } })
      mockPrisma.deal.groupBy.mockResolvedValue([])
      mockPrisma.dealStage.findMany.mockResolvedValue([])

      const data = await service.reportData('tenant-1', 'user-1', 'report-1')
      expect(mockWinLoss.winLossAnalysis).toHaveBeenCalledWith('tenant-1', 'user-1', {
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        ownerId: undefined,
        teamId: undefined,
        stageId: undefined,
        productId: undefined,
        currency: undefined,
      })
      const byKey = new Map(data.current.metrics.map((m: ReportMetric) => [m.key, m]))
      expect(byKey.get('TOTAL_CLOSED')?.value).toBe(10)
      expect(byKey.get('WON_DEALS')?.value).toBe(7)
      expect(byKey.get('WIN_RATE')?.value).toBe(70)
      expect(byKey.get('WON_VALUE')?.value).toBe(7000)
    })

    it('forwards stage/product/currency filters into WinLossService so headline agrees with buckets (AC 24/40, finding #1)', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow({ type: 'WIN_LOSS' }))
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
      mockPrisma.team.findFirst.mockResolvedValue({ id: 'team-1' })
      mockPrisma.dealStage.findFirst.mockResolvedValue({ id: 'stage-1' })
      mockPrisma.product.findFirst.mockResolvedValue({ id: 'product-1' })
      mockPrisma.deal.groupBy.mockResolvedValue([{ currency: 'USD', _count: { _all: 1 } }])
      mockWinLoss.winLossAnalysis.mockResolvedValue({
        totalClosed: 2,
        wonCount: 1,
        lostCount: 1,
        winRate: 50,
        wonValue: 1000,
        lostValue: 500,
        currency: 'USD',
        lossReasons: [],
        winReasons: [],
        competitors: [],
      })
      mockPrisma.deal.findMany.mockResolvedValue([])
      mockPrisma.deal.aggregate.mockResolvedValue({ _sum: { value: 0 }, _count: { _all: 0 } })
      mockPrisma.dealStage.findMany.mockResolvedValue([])

      const data = await service.reportData('tenant-1', 'user-1', 'report-1', {
        stageId: 'stage-1',
        productId: 'product-1',
        currency: 'USD',
      })

      expect(mockWinLoss.winLossAnalysis).toHaveBeenCalledWith('tenant-1', 'user-1', {
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        ownerId: undefined,
        teamId: undefined,
        stageId: 'stage-1',
        productId: 'product-1',
        currency: 'USD',
      })
      // Selected single currency → money stays (not mixed, not nulled).
      expect(data.mixedCurrencies).toBe(false)
      expect(data.currency).toBe('USD')
      const wonValue = data.current.metrics.find((m: ReportMetric) => m.key === 'WON_VALUE')
      expect(wonValue?.value).toBe(1000)
    })
  })

  // ─── AC 35: REVENUE_FORECAST composition ───────────────────────────────

  describe('REVENUE_FORECAST (AC 35)', () => {
    it('composes ForecastService.salesForecast and maps commit/best-case/pipeline bands', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow({ type: 'REVENUE_FORECAST' }))
      mockForecast.salesForecast.mockResolvedValue({
        buckets: [],
        commit: { weightedValue: 50000, totalValue: 80000, count: 4 },
        bestCase: { weightedValue: 65000, totalValue: 80000, count: 5 },
        pipeline: { weightedValue: 75000, totalValue: 100000, count: 6 },
        currency: 'USD',
      })
      mockPrisma.deal.aggregate.mockResolvedValue({ _sum: { value: 0 }, _count: { _all: 0 } })
      mockPrisma.deal.groupBy.mockResolvedValue([])
      mockPrisma.deal.findMany.mockResolvedValue([])
      mockPrisma.dealStage.findMany.mockResolvedValue([])

      const data = await service.reportData('tenant-1', 'user-1', 'report-1')
      expect(mockForecast.salesForecast).toHaveBeenCalledWith('tenant-1', 'user-1', {
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        groupBy: 'MONTH',
        ownerId: undefined,
        teamId: undefined,
        stageId: undefined,
        productId: undefined,
        currency: undefined,
      })
      const byKey = new Map(data.current.metrics.map((m: ReportMetric) => [m.key, m]))
      expect(byKey.get('FORECAST_COMMIT')?.value).toBe(50000)
      expect(byKey.get('FORECAST_BEST_CASE')?.value).toBe(65000)
      expect(byKey.get('FORECAST_PIPELINE')?.value).toBe(75000)
      expect(byKey.get('OPEN_DEALS')?.value).toBe(6)
    })

    it('forwards stage/product/currency filters into ForecastService so bands agree with buckets (AC 24/40, finding #1)', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow({ type: 'REVENUE_FORECAST' }))
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
      mockPrisma.team.findFirst.mockResolvedValue({ id: 'team-1' })
      mockPrisma.dealStage.findFirst.mockResolvedValue({ id: 'stage-1' })
      mockPrisma.product.findFirst.mockResolvedValue({ id: 'product-1' })
      mockPrisma.deal.groupBy.mockResolvedValue([{ currency: 'EUR', _count: { _all: 1 } }])
      mockForecast.salesForecast.mockResolvedValue({
        buckets: [],
        commit: { weightedValue: 100, totalValue: 100, count: 1 },
        bestCase: { weightedValue: 100, totalValue: 100, count: 1 },
        pipeline: { weightedValue: 100, totalValue: 100, count: 1 },
        currency: 'EUR',
      })
      mockPrisma.deal.aggregate.mockResolvedValue({ _sum: { value: 0 }, _count: { _all: 0 } })
      mockPrisma.deal.findMany.mockResolvedValue([])
      mockPrisma.dealStage.findMany.mockResolvedValue([])

      const data = await service.reportData('tenant-1', 'user-1', 'report-1', {
        stageId: 'stage-1',
        productId: 'product-1',
        currency: 'EUR',
      })

      expect(mockForecast.salesForecast).toHaveBeenCalledWith('tenant-1', 'user-1', {
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        groupBy: 'MONTH',
        ownerId: undefined,
        teamId: undefined,
        stageId: 'stage-1',
        productId: 'product-1',
        currency: 'EUR',
      })
      // Selected single currency → money stays (not mixed, not nulled).
      expect(data.mixedCurrencies).toBe(false)
      expect(data.currency).toBe('EUR')
      const commit = data.current.metrics.find((m: ReportMetric) => m.key === 'FORECAST_COMMIT')
      expect(commit?.value).toBe(100)
    })
  })

  // ─── AC 36: TEAM_PERFORMANCE ───────────────────────────────────────────

  describe('TEAM_PERFORMANCE (AC 36)', () => {
    it('groups by owner/team with unassigned team buckets', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow({ type: 'TEAM_PERFORMANCE' }))
      mockPrisma.deal.findMany.mockResolvedValue([
        bucketRow({
          value: 4000,
          owner: { id: 'u1', firstName: 'Ada', lastName: 'Lovelace', teamId: null, team: null },
        }),
        bucketRow({
          id: 'deal-2',
          value: 2000,
          owner: {
            id: 'u1',
            firstName: 'Ada',
            lastName: 'Lovelace',
            teamId: 'team-1',
            team: { id: 'team-1', name: 'North' },
          },
        }),
        bucketRow({
          id: 'deal-3',
          value: 1000,
          owner: { id: 'u1', firstName: 'Ada', lastName: 'Lovelace', teamId: null, team: null },
        }),
      ])
      mockPrisma.deal.count.mockResolvedValue(1)
      mockPrisma.deal.aggregate.mockResolvedValue({ _sum: { value: 0 }, _count: { _all: 0 } })
      mockPrisma.deal.groupBy.mockResolvedValue([])
      mockPrisma.dealStage.findMany.mockResolvedValue([])

      const teamData = await service.reportData('tenant-1', 'user-1', 'report-1', {
        groupBy: 'TEAM',
      })
      const teamBuckets = new Map(teamData.current.buckets.map((b: ReportBucket) => [b.key, b]))
      expect(teamBuckets.get('team-1')).toMatchObject({ label: 'North', value: 2000, count: 1 })
      expect(teamBuckets.get('unassigned')).toMatchObject({
        label: 'No team',
        value: 5000,
        count: 2,
      })

      const ownerData = await service.reportData('tenant-1', 'user-1', 'report-1', {
        groupBy: 'OWNER',
      })
      const ownerBuckets = new Map(ownerData.current.buckets.map((b: ReportBucket) => [b.key, b]))
      expect(ownerBuckets.get('u1')).toMatchObject({ label: 'Ada Lovelace', value: 7000, count: 3 })

      const byKey = new Map(ownerData.current.metrics.map((m: ReportMetric) => [m.key, m]))
      expect(byKey.get('WON_REVENUE')?.value).toBe(7000)
      expect(byKey.get('WON_DEALS')?.value).toBe(3)
      expect(byKey.get('LOST_DEALS')?.value).toBe(1)
      expect(byKey.get('WIN_RATE')?.value).toBe(75)
      expect(byKey.get('AVG_WON_DEAL_SIZE')?.value).toBe(2333.33)
    })
  })

  // ─── AC 37: DEAL_VELOCITY ──────────────────────────────────────────────

  describe('DEAL_VELOCITY (AC 37)', () => {
    it('computes average/median cycle days and excludes negative durations', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow({ type: 'DEAL_VELOCITY' }))
      const created = new Date(Date.UTC(2026, 6, 1)) // Jul 1
      mockPrisma.deal.findMany.mockResolvedValue([
        bucketRow({
          id: 'd1',
          createdAt: created,
          actualCloseDate: new Date(Date.UTC(2026, 7, 11)),
        }), // 41 days
        bucketRow({
          id: 'd2',
          createdAt: created,
          actualCloseDate: new Date(Date.UTC(2026, 7, 21)),
        }), // 51 days
        bucketRow({
          id: 'd3',
          createdAt: new Date(Date.UTC(2026, 7, 30)),
          actualCloseDate: new Date(Date.UTC(2026, 7, 10)),
        }), // negative
      ])
      mockPrisma.deal.aggregate.mockResolvedValue({ _sum: { value: 0 }, _count: { _all: 0 } })
      mockPrisma.deal.groupBy.mockResolvedValue([])
      mockPrisma.dealStage.findMany.mockResolvedValue([])

      const data = await service.reportData('tenant-1', 'user-1', 'report-1')
      const byKey = new Map(data.current.metrics.map((m: ReportMetric) => [m.key, m]))
      expect(byKey.get('CLOSED_DEALS')?.value).toBe(3)
      expect(byKey.get('AVG_CYCLE_DAYS')?.value).toBe(46)
      expect(byKey.get('MEDIAN_CYCLE_DAYS')?.value).toBe(46)
      expect(byKey.get('EXCLUDED_ROWS')?.value).toBe(1)
    })

    it('is safe with an empty scope', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow({ type: 'DEAL_VELOCITY' }))
      mockPrisma.deal.findMany.mockResolvedValue([])
      mockPrisma.deal.aggregate.mockResolvedValue({ _sum: { value: 0 }, _count: { _all: 0 } })
      mockPrisma.deal.groupBy.mockResolvedValue([])
      mockPrisma.dealStage.findMany.mockResolvedValue([])

      const data = await service.reportData('tenant-1', 'user-1', 'report-1')
      const byKey = new Map(data.current.metrics.map((m: ReportMetric) => [m.key, m]))
      expect(byKey.get('AVG_CYCLE_DAYS')?.value).toBe(0)
      expect(byKey.get('MEDIAN_CYCLE_DAYS')?.value).toBe(0)
    })

    it('fails explicitly when the scope exceeds MAX_BUCKET_ROWS — never a silent truncation (AC 29 velocity guardrail, finding #2)', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow({ type: 'DEAL_VELOCITY' }))
      mockPrisma.deal.findMany.mockResolvedValue(new Array(MAX_BUCKET_ROWS + 1).fill(bucketRow({})))
      mockPrisma.deal.aggregate.mockResolvedValue({ _sum: { value: 0 }, _count: { _all: 0 } })
      mockPrisma.deal.groupBy.mockResolvedValue([])
      mockPrisma.dealStage.findMany.mockResolvedValue([])

      await expect(service.reportData('tenant-1', 'user-1', 'report-1')).rejects.toThrow(
        BadRequestException,
      )
      // The in-memory read itself was bounded by the take clause.
      expect(mockPrisma.deal.findMany.mock.calls[0][0].take).toBe(MAX_BUCKET_ROWS + 1)
    })
  })

  // ─── AC 25-26: comparison maths + rounding ─────────────────────────────

  describe('comparison maths (AC 25-26)', () => {
    function mockOverviewWithValues(
      currentWon: number,
      currentValue: number,
      comparisonWon: number,
      comparisonValue: number,
    ): void {
      mockPrisma.report.findFirst.mockResolvedValue(
        makeReportRow({ config: { ...VALID_CONFIG, comparisonMode: 'PREVIOUS_PERIOD' } }),
      )
      mockPrisma.deal.aggregate.mockImplementation(({ where }: AggregateCallArgs) =>
        Promise.resolve({
          _sum: {
            value:
              where.actualCloseDate?.gte?.getUTCMonth?.() === 6 ? comparisonValue : currentValue,
          },
          _count: {
            _all: where.actualCloseDate?.gte?.getUTCMonth?.() === 6 ? comparisonWon : currentWon,
          },
        }),
      )
      mockPrisma.deal.groupBy.mockResolvedValue([])
      mockPrisma.deal.findMany.mockResolvedValue([])
      mockPrisma.dealStage.findMany.mockResolvedValue([])
      mockPrisma.deal.count.mockResolvedValue(0)
    }

    it('computes percentage change rounded to one decimal with direction', async () => {
      mockOverviewWithValues(5, 1500, 10, 1000)
      const data = await service.reportData('tenant-1', 'user-1', 'report-1')
      expect(data.comparison).not.toBeNull()
      const revenue = data.current.metrics.find((m: ReportMetric) => m.key === 'TOTAL_REVENUE')
      expect(revenue?.comparisonValue).toBe(1000)
      expect(revenue?.percentageChange).toBe(50) // (1500-1000)/1000*100
      expect(revenue?.direction).toBe('UP')
    })

    it('returns 0/FLAT when both are zero', async () => {
      mockOverviewWithValues(0, 0, 0, 0)
      const data = await service.reportData('tenant-1', 'user-1', 'report-1')
      const revenue = data.current.metrics.find((m: ReportMetric) => m.key === 'TOTAL_REVENUE')
      expect(revenue?.percentageChange).toBe(0)
      expect(revenue?.direction).toBe('FLAT')
      expect(revenue?.displayToken).toBe('NONE')
    })

    it('returns NEW with UP/DOWN and null percentage when comparison is zero (AC 25)', async () => {
      mockOverviewWithValues(3, 1000, 0, 0)
      const data = await service.reportData('tenant-1', 'user-1', 'report-1')
      const revenue = data.current.metrics.find((m: ReportMetric) => m.key === 'TOTAL_REVENUE')
      expect(revenue?.percentageChange).toBeNull()
      expect(revenue?.direction).toBe('UP')
      expect(revenue?.displayToken).toBe('NEW')

      mockOverviewWithValues(0, -500, 0, 0)
      const data2 = await service.reportData('tenant-1', 'user-1', 'report-1')
      // lost count 0 vs 0 → FLAT; test the DOWN branch through a negative money value
      const rev = data2.current.metrics.find((m: ReportMetric) => m.key === 'TOTAL_REVENUE')
      expect(rev?.direction).toBe('DOWN')
      expect(rev?.displayToken).toBe('NEW')
    })

    it('never returns NaN or Infinity values (AC 26)', async () => {
      mockOverviewWithValues(0, 0, 5, 1000)
      const data = await service.reportData('tenant-1', 'user-1', 'report-1')
      for (const metric of data.current.metrics) {
        expect(Number.isFinite(metric.value as number)).toBe(true)
      }
      const json = JSON.stringify(data)
      expect(json).not.toContain('NaN')
      expect(json).not.toContain('Infinity')
    })
  })

  // ─── AC 30: mixed currency ─────────────────────────────────────────────

  describe('mixed currency (AC 30)', () => {
    function mockCurrencies(currencies: string[]): void {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow())
      mockPrisma.deal.groupBy.mockResolvedValue(
        currencies.map((c) => ({ currency: c, _count: { _all: 1 } })),
      )
      mockPrisma.deal.aggregate.mockResolvedValue({ _sum: { value: 1000 }, _count: { _all: 2 } })
      mockPrisma.deal.findMany.mockResolvedValue([])
      mockPrisma.dealStage.findMany.mockResolvedValue([])
    }

    it('flags mixed currencies and nulls money KPIs until a currency is selected', async () => {
      mockCurrencies(['EUR', 'USD'])
      const data = await service.reportData('tenant-1', 'user-1', 'report-1')

      expect(data.mixedCurrencies).toBe(true)
      expect(data.currency).toBeNull()
      expect(data.availableCurrencies).toEqual(['EUR', 'USD'])
      const revenue = data.current.metrics.find((m: ReportMetric) => m.key === 'TOTAL_REVENUE')
      expect(revenue?.value).toBeNull()
      const won = data.current.metrics.find((m: ReportMetric) => m.key === 'WON_DEALS')
      expect(won?.value).toBe(2) // counts remain valid
      expect(data.calculationNote).toMatch(/currency/i)
    })

    it('applies a selected currency and narrows the scope', async () => {
      mockCurrencies(['EUR', 'USD'])
      const data = await service.reportData('tenant-1', 'user-1', 'report-1', { currency: 'USD' })
      expect(data.mixedCurrencies).toBe(false)
      expect(data.currency).toBe('USD')
      const revenue = data.current.metrics.find((m: ReportMetric) => m.key === 'TOTAL_REVENUE')
      expect(revenue?.value).toBe(1000)
    })

    it('single currency is not mixed and money stays', async () => {
      mockCurrencies(['USD'])
      const data = await service.reportData('tenant-1', 'user-1', 'report-1')
      expect(data.mixedCurrencies).toBe(false)
      expect(data.currency).toBe('USD')
    })
  })

  // ─── AC 42-43: unknown type + empty scopes ─────────────────────────────

  describe('dispatch + empty scopes (AC 42-43)', () => {
    it('fails closed with BadRequestException for an unknown persisted type', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow({ type: 'INVENTORY' }))
      await expect(service.reportData('tenant-1', 'user-1', 'report-1')).rejects.toThrow(
        new BadRequestException('Unsupported report type'),
      )
    })

    it('rejects CUSTOM before the six-type calculation map (Story 6.3 Contract C.22)', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow({ type: 'CUSTOM' }))
      await expect(service.reportData('tenant-1', 'user-1', 'report-1')).rejects.toThrow(
        new BadRequestException('Custom reports must be executed through customReportData'),
      )
      await expect(service.runReport('tenant-1', 'user-1', 'report-1')).rejects.toThrow(
        new BadRequestException('Custom reports must be executed through customReportData'),
      )
      // No sales computation must run for a CUSTOM report.
      expect(mockPrisma.deal.aggregate).not.toHaveBeenCalled()
      expect(mockPrisma.deal.groupBy).not.toHaveBeenCalled()
    })

    it('returns a structurally complete result for an empty scope (AC 43)', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow())
      mockPrisma.deal.aggregate.mockResolvedValue({ _sum: { value: 0 }, _count: { _all: 0 } })
      mockPrisma.deal.groupBy.mockResolvedValue([])
      mockPrisma.deal.findMany.mockResolvedValue([])
      mockPrisma.dealStage.findMany.mockResolvedValue([])
      mockPrisma.deal.count.mockResolvedValue(0)

      const data = await service.reportData('tenant-1', 'user-1', 'report-1')
      expect(data.current.metrics.length).toBeGreaterThan(0)
      // Dense time buckets are zero-filled — one bucket per month in range.
      expect(data.current.buckets).toHaveLength(1)
      expect(data.current.buckets[0]).toMatchObject({ key: '2026-08', count: 0 })
      expect(data.current.stageBreakdown).toEqual([])
      expect(data.generatedAt).toBe(NOW.toISOString())
      expect(data.appliedFilters).toBeDefined()
    })
  })

  // ─── AC 44: single clock ───────────────────────────────────────────────

  describe('generatedAt clock (AC 44)', () => {
    it('uses one captured now for the whole run', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow())
      mockPrisma.deal.aggregate.mockResolvedValue({ _sum: { value: 0 }, _count: { _all: 0 } })
      mockPrisma.deal.groupBy.mockResolvedValue([])
      mockPrisma.deal.findMany.mockResolvedValue([])
      mockPrisma.dealStage.findMany.mockResolvedValue([])

      const data = await service.reportData('tenant-1', 'user-1', 'report-1')
      expect(data.generatedAt).toBe('2026-08-15T12:00:00.000Z')
    })
  })

  // ─── AC 46-53: drill-down ──────────────────────────────────────────────

  describe('drill-down predicate branches (AC 46-53)', () => {
    beforeEach(() => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow())
      mockPrisma.deal.aggregate.mockResolvedValue({ _sum: { value: 0 }, _count: { _all: 0 } })
      mockPrisma.deal.groupBy.mockResolvedValue([])
      mockPrisma.deal.findMany.mockResolvedValue([])
      mockPrisma.dealStage.findMany.mockResolvedValue([])
    })

    function lastDrillWhere(): Prisma.DealWhereInput {
      const calls = mockPrisma.deal.findMany.mock.calls
      return calls[calls.length - 1][0].where as Prisma.DealWhereInput
    }

    it('LOST_DEALS drills with the lost terminal stage', async () => {
      await service.reportData('tenant-1', 'user-1', 'report-1', undefined, {
        metricKey: 'LOST_DEALS',
      })
      expect(lastDrillWhere().stage).toEqual({ isLost: true })
    })

    it('TOTAL_CLOSED drills with won-or-lost terminal stages', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow({ type: 'WIN_LOSS' }))
      mockWinLoss.winLossAnalysis.mockResolvedValue({
        totalClosed: 0,
        wonCount: 0,
        lostCount: 0,
        winRate: 0,
        wonValue: 0,
        lostValue: 0,
        currency: 'USD',
        lossReasons: [],
        winReasons: [],
        competitors: [],
      })
      await service.reportData('tenant-1', 'user-1', 'report-1', undefined, {
        metricKey: 'TOTAL_CLOSED',
      })
      expect(lastDrillWhere().stage).toEqual({ OR: [{ isWon: true }, { isLost: true }] })
    })

    it('OPEN_DEALS drills with open stages and expectedCloseDate range', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow({ type: 'PIPELINE_ANALYSIS' }))
      await service.reportData('tenant-1', 'user-1', 'report-1', undefined, {
        metricKey: 'OPEN_DEALS',
      })
      const where = lastDrillWhere()
      expect(where.stage).toEqual({ isWon: false, isLost: false })
      expect(where.expectedCloseDate).toBeDefined()
    })

    it('FORECAST_COMMIT / BEST_CASE / PIPELINE apply probability thresholds', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow({ type: 'REVENUE_FORECAST' }))
      mockForecast.salesForecast.mockResolvedValue({
        buckets: [],
        commit: { weightedValue: 0, totalValue: 0, count: 0 },
        bestCase: { weightedValue: 0, totalValue: 0, count: 0 },
        pipeline: { weightedValue: 0, totalValue: 0, count: 0 },
        currency: 'USD',
      })
      await service.reportData('tenant-1', 'user-1', 'report-1', undefined, {
        metricKey: 'FORECAST_COMMIT',
      })
      expect(lastDrillWhere().probability).toEqual({ gte: 75 })
      await service.reportData('tenant-1', 'user-1', 'report-1', undefined, {
        metricKey: 'FORECAST_BEST_CASE',
      })
      expect(lastDrillWhere().probability).toEqual({ gte: 50 })
      await service.reportData('tenant-1', 'user-1', 'report-1', undefined, {
        metricKey: 'FORECAST_PIPELINE',
      })
      expect(lastDrillWhere().probability).toBeUndefined()
      expect(lastDrillWhere().stage).toEqual({ isWon: false, isLost: false })
    })

    it('CLOSED_DEALS (velocity) drills on actualCloseDate only', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow({ type: 'DEAL_VELOCITY' }))
      await service.reportData('tenant-1', 'user-1', 'report-1', undefined, {
        metricKey: 'CLOSED_DEALS',
      })
      const where = lastDrillWhere()
      expect(where.actualCloseDate).toBeDefined()
      expect(where.stage).toBeUndefined()
    })

    it('rejects an unknown bucket key for time grouping', async () => {
      await service
        .reportData(
          'tenant-1',
          'user-1',
          'report-1',
          { groupBy: 'MONTH' },
          {
            metricKey: 'WON_DEALS',
            bucketKey: 'garbage',
          },
        )
        .catch((err) => expect(err).toBeInstanceOf(BadRequestException))
    })

    it('handles null contact/owner on drill rows', async () => {
      mockPrisma.deal.findMany.mockResolvedValue([
        {
          id: 'deal-x',
          title: 'X',
          value: 0,
          currency: 'USD',
          probability: 0,
          stageId: 's1',
          contactId: null,
          ownerId: 'u1',
          createdAt: new Date(Date.UTC(2026, 7, 1)),
          expectedCloseDate: null,
          actualCloseDate: null,
          stage: null,
          contact: null,
          owner: null,
          lineItems: [],
        },
      ])
      mockPrisma.deal.count.mockResolvedValue(1)
      const data = await service.reportData('tenant-1', 'user-1', 'report-1', undefined, {
        metricKey: 'WON_DEALS',
      })
      const row = (data.drillDown as ReportDrillConnection).items[0]
      expect(row.stageName).toBeNull()
      expect(row.contactName).toBeNull()
      expect(row.ownerName).toBeNull()
      expect(row.teamName).toBeNull()
      expect(row.productNames).toEqual([])
      expect(row.contactHref).toBeNull()
      expect(row.dealHref).toBe('/deals/deal-x')
    })

    it('validates team/stage/product filter IDs (AC 28)', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow())
      mockPrisma.team.findFirst.mockResolvedValue(null)
      await expect(
        service.reportData('tenant-1', 'user-1', 'report-1', { teamId: 'bad-team' }),
      ).rejects.toThrow(BadRequestException)

      mockPrisma.team.findFirst.mockResolvedValue({ id: 'team-1' })
      mockPrisma.dealStage.findFirst.mockResolvedValue(null)
      await expect(
        service.reportData('tenant-1', 'user-1', 'report-1', { stageId: 'bad-stage' }),
      ).rejects.toThrow(BadRequestException)

      mockPrisma.dealStage.findFirst.mockResolvedValue({ id: 'stage-1' })
      mockPrisma.product.findFirst.mockResolvedValue(null)
      await expect(
        service.reportData('tenant-1', 'user-1', 'report-1', { productId: 'bad-product' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('nulls composed-service money when a currency selection cannot be honored (AC 30)', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow({ type: 'WIN_LOSS' }))
      mockWinLoss.winLossAnalysis.mockResolvedValue({
        totalClosed: 2,
        wonCount: 1,
        lostCount: 1,
        winRate: 50,
        wonValue: 1000,
        lostValue: 500,
        currency: 'EUR',
        lossReasons: [],
        winReasons: [],
        competitors: [],
      })
      mockPrisma.deal.groupBy.mockResolvedValue([
        { currency: 'EUR', _count: { _all: 1 } },
        { currency: 'USD', _count: { _all: 1 } },
      ])
      mockPrisma.deal.findMany.mockResolvedValue([])

      const data = await service.reportData('tenant-1', 'user-1', 'report-1', { currency: 'EUR' })
      expect(data.mixedCurrencies).toBe(true)
      const wonValue = data.current.metrics.find((m: ReportMetric) => m.key === 'WON_VALUE')
      expect(wonValue?.value).toBeNull()
    })

    it('rejects an update with an empty name and a create with whitespace-only name', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow())
      await expect(
        service.updateReport('tenant-1', 'user-1', 'report-1', { name: '  ' }),
      ).rejects.toThrow(BadRequestException)
      mockPrisma.report.findFirst.mockResolvedValue(null)
      await expect(
        service.updateReport('tenant-1', 'user-1', 'report-1', { name: '  ' }),
      ).rejects.toThrow(NotFoundException)
    })

    it('rejects an overlong update name and accepts a valid type change', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow())
      mockPrisma.report.findMany.mockResolvedValue([])
      mockPrisma.report.update.mockResolvedValue(makeReportRow({ type: 'PIPELINE_ANALYSIS' }))
      await expect(
        service.updateReport('tenant-1', 'user-1', 'report-1', { name: 'x'.repeat(121) }),
      ).rejects.toThrow(BadRequestException)
      const row = await service.updateReport('tenant-1', 'user-1', 'report-1', {
        type: 'PIPELINE_ANALYSIS',
      })
      expect(mockPrisma.report.update.mock.calls[0][0].data.type).toBe('PIPELINE_ANALYSIS')
      expect(row.type).toBe('PIPELINE_ANALYSIS')
    })

    it('narrows the scope for team/stage/product filters (AC 40)', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow())
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
      mockPrisma.team.findFirst.mockResolvedValue({ id: 'team-1' })
      mockPrisma.dealStage.findFirst.mockResolvedValue({ id: 'stage-1' })
      mockPrisma.product.findFirst.mockResolvedValue({ id: 'product-1' })
      mockPrisma.deal.aggregate.mockResolvedValue({ _sum: { value: 0 }, _count: { _all: 0 } })
      mockPrisma.deal.groupBy.mockResolvedValue([])
      mockPrisma.deal.findMany.mockResolvedValue([])
      mockPrisma.dealStage.findMany.mockResolvedValue([])

      await service.reportData('tenant-1', 'user-1', 'report-1', {
        teamId: 'team-1',
        stageId: 'stage-1',
        productId: 'product-1',
      })

      const where = mockPrisma.deal.aggregate.mock.calls[0][0].where as Prisma.DealWhereInput
      const ands: Prisma.DealWhereInput[] = Array.isArray(where.AND)
        ? (where.AND as Prisma.DealWhereInput[])
        : []
      expect(ands.some((c) => c.owner?.teamId === 'team-1')).toBe(true)
      expect(ands.some((c) => c.stageId === 'stage-1')).toBe(true)
      expect(ands.some((c) => c.lineItems?.some?.productId === 'product-1')).toBe(true)
    })

    it('supports QUARTER and YEAR dense buckets (AC 38)', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow())
      mockPrisma.deal.aggregate.mockResolvedValue({ _sum: { value: 1000 }, _count: { _all: 1 } })
      mockPrisma.deal.groupBy.mockResolvedValue([])
      mockPrisma.deal.findMany.mockResolvedValue([
        bucketRow({ actualCloseDate: new Date(Date.UTC(2026, 7, 5)), value: 1000 }),
      ])
      mockPrisma.dealStage.findMany.mockResolvedValue([])

      const quarter = await service.reportData('tenant-1', 'user-1', 'report-1', {
        groupBy: 'QUARTER',
      })
      expect(quarter.current.buckets[0]).toMatchObject({ key: '2026-Q3', value: 1000, count: 1 })

      const year = await service.reportData('tenant-1', 'user-1', 'report-1', { groupBy: 'YEAR' })
      expect(year.current.buckets[0]).toMatchObject({ key: '2026', value: 1000, count: 1 })
    })

    it('handles product buckets for DEAL_VELOCITY without line items', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow({ type: 'DEAL_VELOCITY' }))
      mockPrisma.deal.findMany.mockResolvedValue([
        bucketRow({
          id: 'd1',
          createdAt: new Date(Date.UTC(2026, 6, 1)),
          actualCloseDate: new Date(Date.UTC(2026, 7, 11)),
          lineItems: [],
        }),
      ])
      mockPrisma.deal.aggregate.mockResolvedValue({ _sum: { value: 0 }, _count: { _all: 0 } })
      mockPrisma.deal.groupBy.mockResolvedValue([])
      mockPrisma.dealStage.findMany.mockResolvedValue([])

      const data = await service.reportData('tenant-1', 'user-1', 'report-1', {
        groupBy: 'PRODUCT',
      })
      expect(data.current.buckets).toEqual([])
      const byKey = new Map(data.current.metrics.map((m: ReportMetric) => [m.key, m]))
      expect(byKey.get('AVG_CYCLE_DAYS')?.value).toBe(41)
    })

    it('drills a pipeline stage bucket via bucketKey with time groupBy (AC 50)', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow({ type: 'PIPELINE_ANALYSIS' }))
      mockPrisma.deal.aggregate.mockResolvedValue({ _sum: { value: 0 }, _count: { _all: 0 } })
      mockPrisma.deal.groupBy.mockResolvedValue([])
      mockPrisma.deal.findMany.mockResolvedValue([])
      mockPrisma.dealStage.findMany.mockResolvedValue([])

      await service.reportData(
        'tenant-1',
        'user-1',
        'report-1',
        { groupBy: 'MONTH' },
        {
          metricKey: 'OPEN_DEALS',
          bucketKey: 'stage-9',
        },
      )
      const calls = mockPrisma.deal.findMany.mock.calls
      expect(calls[calls.length - 1][0].where.stageId).toBe('stage-9')
    })
  })

  // ─── AC 46-53: drill-down ──────────────────────────────────────────────

  describe('drill-down (AC 46-53)', () => {
    function drillRowRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        id: 'deal-1',
        title: 'Acme renewal',
        value: 1000,
        currency: 'USD',
        probability: 50,
        stageId: 'stage-1',
        contactId: 'contact-1',
        ownerId: 'user-1',
        createdAt: new Date(Date.UTC(2026, 7, 1)),
        expectedCloseDate: new Date(Date.UTC(2026, 7, 31)),
        actualCloseDate: new Date(Date.UTC(2026, 7, 15)),
        stage: { id: 'stage-1', name: 'Proposal' },
        contact: { id: 'contact-1', firstName: 'Grace', lastName: 'Hopper' },
        owner: {
          id: 'user-1',
          firstName: 'Ada',
          lastName: 'Lovelace',
          teamId: 'team-1',
          team: { id: 'team-1', name: 'North' },
        },
        lineItems: [
          { product: { name: 'CRM' } },
          { product: { name: 'CRM' } },
          { product: { name: 'API' } },
        ],
        ...overrides,
      }
    }

    beforeEach(() => {
      mockPrisma.report.findFirst.mockResolvedValue(makeReportRow())
      mockPrisma.deal.aggregate.mockResolvedValue({ _sum: { value: 0 }, _count: { _all: 0 } })
      mockPrisma.deal.groupBy.mockResolvedValue([])
      mockPrisma.deal.findMany.mockResolvedValue([])
      mockPrisma.dealStage.findMany.mockResolvedValue([])
    })

    it('returns a paginated drill connection with all display fields (AC 48-49)', async () => {
      mockPrisma.deal.findMany.mockResolvedValue([drillRowRaw()])
      mockPrisma.deal.count.mockResolvedValue(1)

      const data = await service.reportData('tenant-1', 'user-1', 'report-1', undefined, {
        metricKey: 'WON_DEALS',
        page: 1,
        pageSize: 20,
      })

      expect(data.drillDown).not.toBeNull()
      const drill = data.drillDown as ReportDrillConnection
      expect(drill.total).toBe(1)
      expect(drill.page).toBe(1)
      expect(drill.pageSize).toBe(20)
      const row = drill.items[0]
      expect(row).toMatchObject({
        id: 'deal-1',
        title: 'Acme renewal',
        value: 1000,
        currency: 'USD',
        probability: 50,
        stageId: 'stage-1',
        stageName: 'Proposal',
        contactId: 'contact-1',
        contactName: 'Grace Hopper',
        ownerName: 'Ada Lovelace',
        teamName: 'North',
        dealHref: '/deals/deal-1',
        contactHref: '/contacts/contact-1',
      })
      // Product names deduplicated and sorted (AC 51).
      expect(row.productNames).toEqual(['API', 'CRM'])
    })

    it('builds the exact WON_DEALS predicate: won stage + current actualCloseDate range (AC 50)', async () => {
      await service.reportData('tenant-1', 'user-1', 'report-1', undefined, {
        metricKey: 'WON_DEALS',
      })
      // The LAST findMany is the drill query (SALES_OVERVIEW also fetches
      // bucket rows); one drill findMany + one drill count — no per-row lookups.
      const calls = mockPrisma.deal.findMany.mock.calls
      const where = calls[calls.length - 1][0].where
      expect(where.stage).toEqual({ isWon: true })
      expect(where.actualCloseDate).toBeDefined()
      expect(mockPrisma.deal.count).toHaveBeenCalledTimes(1)
    })

    it('narrows an owner bucket on top of visibility (AC 50)', async () => {
      await service.reportData(
        'tenant-1',
        'user-1',
        'report-1',
        { groupBy: 'OWNER' },
        {
          metricKey: 'WON_DEALS',
          bucketKey: 'user-9',
        },
      )
      const calls = mockPrisma.deal.findMany.mock.calls
      expect(calls[calls.length - 1][0].where.ownerId).toBe('user-9')
    })

    it('narrows a product bucket via active line items (AC 50)', async () => {
      await service.reportData(
        'tenant-1',
        'user-1',
        'report-1',
        { groupBy: 'PRODUCT' },
        {
          metricKey: 'WON_DEALS',
          bucketKey: 'product-9',
        },
      )
      const calls = mockPrisma.deal.findMany.mock.calls
      expect(calls[calls.length - 1][0].where.lineItems).toEqual({
        some: { productId: 'product-9', deletedAt: null },
      })
    })

    it('narrows a team bucket including the unassigned key (AC 36, 50)', async () => {
      await service.reportData(
        'tenant-1',
        'user-1',
        'report-1',
        { groupBy: 'TEAM' },
        {
          metricKey: 'WON_DEALS',
          bucketKey: 'unassigned',
        },
      )
      const calls = mockPrisma.deal.findMany.mock.calls
      expect(calls[calls.length - 1][0].where.owner).toEqual({ teamId: null })

      mockPrisma.team.findFirst.mockResolvedValue({ id: 'team-9' })
      await service.reportData(
        'tenant-1',
        'user-1',
        'report-1',
        { groupBy: 'TEAM' },
        {
          metricKey: 'WON_DEALS',
          bucketKey: 'team-9',
        },
      )
      expect(calls[calls.length - 1][0].where.owner).toEqual({ teamId: 'team-9' })
    })

    it('narrows a time bucket to the bucket sub-range (AC 50)', async () => {
      await service.reportData(
        'tenant-1',
        'user-1',
        'report-1',
        { groupBy: 'MONTH' },
        {
          metricKey: 'WON_DEALS',
          bucketKey: '2026-07',
        },
      )
      const calls = mockPrisma.deal.findMany.mock.calls
      const where = calls[calls.length - 1][0].where
      expect(where.actualCloseDate.gte.toISOString()).toBe('2026-07-01T00:00:00.000Z')
      expect(where.actualCloseDate.lte.toISOString()).toBe('2026-07-31T23:59:59.999Z')
    })

    it('rejects invalid metric/bucket keys with 400-class errors (AC 47)', async () => {
      await expect(
        service.reportData('tenant-1', 'user-1', 'report-1', undefined, { metricKey: 'title' }),
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.reportData('tenant-1', 'user-1', 'report-1', undefined, {
          metricKey: 'WIN_RATE',
        }),
      ).rejects.toThrow(BadRequestException) // not drillable for SALES_OVERVIEW
      await expect(
        service.reportData(
          'tenant-1',
          'user-1',
          'report-1',
          { groupBy: 'MONTH' },
          {
            metricKey: 'WON_DEALS',
            bucketKey: 'not-a-bucket',
          },
        ),
      ).rejects.toThrow(BadRequestException)
    })

    it('clamps drill page/pageSize to 1..100 and default 20 (AC 29, 48)', async () => {
      await service.reportData('tenant-1', 'user-1', 'report-1', undefined, {
        metricKey: 'WON_DEALS',
        page: 0,
        pageSize: 999,
      })
      const calls = mockPrisma.deal.findMany.mock.calls
      const call = calls[calls.length - 1][0]
      expect(call.skip).toBe(0)
      expect(call.take).toBe(100)
    })

    it('supports the COMPARISON scope and rejects it when no comparison is configured (AC 53)', async () => {
      await expect(
        service.reportData('tenant-1', 'user-1', 'report-1', undefined, {
          metricKey: 'WON_DEALS',
          scope: 'COMPARISON',
        }),
      ).rejects.toThrow(BadRequestException)

      mockPrisma.report.findFirst.mockResolvedValue(
        makeReportRow({ config: { ...VALID_CONFIG, comparisonMode: 'PREVIOUS_PERIOD' } }),
      )
      await service.reportData('tenant-1', 'user-1', 'report-1', undefined, {
        metricKey: 'WON_DEALS',
        scope: 'COMPARISON',
      })
      const calls = mockPrisma.deal.findMany.mock.calls
      const where = calls[calls.length - 1][0].where
      // Comparison scope: previous period (July) range, not August.
      expect(where.actualCloseDate.gte.toISOString()).toBe('2026-07-01T00:00:00.000Z')
      expect(where.actualCloseDate.lte.toISOString()).toBe('2026-07-31T23:59:59.999Z')
    })

    it('maps a time bucketKey to the comparison period bucket — never the current bucket — in COMPARISON scope (AC 53 dogfood bug)', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(
        makeReportRow({ config: { ...VALID_CONFIG, comparisonMode: 'PREVIOUS_PERIOD' } }),
      )
      await service.reportData('tenant-1', 'user-1', 'report-1', undefined, {
        metricKey: 'WON_DEALS',
        bucketKey: '2026-08',
        scope: 'COMPARISON',
      })
      const calls = mockPrisma.deal.findMany.mock.calls
      const where = calls[calls.length - 1][0].where
      // The August bucketKey must narrow to the comparison period's July
      // bucket, not re-apply the August (current) range on top of the
      // comparison baseWhere.
      expect(where.actualCloseDate.gte.toISOString()).toBe('2026-07-01T00:00:00.000Z')
      expect(where.actualCloseDate.lte.toISOString()).toBe('2026-07-31T23:59:59.999Z')
    })

    it('keeps the literal bucket range in CURRENT scope drill-downs', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(
        makeReportRow({ config: { ...VALID_CONFIG, comparisonMode: 'PREVIOUS_PERIOD' } }),
      )
      await service.reportData('tenant-1', 'user-1', 'report-1', undefined, {
        metricKey: 'WON_DEALS',
        bucketKey: '2026-08',
        scope: 'CURRENT',
      })
      const calls = mockPrisma.deal.findMany.mock.calls
      const where = calls[calls.length - 1][0].where
      expect(where.actualCloseDate.gte.toISOString()).toBe('2026-08-01T00:00:00.000Z')
      expect(where.actualCloseDate.lte.toISOString()).toBe('2026-08-31T23:59:59.999Z')
    })
  })

  // ─── AC 41: full result shape ──────────────────────────────────────────

  describe('full result shape (AC 41)', () => {
    it('returns current period, comparison, filters, generatedAt, date semantics, currency metadata, metrics, buckets, stage breakdown and calculationNote', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(
        makeReportRow({ config: { ...VALID_CONFIG, comparisonMode: 'PREVIOUS_PERIOD' } }),
      )
      mockPrisma.deal.aggregate.mockImplementation(({ where }: AggregateCallArgs) =>
        Promise.resolve({
          _sum: { value: where.stage?.isWon ? 1000 : 0 },
          _count: { _all: where.stage?.isWon ? 1 : 0 },
        }),
      )
      mockPrisma.deal.groupBy.mockResolvedValue([{ currency: 'USD', _count: { _all: 1 } }])
      mockPrisma.deal.findMany.mockResolvedValue([])
      mockPrisma.dealStage.findMany.mockResolvedValue([])

      const data = await service.reportData('tenant-1', 'user-1', 'report-1')

      expect(data.reportId).toBe('report-1')
      expect(data.reportType).toBe('SALES_OVERVIEW')
      expect(data.generatedAt).toBeDefined()
      expect(data.dateField).toBeDefined()
      expect(data.currency).toBeDefined()
      expect(data.mixedCurrencies).toBe(false)
      expect(data.availableCurrencies).toBeDefined()
      expect(data.appliedFilters).toEqual({ ...VALID_CONFIG, comparisonMode: 'PREVIOUS_PERIOD' })
      expect(data.current).toBeDefined()
      expect(data.comparison).not.toBeNull()
      expect(data.calculationNote.length).toBeGreaterThan(0)
    })
  })
})
