import { AuditService } from './audit.service'
import { PrismaService } from '../prisma/prisma.service'

describe('AuditService', () => {
  let service: AuditService
  let prisma: {
    auditLog: { create: jest.Mock; findMany: jest.Mock; count: jest.Mock; deleteMany: jest.Mock }
  }

  beforeEach(() => {
    prisma = {
      auditLog: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        deleteMany: jest.fn(),
      },
    }
    service = new AuditService(prisma as unknown as PrismaService)
  })

  it('creates an audit log entry with correct fields', async () => {
    prisma.auditLog.create.mockResolvedValue({ id: 'log-1' })

    await service.log({
      tenantId: 'tenant-1',
      userId: 'user-1',
      action: 'ROLE_ASSIGNED',
      entity: 'UserRole',
      entityId: 'user-1:role-1',
      details: { userId: 'user-1', roleId: 'role-1', roleName: 'ADMIN' },
    })

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        action: 'ROLE_ASSIGNED',
        entity: 'UserRole',
        entityId: 'user-1:role-1',
        details: { userId: 'user-1', roleId: 'role-1', roleName: 'ADMIN' },
        ipAddress: null,
        userAgent: null,
      },
    })
  })

  it('handles null details', async () => {
    prisma.auditLog.create.mockResolvedValue({ id: 'log-2' })

    await service.log({
      tenantId: 'tenant-1',
      userId: 'user-1',
      action: 'ROLE_REMOVED',
      entity: 'UserRole',
      entityId: 'user-1:role-1',
    })

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        details: undefined,
        ipAddress: null,
        userAgent: null,
      }),
    })
  })

  describe('list', () => {
    it('returns paginated results ordered by createdAt desc', async () => {
      const items = [
        {
          id: 'log-2',
          tenantId: 't1',
          userId: 'u1',
          action: 'CREATE',
          entity: 'CONTACT',
          entityId: 'c1',
          details: null,
          ipAddress: null,
          userAgent: null,
          createdAt: new Date('2026-07-02'),
        },
        {
          id: 'log-1',
          tenantId: 't1',
          userId: 'u1',
          action: 'CREATE',
          entity: 'CONTACT',
          entityId: 'c2',
          details: null,
          ipAddress: null,
          userAgent: null,
          createdAt: new Date('2026-07-01'),
        },
      ]
      prisma.auditLog.findMany.mockResolvedValue(items)
      prisma.auditLog.count.mockResolvedValue(2)

      const result = await service.list('t1', {}, { page: 1, pageSize: 20 })

      expect(result.items).toHaveLength(2)
      expect(result.total).toBe(2)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(20)
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      )
    })

    it('clamps pageSize to max 100', async () => {
      prisma.auditLog.findMany.mockResolvedValue([])
      prisma.auditLog.count.mockResolvedValue(0)

      const result = await service.list('t1', {}, { pageSize: 999 })
      expect(result.pageSize).toBe(100)
    })

    it('filters by userId', async () => {
      prisma.auditLog.findMany.mockResolvedValue([])
      prisma.auditLog.count.mockResolvedValue(0)

      await service.list('t1', { userId: 'u1' }, {})
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'u1' }),
        }),
      )
    })

    it('filters by action', async () => {
      prisma.auditLog.findMany.mockResolvedValue([])
      prisma.auditLog.count.mockResolvedValue(0)

      await service.list('t1', { action: 'CREATE' }, {})
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ action: 'CREATE' }),
        }),
      )
    })

    it('filters by entity', async () => {
      prisma.auditLog.findMany.mockResolvedValue([])
      prisma.auditLog.count.mockResolvedValue(0)

      await service.list('t1', { entity: 'CONTACT' }, {})
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ entity: 'CONTACT' }),
        }),
      )
    })

    it('filters by date range', async () => {
      prisma.auditLog.findMany.mockResolvedValue([])
      prisma.auditLog.count.mockResolvedValue(0)

      await service.list('t1', { dateFrom: '2026-01-01', dateTo: '2026-12-31' }, {})
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: expect.any(Date), lte: expect.any(Date) },
          }),
        }),
      )
    })

    it('caps max skip to prevent deep-scan abuse', async () => {
      prisma.auditLog.findMany.mockResolvedValue([])
      prisma.auditLog.count.mockResolvedValue(0)

      await service.list('t1', {}, { page: 999999, pageSize: 20 })
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10000 }),
      )
    })
  })

  describe('cleanup', () => {
    it('deletes logs older than default retention', async () => {
      prisma.auditLog.deleteMany.mockResolvedValue({ count: 5 })

      const result = await service.cleanup()

      expect(result).toBe(5)
      expect(prisma.auditLog.deleteMany).toHaveBeenCalled()
    })

    it('uses provided retention days', async () => {
      prisma.auditLog.deleteMany.mockResolvedValue({ count: 0 })

      await service.cleanup(30)
      const call = prisma.auditLog.deleteMany.mock.calls[0][0] as {
        where: { createdAt: { lt: Date } }
      }
      const now = Date.now()
      const cutoff = call.where.createdAt.lt.getTime()
      expect(now - cutoff).toBeGreaterThanOrEqual(29 * 24 * 60 * 60 * 1000)
      expect(now - cutoff).toBeLessThanOrEqual(31 * 24 * 60 * 60 * 1000)
    })
  })
})
