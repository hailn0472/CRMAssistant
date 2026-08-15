/**
 * Story 6.3 — CustomReportsService unit tests (Contract C, AC 5, 8-11, 14-16).
 * Typed mocks for Prisma delegates, the four visibility builders and the
 * shared sales persistence invariants. No real database, no GraphQL.
 */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'

import {
  CustomReportsService,
  MAX_CUSTOM_SCOPE_ROWS,
  MAX_GROUPED_ROWS,
} from '../custom-reports.service'
import type { CustomReportConfig } from '../custom-report-types'
import { CUSTOM_REPORT_CATALOGS } from '../custom-report-catalog'
import { MAX_ACTIVE_REPORTS_PER_CREATOR } from '../report-config'

const NOW = new Date(Date.UTC(2026, 7, 15, 12, 0, 0))

// ─── Config fixtures ─────────────────────────────────────────────────────────

function dealsConfig(overrides: Partial<CustomReportConfig> = {}): CustomReportConfig {
  return {
    version: 1,
    dataSource: 'DEALS',
    filters: [],
    dimensions: [{ id: 'dim-stage', fieldId: 'deal.stage', calculation: null, granularity: null }],
    metrics: [
      { id: 'metric-deals', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'deals' },
      { id: 'metric-value', fieldId: 'deal.value', aggregation: 'SUM', alias: 'revenue' },
    ],
    calculatedFields: [],
    visualization: {
      type: 'TABLE',
      title: null,
      showLegend: false,
      showDataLabels: false,
      xAxisLabel: null,
      yAxisLabel: null,
      orientation: null,
    },
    sort: [],
    ...overrides,
  }
}

function contactsConfig(overrides: Partial<CustomReportConfig> = {}): CustomReportConfig {
  return {
    version: 1,
    dataSource: 'CONTACTS',
    filters: [],
    dimensions: [
      { id: 'dim-owner', fieldId: 'contact.owner', calculation: null, granularity: null },
    ],
    metrics: [{ id: 'metric-count', fieldId: 'contact.id', aggregation: 'COUNT', alias: 'count' }],
    calculatedFields: [],
    visualization: {
      type: 'TABLE',
      title: null,
      showLegend: false,
      showDataLabels: false,
      xAxisLabel: null,
      yAxisLabel: null,
      orientation: null,
    },
    sort: [],
    ...overrides,
  }
}

// ─── Typed mocks ─────────────────────────────────────────────────────────────

type MockReportDelegate = { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock }
type MockContactDelegate = { count: jest.Mock; findMany: jest.Mock }
type MockDealDelegate = { count: jest.Mock; findMany: jest.Mock; groupBy: jest.Mock }
type MockTaskDelegate = { count: jest.Mock; findMany: jest.Mock }
type MockActivityDelegate = { count: jest.Mock; findMany: jest.Mock }
type MockUserDelegate = { findMany: jest.Mock }
type MockTeamDelegate = { findMany: jest.Mock }
type MockStageDelegate = { findMany: jest.Mock }
type MockTagDelegate = { findMany: jest.Mock }
type MockProductDelegate = { findMany: jest.Mock }

type MockPrisma = {
  report: MockReportDelegate
  contact: MockContactDelegate
  deal: MockDealDelegate
  task: MockTaskDelegate
  activity: MockActivityDelegate
  user: MockUserDelegate
  team: MockTeamDelegate
  dealStage: MockStageDelegate
  tag: MockTagDelegate
  product: MockProductDelegate
}

type MockContactsService = { buildContactWhere: jest.Mock }
type MockDealsService = { buildDealWhere: jest.Mock }
type MockTasksService = { buildTaskWhere: jest.Mock }
type MockActivityService = { buildFeedWhere: jest.Mock }
type MockSalesReportsService = {
  assertNameAvailable: jest.Mock
  assertUnderActiveLimit: jest.Mock
}
type MockAuditService = { log: jest.Mock }

function makePrisma(): MockPrisma {
  return {
    report: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    contact: { count: jest.fn(), findMany: jest.fn() },
    deal: { count: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
    task: { count: jest.fn(), findMany: jest.fn() },
    activity: { count: jest.fn(), findMany: jest.fn() },
    user: { findMany: jest.fn() },
    team: { findMany: jest.fn() },
    dealStage: { findMany: jest.fn() },
    tag: { findMany: jest.fn() },
    product: { findMany: jest.fn() },
  }
}

// ─── Row fixtures ────────────────────────────────────────────────────────────

function dealRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'deal-1',
    value: 1000,
    probability: 50,
    currency: 'USD',
    stageId: 'stage-open',
    ownerId: 'user-1',
    contactId: 'contact-1',
    createdAt: new Date('2026-01-15T00:00:00.000Z'),
    updatedAt: new Date('2026-01-15T00:00:00.000Z'),
    expectedCloseDate: new Date('2026-02-15T00:00:00.000Z'),
    actualCloseDate: null,
    stage: { id: 'stage-open', name: 'Open', order: 1, isWon: false, isLost: false },
    owner: {
      id: 'user-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      teamId: 'team-1',
      team: { id: 'team-1', name: 'North' },
    },
    contact: { id: 'contact-1', firstName: 'Grace', lastName: 'Hopper' },
    lineItems: [
      {
        productId: 'product-1',
        quantity: 2,
        discount: 10,
        total: 1800,
        product: { id: 'product-1', name: 'CRM', isActive: true, deletedAt: null },
      },
    ],
    ...overrides,
  }
}

function contactRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'contact-1',
    ownerId: 'user-1',
    teamId: 'team-1',
    company: null,
    jobTitle: null,
    addressCity: null,
    addressCountry: null,
    department: null,
    timezone: null,
    language: null,
    source: null,
    createdAt: new Date('2026-01-15T00:00:00.000Z'),
    updatedAt: new Date('2026-01-15T00:00:00.000Z'),
    owner: {
      id: 'user-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      teamId: 'team-1',
      team: { id: 'team-1', name: 'North' },
    },
    team: { id: 'team-1', name: 'North' },
    tags: [],
    ...overrides,
  }
}

function taskRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'task-1',
    title: 'Follow up',
    status: 'TODO',
    priority: 'HIGH',
    dueDate: new Date('2026-02-01T00:00:00.000Z'),
    completedAt: null,
    createdAt: new Date('2026-01-15T00:00:00.000Z'),
    updatedAt: new Date('2026-01-15T00:00:00.000Z'),
    assignedTo: 'user-1',
    contactId: 'contact-1',
    dealId: null,
    isRecurring: false,
    recurrencePattern: null,
    assignee: {
      id: 'user-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      teamId: 'team-1',
      team: { id: 'team-1', name: 'North' },
    },
    contact: { id: 'contact-1', firstName: 'Grace', lastName: 'Hopper' },
    deal: null,
    ...overrides,
  }
}

function activityRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'activity-1',
    type: 'CALL_MADE',
    source: 'MANUAL',
    createdBy: 'user-1',
    createdAt: new Date('2026-01-15T00:00:00.000Z'),
    contactId: 'contact-1',
    contact: {
      id: 'contact-1',
      firstName: 'Grace',
      lastName: 'Hopper',
      ownerId: 'user-1',
      owner: {
        id: 'user-1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        teamId: 'team-1',
        team: { id: 'team-1', name: 'North' },
      },
      tags: [],
    },
    ...overrides,
  }
}

// ─── Service builder ─────────────────────────────────────────────────────────

describe('CustomReportsService', () => {
  let service: CustomReportsService
  let mockPrisma: MockPrisma
  let mockContacts: MockContactsService
  let mockDeals: MockDealsService
  let mockTasks: MockTasksService
  let mockActivities: MockActivityService
  let mockSales: MockSalesReportsService
  let mockAudit: MockAuditService

  function buildService(clock: () => Date = () => NOW): CustomReportsService {
    return new CustomReportsService(
      mockPrisma as unknown as ConstructorParameters<typeof CustomReportsService>[0],
      mockContacts as unknown as ConstructorParameters<typeof CustomReportsService>[1],
      mockDeals as unknown as ConstructorParameters<typeof CustomReportsService>[2],
      mockTasks as unknown as ConstructorParameters<typeof CustomReportsService>[3],
      mockActivities as unknown as ConstructorParameters<typeof CustomReportsService>[4],
      mockSales as unknown as ConstructorParameters<typeof CustomReportsService>[5],
      mockAudit as unknown as ConstructorParameters<typeof CustomReportsService>[6],
      clock,
    )
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma = makePrisma()
    mockContacts = {
      buildContactWhere: jest.fn().mockResolvedValue({ tenantId: 'tenant-1', deletedAt: null }),
    }
    mockDeals = {
      buildDealWhere: jest.fn().mockResolvedValue({ tenantId: 'tenant-1', deletedAt: null }),
    }
    mockTasks = {
      buildTaskWhere: jest.fn().mockResolvedValue({ tenantId: 'tenant-1', deletedAt: null }),
    }
    mockActivities = {
      buildFeedWhere: jest
        .fn()
        .mockResolvedValue({ tenantId: 'tenant-1', contact: { deletedAt: null } }),
    }
    mockSales = {
      assertNameAvailable: jest.fn().mockResolvedValue(undefined),
      assertUnderActiveLimit: jest.fn().mockResolvedValue(undefined),
    }
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) }
    // Default delegate responses so unrelated mocks never return undefined.
    for (const delegate of [
      mockPrisma.user,
      mockPrisma.team,
      mockPrisma.dealStage,
      mockPrisma.tag,
      mockPrisma.product,
    ]) {
      delegate.findMany.mockResolvedValue([])
    }
    mockPrisma.deal.groupBy.mockResolvedValue([])
    service = buildService()
  })

  function countAndRows(count: number, rows: Record<string, unknown>[]): void {
    mockPrisma.deal.count.mockResolvedValue(count)
    mockPrisma.deal.findMany.mockResolvedValue(rows)
    mockPrisma.contact.count.mockResolvedValue(count)
    mockPrisma.contact.findMany.mockResolvedValue(rows)
    mockPrisma.task.count.mockResolvedValue(count)
    mockPrisma.task.findMany.mockResolvedValue(rows)
    mockPrisma.activity.count.mockResolvedValue(count)
    mockPrisma.activity.findMany.mockResolvedValue(rows)
  }

  describe('preview — four-source dispatch and visibility composition', () => {
    it('dispatches CONTACTS to ContactsService.buildContactWhere', async () => {
      countAndRows(0, [])
      await service.preview('tenant-1', 'user-1', contactsConfig(), {})
      expect(mockContacts.buildContactWhere).toHaveBeenCalledWith('tenant-1', 'user-1', {})
      expect(mockPrisma.contact.count).toHaveBeenCalled()
    })

    it('dispatches DEALS to DealsService.buildDealWhere', async () => {
      countAndRows(0, [])
      await service.preview('tenant-1', 'user-1', dealsConfig(), {})
      expect(mockDeals.buildDealWhere).toHaveBeenCalledWith('tenant-1', 'user-1', {})
      expect(mockPrisma.deal.count).toHaveBeenCalled()
    })

    it('dispatches TASKS to TasksService.buildTaskWhere', async () => {
      countAndRows(0, [])
      await service.preview(
        'tenant-1',
        'user-1',
        {
          ...contactsConfig({ dataSource: 'TASKS' }),
          dimensions: [{ id: 'd', fieldId: 'task.assignee', calculation: null, granularity: null }],
          metrics: [{ id: 'm', fieldId: 'task.id', aggregation: 'COUNT', alias: 'count' }],
        },
        {},
      )
      expect(mockTasks.buildTaskWhere).toHaveBeenCalledWith('tenant-1', 'user-1', {})
      expect(mockPrisma.task.count).toHaveBeenCalled()
    })

    it('dispatches ACTIVITIES to ActivityService.buildFeedWhere', async () => {
      countAndRows(0, [])
      await service.preview(
        'tenant-1',
        'user-1',
        {
          ...contactsConfig({ dataSource: 'ACTIVITIES' }),
          dimensions: [{ id: 'd', fieldId: 'activity.type', calculation: null, granularity: null }],
          metrics: [{ id: 'm', fieldId: 'activity.id', aggregation: 'COUNT', alias: 'count' }],
        },
        {},
      )
      expect(mockActivities.buildFeedWhere).toHaveBeenCalledWith('tenant-1', 'user-1', {})
      expect(mockPrisma.activity.count).toHaveBeenCalled()
    })

    it('rejects invalid configs before any query runs', async () => {
      const bad = contactsConfig() as unknown as Record<string, unknown>
      ;(bad as Record<string, unknown>)['dataSource'] = 'INVOICES'
      await expect(
        service.preview('tenant-1', 'user-1', bad as unknown as CustomReportConfig, {}),
      ).rejects.toThrow(BadRequestException)
      expect(mockPrisma.contact.count).not.toHaveBeenCalled()
    })
  })

  describe('preview — filters and same-tenant relation validation', () => {
    it('narrows the scope with filter conditions', async () => {
      countAndRows(0, [])
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'user-9' }])
      const config = dealsConfig({
        filters: [
          {
            id: 'f-1',
            fieldId: 'deal.owner',
            operator: 'EQ',
            stringValue: 'user-9',
            numberValue: null,
            booleanValue: null,
            dateValue: null,
            stringValues: null,
            numberValues: null,
            dateValues: null,
          },
        ],
      })
      await service.preview('tenant-1', 'user-1', config, {})
      const where = mockPrisma.deal.count.mock.calls[0][0].where as Record<string, unknown>
      expect(where.AND).toEqual(
        expect.arrayContaining([expect.objectContaining({ ownerId: 'user-9' })]),
      )
    })

    it('rejects a filter owner from another tenant (no existence leak)', async () => {
      countAndRows(0, [])
      mockPrisma.user.findMany.mockResolvedValue([])
      const config = dealsConfig({
        filters: [
          {
            id: 'f-1',
            fieldId: 'deal.owner',
            operator: 'EQ',
            stringValue: 'foreign-user',
            numberValue: null,
            booleanValue: null,
            dateValue: null,
            stringValues: null,
            numberValues: null,
            dateValues: null,
          },
        ],
      })
      await expect(service.preview('tenant-1', 'user-1', config, {})).rejects.toThrow(
        BadRequestException,
      )
      expect(mockPrisma.deal.count).not.toHaveBeenCalled()
    })

    it('rejects a foreign stage id', async () => {
      countAndRows(0, [])
      mockPrisma.user.findMany.mockResolvedValue([])
      mockPrisma.dealStage.findMany.mockResolvedValue([])
      const config = dealsConfig({
        filters: [
          {
            id: 'f-1',
            fieldId: 'deal.stage',
            operator: 'EQ',
            stringValue: 'foreign-stage',
            numberValue: null,
            booleanValue: null,
            dateValue: null,
            stringValues: null,
            numberValues: null,
            dateValues: null,
          },
        ],
      })
      await expect(service.preview('tenant-1', 'user-1', config, {})).rejects.toThrow(
        BadRequestException,
      )
    })

    it('rejects foreign or missing tag ids for HAS_ANY/HAS_ALL', async () => {
      countAndRows(0, [])
      mockPrisma.tag.findMany.mockResolvedValue([])
      const config = contactsConfig({
        filters: [
          {
            id: 'f-1',
            fieldId: 'contact.tags',
            operator: 'HAS_ANY',
            stringValue: null,
            numberValue: null,
            booleanValue: null,
            dateValue: null,
            stringValues: ['tag-x'],
            numberValues: null,
            dateValues: null,
          },
        ],
      })
      await expect(service.preview('tenant-1', 'user-1', config, {})).rejects.toThrow(
        BadRequestException,
      )
    })

    it('rejects a task.deal filter id from another tenant (same-tenant validation)', async () => {
      countAndRows(0, [])
      mockPrisma.deal.findMany.mockResolvedValue([])
      const config = {
        ...contactsConfig({ dataSource: 'TASKS' }),
        dimensions: [{ id: 'd', fieldId: 'task.assignee', calculation: null, granularity: null }],
        metrics: [{ id: 'm', fieldId: 'task.id', aggregation: 'COUNT', alias: 'count' }],
        filters: [
          {
            id: 'f-1',
            fieldId: 'task.deal',
            operator: 'EQ',
            stringValue: 'foreign-deal',
            numberValue: null,
            booleanValue: null,
            dateValue: null,
            stringValues: null,
            numberValues: null,
            dateValues: null,
          },
        ],
      }
      await expect(service.preview('tenant-1', 'user-1', config, {})).rejects.toThrow(
        BadRequestException,
      )
      expect(mockPrisma.task.count).not.toHaveBeenCalled()
    })

    it('rejects a line-item field used as a dimension at validation — never reaches the executor', async () => {
      countAndRows(0, [])
      const config = dealsConfig({
        dimensions: [
          { id: 'd-li', fieldId: 'deal.lineItem.quantity', calculation: null, granularity: null },
        ],
      })
      await expect(service.preview('tenant-1', 'user-1', config, {})).rejects.toThrow(
        BadRequestException,
      )
      expect(mockPrisma.deal.count).not.toHaveBeenCalled()
    })

    it('rejects an unknown deal.status EQ value with a 400', async () => {
      countAndRows(0, [])
      const config = dealsConfig({
        filters: [
          {
            id: 'f-1',
            fieldId: 'deal.status',
            operator: 'EQ',
            stringValue: 'garbage',
            numberValue: null,
            booleanValue: null,
            dateValue: null,
            stringValues: null,
            numberValues: null,
            dateValues: null,
          },
        ],
      })
      await expect(service.preview('tenant-1', 'user-1', config, {})).rejects.toThrow(
        BadRequestException,
      )
      expect(mockPrisma.deal.count).not.toHaveBeenCalled()
    })

    it('rejects an unknown deal.status IN value with a 400', async () => {
      countAndRows(0, [])
      const config = dealsConfig({
        filters: [
          {
            id: 'f-1',
            fieldId: 'deal.status',
            operator: 'IN',
            stringValue: null,
            numberValue: null,
            booleanValue: null,
            dateValue: null,
            stringValues: ['WON', 'garbage'],
            numberValues: null,
            dateValues: null,
          },
        ],
      })
      await expect(service.preview('tenant-1', 'user-1', config, {})).rejects.toThrow(
        BadRequestException,
      )
      expect(mockPrisma.deal.count).not.toHaveBeenCalled()
    })
  })

  describe('preview — grouping, metrics and calculated fields', () => {
    it('groups by owner with COUNT and null owners under unassigned', async () => {
      countAndRows(2, [
        dealRow({
          id: 'd1',
          ownerId: 'user-1',
          owner: { id: 'user-1', firstName: 'Ada', lastName: 'Lovelace', teamId: null, team: null },
        }),
        dealRow({ id: 'd2', ownerId: 'system', owner: null }),
      ])
      const config = dealsConfig({
        dimensions: [
          { id: 'dim-owner', fieldId: 'deal.owner', calculation: null, granularity: null },
        ],
        metrics: [{ id: 'm', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'count' }],
      })
      const result = await service.preview('tenant-1', 'user-1', config, {})
      expect(result.totalRows).toBe(2)
      expect(result.rows.map((r) => r.key).sort()).toEqual(['unassigned', 'user-1'])
      const ownerRow = result.rows.find((r) => r.key === 'user-1')
      expect(ownerRow?.cells.find((c) => c.fieldId === 'dim-owner')?.stringValue).toBe(
        'Ada Lovelace',
      )
      expect(ownerRow?.cells.find((c) => c.fieldId === 'm')?.numberValue).toBe(1)
      const unassignedRow = result.rows.find((r) => r.key === 'unassigned')
      expect(unassignedRow?.cells.find((c) => c.fieldId === 'dim-owner')?.stringValue).toBe(
        'Unassigned',
      )
      expect(unassignedRow?.cells.find((c) => c.fieldId === 'm')?.numberValue).toBe(1)
    })

    it('computes COUNT, DISTINCT_COUNT, SUM, AVERAGE, MIN, MAX per group', async () => {
      countAndRows(3, [
        dealRow({ id: 'd1', value: 100, expectedCloseDate: new Date('2026-01-10T00:00:00Z') }),
        dealRow({ id: 'd2', value: 200, expectedCloseDate: new Date('2026-01-20T00:00:00Z') }),
        dealRow({ id: 'd3', value: 300, expectedCloseDate: new Date('2026-01-30T00:00:00Z') }),
      ])
      const config = dealsConfig({
        dimensions: [
          {
            id: 'dim-date',
            fieldId: 'deal.expectedCloseDate',
            calculation: null,
            granularity: 'MONTH',
          },
        ],
        metrics: [
          { id: 'm-count', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'count' },
          {
            id: 'm-distinct',
            fieldId: 'deal.currency',
            aggregation: 'DISTINCT_COUNT',
            alias: 'distinct',
          },
          { id: 'm-sum', fieldId: 'deal.value', aggregation: 'SUM', alias: 'sum' },
          { id: 'm-avg', fieldId: 'deal.value', aggregation: 'AVERAGE', alias: 'avg' },
          { id: 'm-min', fieldId: 'deal.value', aggregation: 'MIN', alias: 'min' },
          { id: 'm-max', fieldId: 'deal.value', aggregation: 'MAX', alias: 'max' },
        ],
      })
      const result = await service.preview('tenant-1', 'user-1', config, {})
      expect(result.rows).toHaveLength(1)
      const cells = new Map(result.rows[0].cells.map((c) => [c.fieldId, c]))
      expect(cells.get('m-count')?.numberValue).toBe(3)
      expect(cells.get('m-distinct')?.numberValue).toBe(1)
      expect(cells.get('m-sum')?.numberValue).toBe(600)
      expect(cells.get('m-avg')?.numberValue).toBe(200)
      expect(cells.get('m-min')?.numberValue).toBe(100)
      expect(cells.get('m-max')?.numberValue).toBe(300)
      expect(cells.get('dim-date')?.dateValue).toBe('2026-01-01')
    })

    it('returns null for SUM when every numeric input in the group is null (Contract A.7)', async () => {
      countAndRows(2, [dealRow({ id: 'd1', value: null }), dealRow({ id: 'd2', value: null })])
      const result = await service.preview('tenant-1', 'user-1', dealsConfig(), {})
      expect(result.rows).toHaveLength(1)
      const cells = new Map(result.rows[0].cells.map((c) => [c.fieldId, c]))
      expect(cells.get('metric-value')?.isNull).toBe(true)
      expect(cells.get('metric-value')?.numberValue).toBeNull()
      // COUNT of records stays the row count — only the numeric aggregate is nulled.
      expect(cells.get('metric-deals')?.numberValue).toBe(2)
    })

    it('returns COUNT 0 and null numerics for an empty scope', async () => {
      countAndRows(0, [])
      const result = await service.preview('tenant-1', 'user-1', dealsConfig(), {})
      expect(result.totalRows).toBe(0)
      expect(result.rows).toEqual([])
      expect(result.columns.length).toBeGreaterThan(0)
      expect(result.truncated).toBe(false)
    })

    it('evaluates calculated metrics from base aliases with rounding', async () => {
      countAndRows(2, [dealRow({ id: 'd1', value: 1000 }), dealRow({ id: 'd2', value: 2000 })])
      const config = dealsConfig({
        calculatedFields: [
          {
            id: 'calc-avg',
            alias: 'avg_deal_size',
            label: 'Avg deal size',
            expression: 'revenue / deals',
          },
        ],
      })
      const result = await service.preview('tenant-1', 'user-1', config, {})
      expect(result.rows[0].cells.find((c) => c.fieldId === 'calc-avg')?.numberValue).toBe(1500)
    })

    it('turns division by zero into null plus a warning — never Infinity/NaN', async () => {
      countAndRows(2, [dealRow({ id: 'd1', value: 0 }), dealRow({ id: 'd2', value: 0 })])
      const config = dealsConfig({
        metrics: [{ id: 'm-sum', fieldId: 'deal.value', aggregation: 'SUM', alias: 'revenue' }],
        calculatedFields: [{ id: 'calc-x', alias: 'x', label: null, expression: '100 / revenue' }],
      })
      const result = await service.preview('tenant-1', 'user-1', config, {})
      expect(result.rows[0].cells.find((c) => c.fieldId === 'calc-x')?.isNull).toBe(true)
      expect(result.warnings.some((w) => w.code === 'DIVISION_BY_ZERO')).toBe(true)
    })

    it('groups by derived deal status OPEN|WON|LOST', async () => {
      countAndRows(2, [
        dealRow({
          id: 'd1',
          stage: { id: 's-won', name: 'Won', order: 3, isWon: true, isLost: false },
        }),
        dealRow({
          id: 'd2',
          stage: { id: 's-open', name: 'Open', order: 1, isWon: false, isLost: false },
        }),
      ])
      const config = dealsConfig({
        dimensions: [
          { id: 'dim-status', fieldId: 'deal.status', calculation: null, granularity: null },
        ],
        metrics: [{ id: 'm', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'count' }],
      })
      const result = await service.preview('tenant-1', 'user-1', config, {})
      expect(result.rows.map((r) => r.key).sort()).toEqual(['OPEN', 'WON'])
    })

    it('groups tags into one group per tag and untagged under Unassigned', async () => {
      countAndRows(2, [
        contactRow({
          id: 'c1',
          tags: [{ tag: { id: 't1', name: 'VIP' } }, { tag: { id: 't2', name: 'New' } }],
        }),
        contactRow({ id: 'c2', tags: [] }),
      ])
      const config = contactsConfig({
        dimensions: [
          { id: 'dim-tags', fieldId: 'contact.tags', calculation: null, granularity: null },
        ],
      })
      const result = await service.preview('tenant-1', 'user-1', config, {})
      expect(result.rows.map((r) => r.key).sort()).toEqual(['t1', 't2', 'unassigned'])
      const t1 = result.rows.find((r) => r.key === 't1')
      expect(t1?.cells.find((c) => c.fieldId === 'dim-tags')?.stringValue).toBe('VIP')
    })

    it('aggregates active line-item metrics per deal', async () => {
      countAndRows(1, [
        dealRow({
          id: 'd1',
          lineItems: [
            {
              productId: 'p1',
              quantity: 2,
              discount: 10,
              total: 1800,
              product: { id: 'p1', name: 'CRM', isActive: true, deletedAt: null },
            },
            {
              productId: 'p2',
              quantity: 1,
              discount: 0,
              total: 500,
              product: { id: 'p2', name: 'API', isActive: true, deletedAt: null },
            },
          ],
        }),
      ])
      const config = dealsConfig({
        metrics: [
          { id: 'm-total', fieldId: 'deal.lineItem.total', aggregation: 'SUM', alias: 'total' },
          { id: 'm-qty', fieldId: 'deal.lineItem.quantity', aggregation: 'SUM', alias: 'qty' },
          {
            id: 'm-lines',
            fieldId: 'deal.lineItem.quantity',
            aggregation: 'COUNT',
            alias: 'lines',
          },
        ],
      })
      const result = await service.preview('tenant-1', 'user-1', config, {})
      const cells = new Map(result.rows[0].cells.map((c) => [c.fieldId, c]))
      expect(cells.get('m-total')?.numberValue).toBe(2300)
      expect(cells.get('m-qty')?.numberValue).toBe(3)
      expect(cells.get('m-lines')?.numberValue).toBe(2)
    })
  })

  describe('preview — money no-FX behavior (Contract A.7)', () => {
    it('nulls money metrics with a warning when currencies are mixed', async () => {
      countAndRows(2, [
        dealRow({ id: 'd1', currency: 'USD', value: 1000 }),
        dealRow({ id: 'd2', currency: 'EUR', value: 2000 }),
      ])
      mockPrisma.deal.groupBy.mockResolvedValue([
        { currency: 'USD', _count: { _all: 1 } },
        { currency: 'EUR', _count: { _all: 1 } },
      ])
      const result = await service.preview('tenant-1', 'user-1', dealsConfig(), {})
      expect(result.rows).toHaveLength(1)
      const revenue = result.rows[0].cells.find((c) => c.fieldId === 'metric-value')
      expect(revenue?.isNull).toBe(true)
      expect(result.warnings.some((w) => w.code === 'MIXED_CURRENCY')).toBe(true)
    })

    it('keeps money values when a currency filter is applied', async () => {
      countAndRows(2, [
        dealRow({ id: 'd1', currency: 'USD', value: 1000 }),
        dealRow({ id: 'd2', currency: 'USD', value: 2000 }),
      ])
      mockPrisma.deal.groupBy.mockResolvedValue([{ currency: 'USD', _count: { _all: 2 } }])
      const config = dealsConfig({
        filters: [
          {
            id: 'f-1',
            fieldId: 'deal.currency',
            operator: 'EQ',
            stringValue: 'USD',
            numberValue: null,
            booleanValue: null,
            dateValue: null,
            stringValues: null,
            numberValues: null,
            dateValues: null,
          },
        ],
      })
      const result = await service.preview('tenant-1', 'user-1', config, {})
      expect(result.rows[0].cells.find((c) => c.fieldId === 'metric-value')?.numberValue).toBe(3000)
      expect(result.warnings.some((w) => w.code === 'MIXED_CURRENCY')).toBe(false)
    })

    it('keeps money values when grouping by currency', async () => {
      countAndRows(2, [
        dealRow({ id: 'd1', currency: 'USD', value: 1000 }),
        dealRow({ id: 'd2', currency: 'EUR', value: 2000 }),
      ])
      const config = dealsConfig({
        dimensions: [
          { id: 'dim-cur', fieldId: 'deal.currency', calculation: null, granularity: null },
        ],
      })
      const result = await service.preview('tenant-1', 'user-1', config, {})
      expect(result.totalRows).toBe(2)
      const usd = result.rows.find((r) => r.key === 'USD')
      const eur = result.rows.find((r) => r.key === 'EUR')
      expect(usd?.cells.find((c) => c.fieldId === 'metric-value')?.numberValue).toBe(1000)
      expect(eur?.cells.find((c) => c.fieldId === 'metric-value')?.numberValue).toBe(2000)
    })

    it('does not treat a NOT_EQ currency filter as pinning — mixed currencies still warn', async () => {
      countAndRows(2, [
        dealRow({ id: 'd1', currency: 'EUR', value: 2000 }),
        dealRow({ id: 'd2', currency: 'GBP', value: 3000 }),
      ])
      mockPrisma.deal.groupBy.mockResolvedValue([
        { currency: 'EUR', _count: { _all: 1 } },
        { currency: 'GBP', _count: { _all: 1 } },
      ])
      const config = dealsConfig({
        filters: [
          {
            id: 'f-1',
            fieldId: 'deal.currency',
            operator: 'NOT_EQ',
            stringValue: 'USD',
            numberValue: null,
            booleanValue: null,
            dateValue: null,
            stringValues: null,
            numberValues: null,
            dateValues: null,
          },
        ],
      })
      const result = await service.preview('tenant-1', 'user-1', config, {})
      expect(result.rows[0].cells.find((c) => c.fieldId === 'metric-value')?.isNull).toBe(true)
      expect(result.warnings.some((w) => w.code === 'MIXED_CURRENCY')).toBe(true)
    })

    it('does not treat a multi-value IN currency filter as pinning — mixed currencies still warn', async () => {
      countAndRows(2, [
        dealRow({ id: 'd1', currency: 'USD', value: 1000 }),
        dealRow({ id: 'd2', currency: 'EUR', value: 2000 }),
      ])
      mockPrisma.deal.groupBy.mockResolvedValue([
        { currency: 'USD', _count: { _all: 1 } },
        { currency: 'EUR', _count: { _all: 1 } },
      ])
      const config = dealsConfig({
        filters: [
          {
            id: 'f-1',
            fieldId: 'deal.currency',
            operator: 'IN',
            stringValue: null,
            numberValue: null,
            booleanValue: null,
            dateValue: null,
            stringValues: ['USD', 'EUR'],
            numberValues: null,
            dateValues: null,
          },
        ],
      })
      const result = await service.preview('tenant-1', 'user-1', config, {})
      expect(result.rows[0].cells.find((c) => c.fieldId === 'metric-value')?.isNull).toBe(true)
      expect(result.warnings.some((w) => w.code === 'MIXED_CURRENCY')).toBe(true)
    })

    it('treats a single-value IN currency filter as pinning — no warning', async () => {
      countAndRows(2, [
        dealRow({ id: 'd1', currency: 'USD', value: 1000 }),
        dealRow({ id: 'd2', currency: 'USD', value: 2000 }),
      ])
      mockPrisma.deal.groupBy.mockResolvedValue([{ currency: 'USD', _count: { _all: 2 } }])
      const config = dealsConfig({
        filters: [
          {
            id: 'f-1',
            fieldId: 'deal.currency',
            operator: 'IN',
            stringValue: null,
            numberValue: null,
            booleanValue: null,
            dateValue: null,
            stringValues: ['USD'],
            numberValues: null,
            dateValues: null,
          },
        ],
      })
      const result = await service.preview('tenant-1', 'user-1', config, {})
      expect(result.rows[0].cells.find((c) => c.fieldId === 'metric-value')?.numberValue).toBe(3000)
      expect(result.warnings.some((w) => w.code === 'MIXED_CURRENCY')).toBe(false)
    })
  })

  describe('preview — bounds, pagination and deterministic ordering', () => {
    it('fails explicitly when the scope exceeds the row cap', async () => {
      countAndRows(MAX_CUSTOM_SCOPE_ROWS + 1, [])
      await expect(service.preview('tenant-1', 'user-1', dealsConfig(), {})).rejects.toThrow(
        /narrow your filters or date range/,
      )
      expect(mockPrisma.deal.findMany).not.toHaveBeenCalled()
    })

    it('fails explicitly when grouping produces more than MAX_GROUPED_ROWS groups', async () => {
      const rows = Array.from({ length: MAX_GROUPED_ROWS + 1 }, (_, i) =>
        dealRow({
          id: `d${i}`,
          stageId: `stage-${i}`,
          stage: { id: `stage-${i}`, name: `S${i}`, order: i, isWon: false, isLost: false },
        }),
      )
      countAndRows(rows.length, rows)
      const config = dealsConfig({
        metrics: [{ id: 'm', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'count' }],
      })
      await expect(service.preview('tenant-1', 'user-1', config, {})).rejects.toThrow(
        /narrow your filters or date range/,
      )
    })

    it('defaults to page 1/pageSize 50 and clamps pageSize to 100', async () => {
      const rows = Array.from({ length: 120 }, (_, i) =>
        dealRow({
          id: `d${i}`,
          stageId: `stage-${i}`,
          stage: { id: `stage-${i}`, name: `S${i}`, order: i, isWon: false, isLost: false },
        }),
      )
      countAndRows(rows.length, rows)
      const config = dealsConfig({
        metrics: [{ id: 'm', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'count' }],
      })
      const result = await service.preview('tenant-1', 'user-1', config, {})
      expect(result.pagination).toEqual({ page: 1, pageSize: 50, totalPages: 3 })
      expect(result.rows).toHaveLength(50)
      expect(result.totalRows).toBe(120)
      const secondPage = await service.preview('tenant-1', 'user-1', config, {
        page: 2,
        pageSize: 10,
      })
      expect(secondPage.pagination).toEqual({ page: 2, pageSize: 10, totalPages: 12 })
      expect(secondPage.rows).toHaveLength(10)
      expect(secondPage.totalRows).toBe(120)
    })

    it('applies sorts in declared priority with nulls last and a deterministic tiebreaker', async () => {
      countAndRows(3, [
        dealRow({
          id: 'd1',
          stageId: 's-a',
          value: 100,
          stage: { id: 's-a', name: 'A', order: 1, isWon: false, isLost: false },
        }),
        dealRow({
          id: 'd2',
          stageId: 's-b',
          value: 300,
          stage: { id: 's-b', name: 'B', order: 2, isWon: false, isLost: false },
        }),
        dealRow({
          id: 'd3',
          stageId: 's-c',
          value: 200,
          stage: { id: 's-c', name: 'C', order: 3, isWon: false, isLost: false },
        }),
      ])
      const config = dealsConfig({
        metrics: [{ id: 'm', fieldId: 'deal.value', aggregation: 'SUM', alias: 'sum' }],
        sort: [{ id: 's-1', targetId: 'm', direction: 'DESC' }],
      })
      const result = await service.preview('tenant-1', 'user-1', config, {})
      expect(result.rows.map((r) => r.key)).toEqual(['s-b', 's-c', 's-a'])
    })

    it('produces identical output for identical data and config (determinism)', async () => {
      countAndRows(2, [dealRow({ id: 'd1', value: 100 }), dealRow({ id: 'd2', value: 200 })])
      const config = dealsConfig()
      const a = await service.preview('tenant-1', 'user-1', config, {})
      const b = await service.preview('tenant-1', 'user-1', config, {})
      expect(a).toEqual(b)
    })

    it('captures generatedAt once per execution', async () => {
      countAndRows(0, [])
      const result = await service.preview('tenant-1', 'user-1', dealsConfig(), {})
      expect(result.generatedAt).toBe(NOW.toISOString())
    })
  })

  describe('saveCustomReport — persistence, ownership, limits and audit', () => {
    const VALID_INPUT = {
      name: 'My report',
      config: dealsConfig(),
      isPublic: false,
    }

    it('creates a CUSTOM report row and writes exactly one CREATE audit row', async () => {
      mockPrisma.report.create.mockResolvedValue({
        id: 'report-1',
        tenantId: 'tenant-1',
        name: 'My report',
        type: 'CUSTOM',
        config: dealsConfig(),
        createdBy: 'user-1',
        isPublic: false,
        createdAt: NOW,
        updatedAt: NOW,
        updatedBy: 'user-1',
        deletedAt: null,
      })
      const result = await service.saveCustomReport('tenant-1', 'user-1', VALID_INPUT)
      expect(result.id).toBe('report-1')
      const createCall = mockPrisma.report.create.mock.calls[0][0]
      expect(createCall.data.type).toBe('CUSTOM')
      expect(createCall.data.createdBy).toBe('user-1')
      expect(createCall.data.updatedBy).toBe('user-1')
      expect(createCall.data.name).toBe('My report')
      expect(mockAudit.log).toHaveBeenCalledTimes(1)
      expect(mockAudit.log.mock.calls[0][0].action).toBe('CREATE')
      expect(mockAudit.log.mock.calls[0][0].entity).toBe('REPORT')
    })

    it('enforces the shared 50-active limit through SalesReportsService', async () => {
      mockSales.assertUnderActiveLimit.mockRejectedValue(
        new BadRequestException(
          `You cannot have more than ${MAX_ACTIVE_REPORTS_PER_CREATOR} reports`,
        ),
      )
      await expect(service.saveCustomReport('tenant-1', 'user-1', VALID_INPUT)).rejects.toThrow(
        BadRequestException,
      )
      expect(mockPrisma.report.create).not.toHaveBeenCalled()
    })

    it('propagates the shared case-insensitive name conflict', async () => {
      mockSales.assertNameAvailable.mockRejectedValue(
        new ConflictException('A report with this name already exists'),
      )
      await expect(service.saveCustomReport('tenant-1', 'user-1', VALID_INPUT)).rejects.toThrow(
        ConflictException,
      )
      expect(mockPrisma.report.create).not.toHaveBeenCalled()
    })

    it('updates the creator-owned active CUSTOM row on the same id', async () => {
      mockPrisma.report.findFirst.mockResolvedValue({
        id: 'report-1',
        tenantId: 'tenant-1',
        name: 'Old name',
        type: 'CUSTOM',
        config: dealsConfig(),
        createdBy: 'user-1',
        isPublic: false,
        createdAt: NOW,
        updatedAt: NOW,
        updatedBy: 'user-1',
        deletedAt: null,
      })
      mockPrisma.report.update.mockResolvedValue({
        id: 'report-1',
        tenantId: 'tenant-1',
        name: 'New name',
        type: 'CUSTOM',
        config: dealsConfig(),
        createdBy: 'user-1',
        isPublic: true,
        createdAt: NOW,
        updatedAt: NOW,
        updatedBy: 'user-1',
        deletedAt: null,
      })
      const result = await service.saveCustomReport('tenant-1', 'user-1', {
        ...VALID_INPUT,
        reportId: 'report-1',
        name: 'New name',
        isPublic: true,
      })
      expect(result.id).toBe('report-1')
      expect(mockPrisma.report.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'report-1',
            tenantId: 'tenant-1',
            createdBy: 'user-1',
            type: 'CUSTOM',
            deletedAt: null,
          }),
        }),
      )
      expect(mockPrisma.report.update.mock.calls[0][0].where.id).toBe('report-1')
      expect(mockAudit.log).toHaveBeenCalledTimes(1)
      expect(mockAudit.log.mock.calls[0][0].action).toBe('UPDATE')
    })

    it('fails with Report not found for missing/private/cross-tenant/wrong-type ids', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(null)
      await expect(
        service.saveCustomReport('tenant-1', 'user-1', { ...VALID_INPUT, reportId: 'nope' }),
      ).rejects.toThrow('Report not found')
      expect(mockPrisma.report.update).not.toHaveBeenCalled()
    })

    it('does not write an audit row on update when the report is not found', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(null)
      await expect(
        service.saveCustomReport('tenant-1', 'user-1', { ...VALID_INPUT, reportId: 'nope' }),
      ).rejects.toThrow(NotFoundException)
      expect(mockAudit.log).not.toHaveBeenCalled()
    })

    it('rejects invalid names', async () => {
      await expect(
        service.saveCustomReport('tenant-1', 'user-1', { ...VALID_INPUT, name: '   ' }),
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.saveCustomReport('tenant-1', 'user-1', { ...VALID_INPUT, name: 'x'.repeat(121) }),
      ).rejects.toThrow(BadRequestException)
      expect(mockPrisma.report.create).not.toHaveBeenCalled()
    })
  })

  describe('customReportData — saved execution', () => {
    it('loads the saved CUSTOM report, executes and reports the reportId', async () => {
      mockPrisma.report.findFirst.mockResolvedValue({
        id: 'report-1',
        tenantId: 'tenant-1',
        name: 'Saved',
        type: 'CUSTOM',
        config: dealsConfig(),
        createdBy: 'user-1',
        isPublic: false,
        createdAt: NOW,
        updatedAt: NOW,
        updatedBy: 'user-1',
        deletedAt: null,
      })
      countAndRows(0, [])
      const result = await service.customReportData('tenant-1', 'user-1', 'report-1', {})
      expect(result.reportId).toBe('report-1')
    })

    it('fails with Report not found for non-existent or private reports', async () => {
      mockPrisma.report.findFirst.mockResolvedValue(null)
      await expect(service.customReportData('tenant-1', 'user-1', 'nope', {})).rejects.toThrow(
        'Report not found',
      )
    })

    it('fails explicitly on corrupt persisted config — never a silent rewrite', async () => {
      mockPrisma.report.findFirst.mockResolvedValue({
        id: 'report-1',
        tenantId: 'tenant-1',
        name: 'Corrupt',
        type: 'CUSTOM',
        config: { version: 1, dataSource: 'INVOICES' },
        createdBy: 'user-1',
        isPublic: false,
        createdAt: NOW,
        updatedAt: NOW,
        updatedBy: 'user-1',
        deletedAt: null,
      })
      await expect(service.customReportData('tenant-1', 'user-1', 'report-1', {})).rejects.toThrow(
        BadRequestException,
      )
    })

    it('resolves the data source for the permission gate', async () => {
      mockPrisma.report.findFirst.mockResolvedValue({
        id: 'report-1',
        tenantId: 'tenant-1',
        name: 'Saved',
        type: 'CUSTOM',
        config: dealsConfig(),
        createdBy: 'user-1',
        isPublic: false,
        createdAt: NOW,
        updatedAt: NOW,
        updatedBy: 'user-1',
        deletedAt: null,
      })
      await expect(service.resolveReportDataSource('tenant-1', 'user-1', 'report-1')).resolves.toBe(
        'DEALS',
      )
    })
  })

  describe('preview audit hygiene', () => {
    it('never writes an audit row for previews', async () => {
      countAndRows(0, [])
      mockPrisma.report.findFirst.mockResolvedValue({ id: 'report-1', config: dealsConfig() })
      await service.preview('tenant-1', 'user-1', dealsConfig(), {})
      await service.customReportData('tenant-1', 'user-1', 'report-1', {})
      expect(mockAudit.log).not.toHaveBeenCalled()
    })
  })

  describe('catalogue ↔ executor consistency', () => {
    it('every advertised metric field is executable for its source', async () => {
      for (const dataSource of ['CONTACTS', 'DEALS', 'TASKS', 'ACTIVITIES'] as const) {
        const fields = CUSTOM_REPORT_CATALOGS[dataSource].fields
        const metricFields = fields.filter((f) => f.roles.includes('METRIC'))
        expect(metricFields.length).toBeGreaterThan(0)
        for (const field of metricFields) {
          const aggregation =
            field.isNumeric && field.aggregations.includes('SUM') ? 'SUM' : 'COUNT'
          const dimField = fields.find((f) => f.roles.includes('DIMENSION'))
          const dimId = dimField?.key
          if (!dimId) continue
          const config = {
            version: 1,
            dataSource,
            filters: [],
            dimensions: [
              {
                id: 'd-1',
                fieldId: dimId,
                calculation: null,
                granularity: dimField?.isDate ? 'MONTH' : null,
              },
            ],
            metrics: [{ id: 'm-1', fieldId: field.key, aggregation, alias: 'm' }],
            calculatedFields: [],
            visualization: { type: 'TABLE' },
            sort: [],
          }
          countAndRows(1, sourceRowFor(dataSource))
          const result = await service.preview('tenant-1', 'user-1', config, {})
          expect(result.columns.some((c) => c.fieldId === 'm-1')).toBe(true)
        }
      }
    })
  })

  function sourceRowFor(
    dataSource: 'CONTACTS' | 'DEALS' | 'TASKS' | 'ACTIVITIES',
  ): Record<string, unknown>[] {
    if (dataSource === 'DEALS') return [dealRow()]
    if (dataSource === 'TASKS') return [taskRow()]
    if (dataSource === 'ACTIVITIES') return [activityRow()]
    return [contactRow()]
  }

  // ─── Filter-condition matrix (Contract A.5 coverage) ──────────────────────

  describe('preview — filter condition builder for every catalogue field', () => {
    function allowAllRelationIds(): void {
      for (const delegate of [
        mockPrisma.user,
        mockPrisma.team,
        mockPrisma.dealStage,
        mockPrisma.tag,
        mockPrisma.product,
        mockPrisma.contact,
        mockPrisma.deal,
      ]) {
        delegate.findMany.mockImplementation(
          (args: { where: { id?: string | { in?: string[] } } }) => {
            const idArg = args.where.id
            const ids = typeof idArg === 'string' ? [idArg] : idArg?.in ?? []
            return Promise.resolve(ids.map((id) => ({ id })))
          },
        )
      }
    }

    async function previewWhere(config: CustomReportConfig): Promise<Record<string, unknown>> {
      countAndRows(0, [])
      // countAndRows clobbers the findMany implementations — restore the
      // relation-id pass-through AFTER it.
      allowAllRelationIds()
      await service.preview('tenant-1', 'user-1', config, {})
      const delegate =
        config.dataSource === 'CONTACTS'
          ? mockPrisma.contact
          : config.dataSource === 'DEALS'
            ? mockPrisma.deal
            : config.dataSource === 'TASKS'
              ? mockPrisma.task
              : mockPrisma.activity
      return delegate.count.mock.calls[0][0].where
    }

    function filterCase(
      source: 'CONTACTS' | 'DEALS' | 'TASKS' | 'ACTIVITIES',
      fieldId: string,
      operator: string,
      slots: Record<string, unknown>,
      expected: Record<string, unknown>,
    ): void {
      it(`builds ${source} filter ${fieldId} ${operator}`, async () => {
        allowAllRelationIds()
        const base =
          source === 'DEALS'
            ? dealsConfig()
            : ({
                ...contactsConfig(),
                dataSource: source,
                dimensions:
                  source === 'TASKS'
                    ? [{ id: 'd', fieldId: 'task.assignee', calculation: null, granularity: null }]
                    : source === 'ACTIVITIES'
                      ? [
                          {
                            id: 'd',
                            fieldId: 'activity.type',
                            calculation: null,
                            granularity: null,
                          },
                        ]
                      : contactsConfig().dimensions,
                metrics:
                  source === 'TASKS'
                    ? [{ id: 'm', fieldId: 'task.id', aggregation: 'COUNT', alias: 'm' }]
                    : source === 'ACTIVITIES'
                      ? [{ id: 'm', fieldId: 'activity.id', aggregation: 'COUNT', alias: 'm' }]
                      : contactsConfig().metrics,
              } as CustomReportConfig)
        const config = {
          ...base,
          filters: [
            {
              id: 'f-1',
              fieldId,
              operator,
              stringValue: null,
              numberValue: null,
              booleanValue: null,
              dateValue: null,
              stringValues: null,
              numberValues: null,
              dateValues: null,
              ...slots,
            },
          ],
        } as CustomReportConfig
        const where = await previewWhere(config)
        expect(where.AND).toEqual(expect.arrayContaining([expected]))
      })
    }

    // CONTACTS
    filterCase('CONTACTS', 'contact.id', 'EQ', { stringValue: 'c-1' }, { id: 'c-1' })
    filterCase(
      'CONTACTS',
      'contact.createdAt',
      'ON',
      { dateValue: '2026-01-01' },
      {
        createdAt: {
          gte: new Date('2026-01-01T00:00:00.000Z'),
          lte: new Date('2026-01-01T23:59:59.999Z'),
        },
      },
    )
    filterCase(
      'CONTACTS',
      'contact.updatedAt',
      'BETWEEN',
      { dateValues: ['2026-01-01', '2026-01-31'] },
      {
        updatedAt: {
          gte: new Date('2026-01-01T00:00:00.000Z'),
          lte: new Date('2026-01-31T23:59:59.999Z'),
        },
      },
    )
    filterCase(
      'CONTACTS',
      'contact.owner',
      'NOT_EQ',
      { stringValue: 'user-1' },
      { ownerId: { not: 'user-1' } },
    )
    filterCase(
      'CONTACTS',
      'contact.team',
      'IN',
      { stringValues: ['t1', 't2'] },
      { teamId: { in: ['t1', 't2'] } },
    )
    filterCase(
      'CONTACTS',
      'contact.company',
      'CONTAINS',
      { stringValue: 'Acme' },
      { company: { contains: 'Acme', mode: 'insensitive' } },
    )
    filterCase('CONTACTS', 'contact.jobTitle', 'EQ', { stringValue: 'CTO' }, { jobTitle: 'CTO' })
    filterCase(
      'CONTACTS',
      'contact.addressCity',
      'EQ',
      { stringValue: 'NYC' },
      { addressCity: 'NYC' },
    )
    filterCase(
      'CONTACTS',
      'contact.addressCountry',
      'EQ',
      { stringValue: 'US' },
      { addressCountry: 'US' },
    )
    filterCase(
      'CONTACTS',
      'contact.department',
      'EQ',
      { stringValue: 'Eng' },
      { department: 'Eng' },
    )
    filterCase('CONTACTS', 'contact.timezone', 'EQ', { stringValue: 'UTC' }, { timezone: 'UTC' })
    filterCase('CONTACTS', 'contact.language', 'EQ', { stringValue: 'en' }, { language: 'en' })
    filterCase('CONTACTS', 'contact.source', 'EQ', { stringValue: 'Event' }, { source: 'Event' })
    filterCase(
      'CONTACTS',
      'contact.tags',
      'HAS_ANY',
      { stringValues: ['t1'] },
      { tags: { some: { tagId: { in: ['t1'] } } } },
    )
    filterCase(
      'CONTACTS',
      'contact.tags',
      'HAS_ALL',
      { stringValues: ['t1', 't2'] },
      { AND: [{ tags: { some: { tagId: 't1' } } }, { tags: { some: { tagId: 't2' } } }] },
    )

    // DEALS
    filterCase('DEALS', 'deal.id', 'EQ', { stringValue: 'd-1' }, { id: 'd-1' })
    filterCase(
      'DEALS',
      'deal.createdAt',
      'BEFORE',
      { dateValue: '2026-01-01' },
      { createdAt: { lt: new Date('2026-01-01T00:00:00.000Z') } },
    )
    filterCase(
      'DEALS',
      'deal.updatedAt',
      'AFTER',
      { dateValue: '2026-01-01' },
      { updatedAt: { gt: new Date('2026-01-01T23:59:59.999Z') } },
    )
    filterCase(
      'DEALS',
      'deal.expectedCloseDate',
      'BETWEEN',
      { dateValues: ['2026-01-01', '2026-01-31'] },
      {
        expectedCloseDate: {
          gte: new Date('2026-01-01T00:00:00.000Z'),
          lte: new Date('2026-01-31T23:59:59.999Z'),
        },
      },
    )
    filterCase(
      'DEALS',
      'deal.actualCloseDate',
      'ON',
      { dateValue: '2026-01-01' },
      {
        actualCloseDate: {
          gte: new Date('2026-01-01T00:00:00.000Z'),
          lte: new Date('2026-01-01T23:59:59.999Z'),
        },
      },
    )
    filterCase(
      'DEALS',
      'deal.owner',
      'IN',
      { stringValues: ['u1', 'u2'] },
      { ownerId: { in: ['u1', 'u2'] } },
    )
    filterCase(
      'DEALS',
      'deal.ownerTeam',
      'EQ',
      { stringValue: 'team-1' },
      { owner: { teamId: 'team-1' } },
    )
    filterCase('DEALS', 'deal.stage', 'NOT_EQ', { stringValue: 's-1' }, { stageId: { not: 's-1' } })
    filterCase('DEALS', 'deal.status', 'EQ', { stringValue: 'WON' }, { stage: { isWon: true } })
    filterCase(
      'DEALS',
      'deal.status',
      'EQ',
      { stringValue: 'OPEN' },
      { stage: { isWon: false, isLost: false } },
    )
    filterCase(
      'DEALS',
      'deal.status',
      'NOT_EQ',
      { stringValue: 'OPEN' },
      { stage: { OR: [{ isWon: true }, { isLost: true }] } },
    )
    filterCase(
      'DEALS',
      'deal.status',
      'IN',
      { stringValues: ['WON', 'LOST'] },
      { stage: { OR: [{ stage: { isWon: true } }, { stage: { isLost: true } }] } },
    )
    filterCase('DEALS', 'deal.contact', 'EQ', { stringValue: 'c-1' }, { contactId: 'c-1' })
    filterCase('DEALS', 'deal.currency', 'EQ', { stringValue: 'USD' }, { currency: 'USD' })
    filterCase(
      'DEALS',
      'deal.product',
      'EQ',
      { stringValue: 'p-1' },
      {
        lineItems: {
          some: { productId: 'p-1', deletedAt: null, product: { isActive: true, deletedAt: null } },
        },
      },
    )
    filterCase('DEALS', 'deal.value', 'GT', { numberValue: 1000 }, { value: { gt: 1000 } })
    filterCase('DEALS', 'deal.value', 'GTE', { numberValue: 1000 }, { value: { gte: 1000 } })
    filterCase('DEALS', 'deal.value', 'LT', { numberValue: 1000 }, { value: { lt: 1000 } })
    filterCase('DEALS', 'deal.value', 'LTE', { numberValue: 1000 }, { value: { lte: 1000 } })
    filterCase(
      'DEALS',
      'deal.value',
      'BETWEEN',
      { numberValues: [100, 500] },
      { value: { gte: 100, lte: 500 } },
    )
    filterCase(
      'DEALS',
      'deal.probability',
      'EQ',
      { numberValue: 50 },
      { probability: { equals: 50 } },
    )

    // TASKS
    filterCase('TASKS', 'task.id', 'EQ', { stringValue: 't-1' }, { id: 't-1' })
    filterCase(
      'TASKS',
      'task.dueDate',
      'ON',
      { dateValue: '2026-02-01' },
      {
        dueDate: {
          gte: new Date('2026-02-01T00:00:00.000Z'),
          lte: new Date('2026-02-01T23:59:59.999Z'),
        },
      },
    )
    filterCase(
      'TASKS',
      'task.completedAt',
      'BEFORE',
      { dateValue: '2026-01-01' },
      { completedAt: { lt: new Date('2026-01-01T00:00:00.000Z') } },
    )
    filterCase('TASKS', 'task.assignee', 'EQ', { stringValue: 'u-1' }, { assignedTo: 'u-1' })
    filterCase(
      'TASKS',
      'task.assigneeTeam',
      'EQ',
      { stringValue: 'team-1' },
      { assignee: { teamId: 'team-1' } },
    )
    filterCase('TASKS', 'task.status', 'EQ', { stringValue: 'TODO' }, { status: 'TODO' })
    filterCase(
      'TASKS',
      'task.priority',
      'IN',
      { stringValues: ['HIGH', 'LOW'] },
      { priority: { in: ['HIGH', 'LOW'] } },
    )
    filterCase('TASKS', 'task.contact', 'EQ', { stringValue: 'c-1' }, { contactId: 'c-1' })
    filterCase('TASKS', 'task.deal', 'EQ', { stringValue: 'd-1' }, { dealId: 'd-1' })
    filterCase('TASKS', 'task.isRecurring', 'EQ', { booleanValue: true }, { isRecurring: true })
    filterCase(
      'TASKS',
      'task.recurrencePattern',
      'EQ',
      { stringValue: 'WEEKLY' },
      { recurrencePattern: 'WEEKLY' },
    )

    // ACTIVITIES
    filterCase('ACTIVITIES', 'activity.id', 'EQ', { stringValue: 'a-1' }, { id: 'a-1' })
    filterCase(
      'ACTIVITIES',
      'activity.createdAt',
      'ON',
      { dateValue: '2026-01-01' },
      {
        createdAt: {
          gte: new Date('2026-01-01T00:00:00.000Z'),
          lte: new Date('2026-01-01T23:59:59.999Z'),
        },
      },
    )
    filterCase(
      'ACTIVITIES',
      'activity.type',
      'EQ',
      { stringValue: 'CALL_MADE' },
      { type: 'CALL_MADE' },
    )
    filterCase(
      'ACTIVITIES',
      'activity.source',
      'CONTAINS',
      { stringValue: 'TASK' },
      { source: { contains: 'TASK', mode: 'insensitive' } },
    )
    filterCase('ACTIVITIES', 'activity.creator', 'EQ', { stringValue: 'u-1' }, { createdBy: 'u-1' })
    filterCase('ACTIVITIES', 'activity.contact', 'EQ', { stringValue: 'c-1' }, { contactId: 'c-1' })
    filterCase(
      'ACTIVITIES',
      'activity.contactOwner',
      'EQ',
      { stringValue: 'u-1' },
      { contact: { ownerId: 'u-1' } },
    )
    filterCase(
      'ACTIVITIES',
      'activity.contactTeam',
      'EQ',
      { stringValue: 'team-1' },
      { contact: { owner: { teamId: 'team-1' } } },
    )
    filterCase(
      'ACTIVITIES',
      'activity.contactTags',
      'HAS_ANY',
      { stringValues: ['t1'] },
      { contact: { tags: { some: { tagId: { in: ['t1'] } } } } },
    )
  })

  // ─── Engine coverage: calculated dims, series, buckets, clamping ──────────

  describe('preview — calculated dimensions, series and bounds', () => {
    it('executes DATE_PART calculated dimensions', async () => {
      countAndRows(2, [
        dealRow({ id: 'd1', expectedCloseDate: new Date('2026-01-10T00:00:00Z') }),
        dealRow({ id: 'd2', expectedCloseDate: new Date('2026-02-10T00:00:00Z') }),
      ])
      const config = dealsConfig({
        dimensions: [
          {
            id: 'dim-part',
            fieldId: null,
            calculation: {
              kind: 'DATE_PART',
              sourceFieldId: 'deal.expectedCloseDate',
              granularity: 'MONTH',
            },
            granularity: null,
          },
        ],
      })
      const result = await service.preview('tenant-1', 'user-1', config, {})
      expect(result.rows.map((r) => r.key).sort()).toEqual(['2026-01', '2026-02'])
      const cell = result.rows
        .find((r) => r.key === '2026-01')
        ?.cells.find((c) => c.fieldId === 'dim-part')
      expect(cell?.dateValue).toBe('2026-01-01')
    })

    it('executes NUMBER_BUCKET calculated dimensions', async () => {
      countAndRows(3, [
        dealRow({ id: 'd1', value: 1500 }),
        dealRow({ id: 'd2', value: 2500 }),
        dealRow({ id: 'd3', value: 500 }),
      ])
      const config = dealsConfig({
        dimensions: [
          {
            id: 'dim-bucket',
            fieldId: null,
            calculation: { kind: 'NUMBER_BUCKET', sourceFieldId: 'deal.value', bucketSize: 1000 },
            granularity: null,
          },
        ],
      })
      const result = await service.preview('tenant-1', 'user-1', config, {})
      expect(result.rows.map((r) => r.key).sort()).toEqual(['0', '1000', '2000'])
    })

    it('buckets dates at DAY/WEEK/QUARTER/YEAR granularities', async () => {
      countAndRows(4, [
        dealRow({ id: 'd1', expectedCloseDate: new Date('2026-01-15T00:00:00Z') }),
        dealRow({ id: 'd2', expectedCloseDate: new Date('2026-01-15T00:00:00Z') }),
        dealRow({ id: 'd3', expectedCloseDate: new Date('2026-04-01T00:00:00Z') }),
        dealRow({ id: 'd4', expectedCloseDate: new Date('2027-06-01T00:00:00Z') }),
      ])
      for (const granularity of ['DAY', 'WEEK', 'QUARTER', 'YEAR'] as const) {
        const config = dealsConfig({
          dimensions: [
            { id: 'dim-date', fieldId: 'deal.expectedCloseDate', calculation: null, granularity },
          ],
          metrics: [{ id: 'm', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'm' }],
        })
        const result = await service.preview('tenant-1', 'user-1', config, {})
        // 2026-01-15, 2026-04-01 and 2027-06-01 collapse to 3 buckets for
        // DAY/WEEK/QUARTER and 2 buckets for YEAR.
        expect(result.totalRows).toBe(granularity === 'YEAR' ? 2 : 3)
        expect(result.columns[0]?.granularity).toBe(granularity)
      }
    })

    it('builds PIE series with top-10 slices and an Other remainder', async () => {
      const rows = Array.from({ length: 12 }, (_, i) =>
        dealRow({
          id: `d${i}`,
          stageId: `stage-${i}`,
          stage: { id: `stage-${i}`, name: `S${i}`, order: i, isWon: false, isLost: false },
        }),
      )
      countAndRows(rows.length, rows)
      const config = dealsConfig({
        metrics: [{ id: 'm', fieldId: 'deal.value', aggregation: 'SUM', alias: 'sum' }],
        visualization: {
          type: 'PIE',
          title: null,
          showLegend: false,
          showDataLabels: false,
          xAxisLabel: null,
          yAxisLabel: null,
          orientation: null,
        },
      })
      const result = await service.preview('tenant-1', 'user-1', config, {})
      const pie = result.series[0]
      expect(pie.points).toHaveLength(11) // top 10 + Other
      expect(pie.points[10]?.label).toBe('Other')
    })

    it('builds FUNNEL series ordered by stage order, not metric value', async () => {
      countAndRows(3, [
        dealRow({
          id: 'd1',
          stageId: 's-3',
          stage: { id: 's-3', name: 'Late', order: 3, isWon: true, isLost: false },
          value: 3000,
        }),
        dealRow({
          id: 'd2',
          stageId: 's-1',
          stage: { id: 's-1', name: 'Early', order: 1, isWon: false, isLost: false },
          value: 1000,
        }),
        dealRow({
          id: 'd3',
          stageId: 's-2',
          stage: { id: 's-2', name: 'Mid', order: 2, isWon: false, isLost: false },
          value: 2000,
        }),
      ])
      const config = dealsConfig({
        metrics: [{ id: 'm', fieldId: 'deal.value', aggregation: 'SUM', alias: 'sum' }],
        visualization: {
          type: 'FUNNEL',
          title: null,
          showLegend: false,
          showDataLabels: false,
          xAxisLabel: null,
          yAxisLabel: null,
          orientation: null,
        },
      })
      const result = await service.preview('tenant-1', 'user-1', config, {})
      expect(result.series[0].points.map((p) => p.label)).toEqual(['Early', 'Mid', 'Late'])
    })

    it('clamps pageSize to 100', async () => {
      const rows = Array.from({ length: 250 }, (_, i) =>
        dealRow({
          id: `d${i}`,
          stageId: `stage-${i}`,
          stage: { id: `stage-${i}`, name: `S${i}`, order: i, isWon: false, isLost: false },
        }),
      )
      countAndRows(rows.length, rows)
      const config = dealsConfig({
        metrics: [{ id: 'm', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'm' }],
      })
      const result = await service.preview('tenant-1', 'user-1', config, { page: 1, pageSize: 500 })
      expect(result.pagination.pageSize).toBe(100)
      expect(result.rows).toHaveLength(100)
    })

    it('returns MIXED_CURRENCY warning only once per execution', async () => {
      countAndRows(2, [
        dealRow({ id: 'd1', currency: 'USD', value: 100 }),
        dealRow({ id: 'd2', currency: 'EUR', value: 200 }),
      ])
      mockPrisma.deal.groupBy.mockResolvedValue([
        { currency: 'USD', _count: { _all: 1 } },
        { currency: 'EUR', _count: { _all: 1 } },
      ])
      const result = await service.preview('tenant-1', 'user-1', dealsConfig(), {})
      const mixed = result.warnings.filter((w) => w.code === 'MIXED_CURRENCY')
      expect(mixed).toHaveLength(1)
    })
  })
})
