import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { DashboardsService, DASHBOARD_SELECT, WIDGET_SELECT } from '../dashboards.service'

// Test specs commonly use `any` for mock objects — this is the project convention
// (see existing specs in notifications/__tests__/, notes/__tests__/, etc.)
/* eslint-disable @typescript-eslint/no-explicit-any */

// Mock widget-config
jest.mock('../widget-config', () => ({
  validateWidgetConfig: jest.fn((input) => ({
    ...input,
    source: (input as Record<string, unknown>).source || 'TASK_STATS',
  })),
  DEFAULT_WIDGET_CONFIG: {
    source: 'TASK_STATS',
    dateRangeDays: 30,
    stageId: null,
    ownerId: null,
    limit: 5,
  },
}))

// Mock dashboard-templates
jest.mock('../dashboard-templates', () => {
  const actual = jest.requireActual('../dashboard-templates')
  return actual
})

describe('DashboardsService', () => {
  let service: DashboardsService
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockPrisma: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockAudit: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockSharing: any

  // Named-field factory (not positional new)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function buildService(
    overrides: { prisma?: any; audit?: any; sharing?: any } = {},
  ): DashboardsService {
    return new DashboardsService(
      overrides.prisma ?? mockPrisma,
      overrides.audit ?? mockAudit,
      overrides.sharing ?? mockSharing,
    )
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) }
    mockSharing = { getSharedWithMe: jest.fn().mockResolvedValue([]) }
    mockPrisma = {
      dashboard: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      widget: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        createMany: jest.fn(),
      },
      user: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn((cb: any) => cb(mockPrisma)),
    }
    service = buildService()
  })

  // ─── AC 21 ──────────────────────────────────────────────────────
  describe('DASHBOARD_SELECT and WIDGET_SELECT', () => {
    it('DASHBOARD_SELECT lists all required fields', () => {
      const fields = [
        'id',
        'tenantId',
        'userId',
        'name',
        'isDefault',
        'isSystemGenerated',
        'createdAt',
        'updatedAt',
        'createdBy',
        'updatedBy',
        'deletedAt',
      ]
      for (const field of fields) {
        expect(DASHBOARD_SELECT).toHaveProperty(field, true)
      }
    })

    it('WIDGET_SELECT lists all required fields', () => {
      const fields = [
        'id',
        'tenantId',
        'dashboardId',
        'type',
        'title',
        'config',
        'position',
        'size',
        'createdAt',
        'updatedAt',
        'createdBy',
        'updatedBy',
        'deletedAt',
      ]
      for (const field of fields) {
        expect(WIDGET_SELECT).toHaveProperty(field, true)
      }
    })
  })

  // ─── AC 22 ──────────────────────────────────────────────────────
  describe('constructor', () => {
    it('accepts PrismaService and AuditService', () => {
      const s = buildService()
      expect(s).toBeInstanceOf(DashboardsService)
    })
  })

  // ─── AC 23 findMany ─────────────────────────────────────────────
  describe('findMany', () => {
    it('returns { owned, sharedWithMe }', async () => {
      mockPrisma.dashboard.findMany.mockResolvedValueOnce([{ id: 'd-1', name: 'My Dash' }])
      mockSharing.getSharedWithMe.mockResolvedValueOnce([])
      const result = await service.findMany('t-1', 'u-1')
      expect(result).toEqual({ owned: [{ id: 'd-1', name: 'My Dash' }], sharedWithMe: [] })
    })

    it('passes tenantId in every prisma call', async () => {
      mockPrisma.dashboard.findMany.mockResolvedValueOnce([])
      mockSharing.getSharedWithMe.mockResolvedValueOnce([])
      await service.findMany('t-2', 'u-1')
      expect(mockPrisma.dashboard.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 't-2', userId: 'u-1', deletedAt: null } }),
      )
    })

    it('short-circuits sharedWithMe for empty id list (Trap T29)', async () => {
      mockPrisma.dashboard.findMany.mockResolvedValueOnce([])
      mockSharing.getSharedWithMe.mockResolvedValueOnce([])
      const result = await service.findMany('t-1', 'u-1')
      expect(result.sharedWithMe).toEqual([])
      // second findMany should NOT be called
      expect(mockPrisma.dashboard.findMany).toHaveBeenCalledTimes(1)
    })

    it('returns sharedWithMe when sharing exists', async () => {
      mockPrisma.dashboard.findMany
        .mockResolvedValueOnce([{ id: 'd-1', name: 'Owned' }])
        .mockResolvedValueOnce([{ id: 'd-2', name: 'Shared' }])
      mockSharing.getSharedWithMe.mockResolvedValueOnce([{ resourceId: 'd-2' }])
      const result = await service.findMany('t-1', 'u-1')
      expect(result.sharedWithMe).toEqual([{ id: 'd-2', name: 'Shared' }])
    })
  })

  // ─── AC 23 findOne ──────────────────────────────────────────────
  describe('findOne', () => {
    it('returns dashboard for owner', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValueOnce({ id: 'd-1', name: 'Dash' })
      const result = await service.findOne('t-1', 'u-1', 'd-1')
      expect(result).toEqual({ id: 'd-1', name: 'Dash' })
    })

    it('returns dashboard for shared recipient', async () => {
      mockPrisma.dashboard.findFirst
        .mockResolvedValueOnce(null) // owner check fails
        .mockResolvedValueOnce({ id: 'd-1', name: 'Shared' }) // shared check
      mockSharing.getSharedWithMe.mockResolvedValueOnce([{ resourceId: 'd-1' }])
      const result = await service.findOne('t-1', 'u-2', 'd-1')
      expect(result).toEqual({ id: 'd-1', name: 'Shared' })
    })

    it('throws NotFoundException for non-existent id', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValue(null)
      mockSharing.getSharedWithMe.mockResolvedValueOnce([])
      await expect(service.findOne('t-1', 'u-1', 'd-none')).rejects.toThrow(NotFoundException)
      await expect(service.findOne('t-1', 'u-1', 'd-none')).rejects.toThrow('Dashboard not found')
    })

    it('throws identical message for cross-tenant and soft-deleted (indistinguishable)', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValue(null)
      mockSharing.getSharedWithMe.mockResolvedValueOnce([])
      await expect(service.findOne('t-2', 'u-1', 'd-1')).rejects.toThrow('Dashboard not found')
    })
  })

  // ─── AC 25 myDashboard ──────────────────────────────────────────
  describe('myDashboard', () => {
    it('returns existing default dashboard', async () => {
      const dash = { id: 'd-def', name: 'My Dashboard', isDefault: true }
      mockPrisma.dashboard.findFirst.mockResolvedValueOnce(dash)
      const result = await service.myDashboard('t-1', 'u-1', ['SALES_REP'])
      expect(result).toEqual(dash)
    })

    it('lazy-provisions when no default exists', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValueOnce(null) // first check
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        return cb({
          dashboard: {
            findFirst: jest.fn().mockResolvedValue(null), // recheck
            create: jest.fn().mockResolvedValue({
              id: 'd-new',
              name: 'Sales Dashboard',
              isDefault: true,
              isSystemGenerated: true,
            }),
          },
          widget: {
            createMany: jest.fn().mockResolvedValue({ count: 7 }),
          },
        })
      })
      const result = await service.myDashboard('t-1', 'u-1', ['SALES_REP'])
      expect(result.id).toBe('d-new')
    })

    it('provisions exactly once under simulated concurrent call (recheck inside transaction)', async () => {
      mockPrisma.dashboard.findFirst
        .mockResolvedValueOnce(null) // first pass
        .mockResolvedValueOnce({ id: 'd-concurrent', name: 'Concurrent' }) // after transaction started
      const result = await service.myDashboard('t-1', 'u-1', ['SALES_REP'])
      expect(result).toEqual({ id: 'd-concurrent', name: 'Concurrent' })
    })
  })

  // ─── AC 23 create ───────────────────────────────────────────────
  describe('create', () => {
    it('creates a dashboard with name', async () => {
      mockPrisma.dashboard.count.mockResolvedValueOnce(0)
      mockPrisma.dashboard.findMany.mockResolvedValueOnce([])
      mockPrisma.dashboard.create.mockResolvedValueOnce({ id: 'd-new', name: 'New Dash' })
      const result = await service.create('t-1', 'u-1', { name: 'New Dash' })
      expect(result).toEqual({ id: 'd-new', name: 'New Dash' })
    })

    it('enforces MAX_DASHBOARDS_PER_USER', async () => {
      mockPrisma.dashboard.count.mockResolvedValueOnce(10)
      await expect(service.create('t-1', 'u-1', { name: 'Too Many' })).rejects.toThrow(
        BadRequestException,
      )
    })

    it('detects case-insensitive name collision across all dashboards (AC 20)', async () => {
      mockPrisma.dashboard.count.mockResolvedValueOnce(0)
      mockPrisma.dashboard.findMany.mockResolvedValueOnce([
        { name: 'Other Dash' },
        { name: 'My Dash' },
      ])
      await expect(service.create('t-1', 'u-1', { name: 'my dash' })).rejects.toThrow(
        ConflictException,
      )
    })

    it('allows a name when no other dashboard shares it', async () => {
      mockPrisma.dashboard.count.mockResolvedValueOnce(0)
      mockPrisma.dashboard.findMany.mockResolvedValueOnce([
        { name: 'Other Dash' },
        { name: 'Second Dash' },
      ])
      mockPrisma.dashboard.create.mockResolvedValueOnce({ id: 'd-new', name: 'My Dash' })
      const result = await service.create('t-1', 'u-1', { name: 'My Dash' })
      expect(result.id).toBe('d-new')
    })

    it('writes audit log on create', async () => {
      mockPrisma.dashboard.count.mockResolvedValueOnce(0)
      mockPrisma.dashboard.findMany.mockResolvedValueOnce([])
      mockPrisma.dashboard.create.mockResolvedValueOnce({ id: 'd-new', name: 'Dash' })
      await service.create('t-1', 'u-1', { name: 'Dash' })
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DASHBOARD_CREATED',
          entity: 'Dashboard',
        }),
      )
    })
  })

  // ─── AC 23 update ───────────────────────────────────────────────
  describe('update', () => {
    it('updates name', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValueOnce({
        id: 'd-1',
        name: 'Old',
        userId: 'u-1',
      })
      mockPrisma.dashboard.update.mockResolvedValueOnce({ id: 'd-1', name: 'New Name' })
      const result = await service.update('t-1', 'u-1', 'd-1', { name: 'New Name' })
      expect(result).toEqual({ id: 'd-1', name: 'New Name' })
    })

    it('throws NotFoundException for non-owner', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValueOnce(null)
      await expect(service.update('t-1', 'u-2', 'd-1', { name: 'Test' })).rejects.toThrow(
        NotFoundException,
      )
    })

    it('clears isDefault on siblings inside transaction', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValueOnce({ id: 'd-1', userId: 'u-1' })
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        return cb({
          dashboard: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            update: jest.fn().mockResolvedValue({ id: 'd-1', isDefault: true }),
          },
        })
      })
      const result = await service.update('t-1', 'u-1', 'd-1', { isDefault: true })
      expect(result).toEqual({ id: 'd-1', isDefault: true })
    })

    it('writes audit log on update', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValueOnce({ id: 'd-1', userId: 'u-1' })
      mockPrisma.dashboard.update.mockResolvedValueOnce({ id: 'd-1', name: 'Updated' })
      await service.update('t-1', 'u-1', 'd-1', { name: 'Updated' })
      expect(mockAudit.log).toHaveBeenCalled()
    })
  })

  // ─── AC 23 delete ───────────────────────────────────────────────
  describe('delete', () => {
    it('soft-deletes dashboard and its widgets', async () => {
      const dash = { id: 'd-1', name: 'Dash', userId: 'u-1' }
      mockPrisma.dashboard.findFirst.mockResolvedValueOnce(dash)
      mockPrisma.dashboard.count.mockResolvedValueOnce(1)
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        return cb({
          widget: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
          dashboard: { update: jest.fn().mockResolvedValue({ id: 'd-1', deletedAt: new Date() }) },
        })
      })
      const result = await service.delete('t-1', 'u-1', 'd-1')
      expect(result.deletedAt).toBeDefined()
    })

    it('refuses to delete last dashboard', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValueOnce({
        id: 'd-1',
        userId: 'u-1',
        name: 'Dash',
      })
      mockPrisma.dashboard.count.mockResolvedValueOnce(0)
      try {
        await service.delete('t-1', 'u-1', 'd-1')
        fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException)
        expect((e as Error).message).toContain('Your last dashboard cannot be deleted')
      }
    })

    it('throws NotFoundException for non-owner', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValueOnce(null)
      await expect(service.delete('t-1', 'u-2', 'd-1')).rejects.toThrow(NotFoundException)
    })
  })

  // ─── AC 24 reorderWidgets ───────────────────────────────────────
  describe('reorderWidgets', () => {
    beforeEach(() => {
      mockPrisma.dashboard.findFirst.mockResolvedValue({ id: 'd-1' })
      mockPrisma.widget.findMany
        .mockResolvedValueOnce([{ id: 'w-1' }, { id: 'w-2' }, { id: 'w-3' }]) // active widgets
        .mockResolvedValueOnce([
          { id: 'w-3', position: 0 },
          { id: 'w-1', position: 1 },
          { id: 'w-2', position: 2 },
        ]) // result
    })

    it('reorders widgets to match submitted order', async () => {
      const result = await service.reorderWidgets('t-1', 'u-1', 'd-1', ['w-3', 'w-1', 'w-2'])
      expect(result).toHaveLength(3)
    })

    it('rejects empty list', async () => {
      await expect(service.reorderWidgets('t-1', 'u-1', 'd-1', [])).rejects.toThrow(
        BadRequestException,
      )
    })

    it('rejects duplicates', async () => {
      await expect(
        service.reorderWidgets('t-1', 'u-1', 'd-1', ['w-1', 'w-1', 'w-2']),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects partial set', async () => {
      await expect(service.reorderWidgets('t-1', 'u-1', 'd-1', ['w-1', 'w-2'])).rejects.toThrow(
        BadRequestException,
      )
    })

    it('rejects unknown widget id', async () => {
      await expect(
        service.reorderWidgets('t-1', 'u-1', 'd-1', ['w-1', 'w-2', 'w-unknown']),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects for non-owner', async () => {
      mockPrisma.dashboard.findFirst.mockReset()
      mockPrisma.dashboard.findFirst.mockResolvedValue(null)
      await expect(service.reorderWidgets('t-1', 'u-2', 'd-1', ['w-1'])).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  // ─── AC 23 addWidget ────────────────────────────────────────────
  describe('addWidget', () => {
    it('adds a widget with default title and size', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValue({ id: 'd-1' })
      mockPrisma.widget.count.mockResolvedValue(0)
      mockPrisma.widget.findFirst.mockResolvedValue(null)
      mockPrisma.widget.create.mockResolvedValue({
        id: 'w-1',
        type: 'METRIC_CARD',
        title: 'Widget 1',
      })
      const result = await service.addWidget('t-1', 'u-1', 'd-1', {
        type: 'METRIC_CARD',
        source: 'PIPELINE_VALUE',
      })
      expect(result.id).toBe('w-1')
    })

    it('rejects when max widgets reached', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValue({ id: 'd-1' })
      mockPrisma.widget.count.mockResolvedValue(12)
      await expect(
        service.addWidget('t-1', 'u-1', 'd-1', { type: 'METRIC_CARD', source: 'PIPELINE_VALUE' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects non-owner', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValue(null)
      await expect(
        service.addWidget('t-1', 'u-2', 'd-1', { type: 'METRIC_CARD', source: 'PIPELINE_VALUE' }),
      ).rejects.toThrow(NotFoundException)
    })
  })

  // ─── updateWidget ───────────────────────────────────────────────
  describe('updateWidget', () => {
    it('updates widget size', async () => {
      mockPrisma.widget.findFirst.mockResolvedValue({
        id: 'w-1',
        config: { source: 'TASK_STATS' },
        dashboard: { userId: 'u-1' },
      })
      mockPrisma.widget.update.mockResolvedValue({ id: 'w-1', size: '2x2' })
      const result = await service.updateWidget('t-1', 'u-1', 'w-1', { size: '2x2' })
      expect(result.size).toBe('2x2')
    })

    it('rejects non-owner', async () => {
      mockPrisma.widget.findFirst.mockResolvedValue({
        id: 'w-1',
        dashboard: { userId: 'u-2' },
      })
      await expect(service.updateWidget('t-1', 'u-1', 'w-1', { size: '2x2' })).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  // ─── removeWidget ───────────────────────────────────────────────
  describe('removeWidget', () => {
    it('soft-deletes widget', async () => {
      mockPrisma.widget.findFirst.mockResolvedValue({
        id: 'w-1',
        dashboard: { userId: 'u-1' },
      })
      mockPrisma.widget.update.mockResolvedValue({ id: 'w-1', deletedAt: new Date() })
      const result = await service.removeWidget('t-1', 'u-1', 'w-1')
      expect(result.deletedAt).toBeDefined()
    })
  })

  // ─── AC 26 audit logging ────────────────────────────────────────
  describe('audit logging', () => {
    it('writes audit on create/update/delete but not widget mutations', async () => {
      // create
      mockPrisma.dashboard.count.mockResolvedValue(0)
      mockPrisma.dashboard.findMany.mockResolvedValue([])
      mockPrisma.dashboard.create.mockResolvedValue({ id: 'd-1', name: 'Dash' })
      await service.create('t-1', 'u-1', { name: 'Dash' })
      expect(mockAudit.log).toHaveBeenCalledTimes(1)
      mockAudit.log.mockClear()

      // update
      mockPrisma.dashboard.findFirst.mockResolvedValue({ id: 'd-1', userId: 'u-1' })
      mockPrisma.dashboard.update.mockResolvedValue({ id: 'd-1', name: 'Updated' })
      await service.update('t-1', 'u-1', 'd-1', { name: 'Updated' })
      expect(mockAudit.log).toHaveBeenCalledTimes(1)
      mockAudit.log.mockClear()

      // delete
      mockPrisma.dashboard.findFirst.mockResolvedValue({ id: 'd-1', userId: 'u-1', name: 'Dash' })
      mockPrisma.dashboard.count.mockResolvedValue(1)
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        return cb({
          widget: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
          dashboard: { update: jest.fn().mockResolvedValue({ id: 'd-1', deletedAt: new Date() }) },
        })
      })
      await service.delete('t-1', 'u-1', 'd-1')
      expect(mockAudit.log).toHaveBeenCalledTimes(1)
      mockAudit.log.mockClear()

      // addWidget — no audit
      mockPrisma.dashboard.findFirst.mockResolvedValue({ id: 'd-1' })
      mockPrisma.widget.count.mockResolvedValue(0)
      mockPrisma.widget.findFirst.mockResolvedValue({ position: -1 })
      mockPrisma.widget.create.mockResolvedValue({ id: 'w-1' })
      await service.addWidget('t-1', 'u-1', 'd-1', {
        type: 'METRIC_CARD',
        source: 'PIPELINE_VALUE',
      })
      expect(mockAudit.log).not.toHaveBeenCalled()
    })
  })

  // ─── AC 27 entityId from created row ────────────────────────────
  describe('entityId in audit logs', () => {
    it('reads entityId from created row', async () => {
      mockPrisma.dashboard.count.mockResolvedValue(0)
      mockPrisma.dashboard.findMany.mockResolvedValue([])
      mockPrisma.dashboard.create.mockResolvedValue({ id: 'd-from-db', name: 'Dash' })
      await service.create('t-1', 'u-1', { name: 'Dash' })
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'd-from-db' }))
    })
  })

  // ─── AC 28 tenantId in every prisma call ────────────────────────
  describe('tenantId in every prisma call', () => {
    it('findMany passes tenantId', async () => {
      mockPrisma.dashboard.findMany.mockResolvedValue([])
      mockSharing.getSharedWithMe.mockResolvedValue([])
      await service.findMany('t-my-tenant', 'u-1')
      expect(mockPrisma.dashboard.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 't-my-tenant' }),
        }),
      )
    })
  })

  // ─── ownerName (AC 72 "Shared by <name>") ───────────────────────
  describe('ownerName', () => {
    it('returns full name when the owner has first and last name', async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce({
        firstName: 'Alice',
        lastName: 'Smith',
        email: 'alice@example.com',
      })
      const result = await service.ownerName('t-1', 'u-2')
      expect(result).toBe('Alice Smith')
    })

    it('falls back to email when the owner has no name', async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce({
        firstName: null,
        lastName: null,
        email: 'alice@example.com',
      })
      const result = await service.ownerName('t-1', 'u-2')
      expect(result).toBe('alice@example.com')
    })

    it('returns null for an unknown owner', async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce(null)
      const result = await service.ownerName('t-1', 'u-none')
      expect(result).toBeNull()
    })
  })
})
