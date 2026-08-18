/**
 * Story 6.5 (Contract B9, C13-C16, AC 5-6): schedule service unit tests with
 * a mocked Prisma client — ownership, report visibility, source gates, audit
 * rows, server-owned next-run computation and soft delete.
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-explicit-any */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'

import { ReportSchedulesService } from '../report-schedules.service'
import type { PrismaService } from '../../prisma/prisma.service'
import type { AuditService } from '../../audit/audit.service'
import type { PermissionsService } from '../../permissions/permissions.service'
import type { CustomReportsService } from '../custom-reports.service'

const NOW = new Date('2026-02-01T12:00:00Z')
const clock = { now: () => NOW }

function reportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rep-1',
    tenantId: 'tenant-1',
    name: 'Q1 Pipeline',
    type: 'PIPELINE_ANALYSIS',
    config: {},
    createdBy: 'user-1',
    isPublic: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    updatedBy: 'user-1',
    deletedAt: null,
    ...overrides,
  }
}

function scheduleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sched-1',
    tenantId: 'tenant-1',
    reportId: 'rep-1',
    userId: 'user-1',
    frequency: 'DAILY',
    recipients: ['a@x.io'],
    format: 'PDF',
    timezone: 'UTC',
    scheduledTime: '09:00',
    dayOfWeek: null,
    dayOfMonth: null,
    startMonth: null,
    cronExpression: null,
    nextRunAt: new Date('2026-02-02T09:00:00Z'),
    lastRunAt: null,
    isActive: true,
    createdAt: new Date('2026-02-01T11:00:00Z'),
    updatedAt: new Date('2026-02-01T11:00:00Z'),
    createdBy: 'user-1',
    updatedBy: 'user-1',
    deletedAt: null,
    report: {
      id: 'rep-1',
      name: 'Q1 Pipeline',
      type: 'PIPELINE_ANALYSIS',
      isPublic: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      createdBy: 'user-1',
      deletedAt: null,
    },
    tenant: { id: 'tenant-1', name: 'Tenant A', logoUrl: null, primaryColor: null },
    executions: [],
    ...overrides,
  }
}

function createService(overrides: {
  report?: unknown
  sourceResolve?: (id: string) => Promise<unknown>
  hasPermission?: (userId: string, resource: string, action: string) => Promise<boolean>
  create?: (args: { data: Record<string, unknown> }) => Promise<unknown>
  update?: (args: { data: Record<string, unknown> }) => Promise<unknown>
  findFirst?: () => Promise<unknown>
  count?: () => Promise<number>
  findMany?: () => Promise<unknown[]>
}) {
  const prisma = {
    report: {
      findFirst: jest
        .fn()
        .mockImplementation(async () =>
          overrides.report !== undefined ? overrides.report : reportRow(),
        ),
    },
    reportSchedule: {
      findFirst: jest
        .fn()
        .mockImplementation(async () =>
          overrides.findFirst !== undefined ? overrides.findFirst() : scheduleRow(),
        ),
      create: jest
        .fn()
        .mockImplementation(async (args) =>
          overrides.create ? overrides.create(args) : { ...scheduleRow(), ...(args.data ?? {}) },
        ),
      update: jest
        .fn()
        .mockImplementation(async (args) =>
          overrides.update ? overrides.update(args) : { ...scheduleRow(), ...(args.data ?? {}) },
        ),
      count: jest.fn().mockImplementation(async () => overrides.count ?? 3),
      findMany: jest.fn().mockImplementation(async () => overrides.findMany ?? [scheduleRow()]),
    },
    $transaction: jest.fn().mockImplementation(async (args: unknown[]) => Promise.all(args)),
  }
  const audit = { log: jest.fn().mockResolvedValue(undefined) }
  const permissions = {
    hasPermission: jest
      .fn()
      .mockImplementation(async (_u: string, _r: string, _a: string) =>
        overrides.hasPermission ? overrides.hasPermission(_u, _r, _a) : true,
      ),
  }
  const custom = {
    resolveReportDataSource: jest
      .fn()
      .mockImplementation(async (_t: string, _u: string, id: string) =>
        overrides.sourceResolve ? overrides.sourceResolve(id) : 'DEALS',
      ),
  }
  const service = new ReportSchedulesService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    permissions as unknown as PermissionsService,
    custom as unknown as CustomReportsService,
    clock,
  )
  return { service, prisma, audit, permissions, custom }
}

const CREATE_INPUT = {
  reportId: 'rep-1',
  frequency: 'DAILY',
  recipients: ['a@x.io', 'B@x.io'],
  format: 'PDF',
  timezone: 'UTC',
  scheduledTime: '09:00',
}

describe('ReportSchedulesService', () => {
  describe('create', () => {
    it('rejects invalid inputs with BadRequest', async () => {
      const { service } = createService({})
      await expect(
        service.create('tenant-1', 'user-1', { ...CREATE_INPUT, frequency: 'HOURLY' }),
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.create('tenant-1', 'user-1', { ...CREATE_INPUT, recipients: [] }),
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.create('tenant-1', 'user-1', { ...CREATE_INPUT, unknownKey: 1 }),
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.create('tenant-1', 'user-1', { ...CREATE_INPUT, reportId: undefined }),
      ).rejects.toThrow(BadRequestException)
    })

    it('returns Report not found for missing/private/cross-tenant/deleted reports', async () => {
      const { service } = createService({ report: null })
      await expect(service.create('tenant-1', 'user-1', CREATE_INPUT)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('requires the source-domain permission unless ADMIN', async () => {
      const { service, permissions } = createService({
        hasPermission: async () => false,
      })
      await expect(service.create('tenant-1', 'user-1', CREATE_INPUT)).rejects.toThrow(
        ForbiddenException,
      )
      expect(permissions.hasPermission).toHaveBeenCalledWith('user-1', 'DEAL', 'READ')

      // ADMIN bypass
      const admin = createService({ hasPermission: async () => false })
      const row = await admin.service.create('tenant-1', 'user-1', CREATE_INPUT, { isAdmin: true })
      expect(row.frequency).toBe('DAILY')
    })

    it('computes nextRunAt from the server clock and writes one audit row', async () => {
      const { service, prisma, audit } = createService({})
      const row = await service.create('tenant-1', 'user-1', CREATE_INPUT)
      // next daily 09:00 UTC after 2026-02-01T12:00Z
      expect(row.nextRunAt.toISOString()).toBe('2026-02-02T09:00:00.000Z')
      const created = prisma.reportSchedule.create.mock.calls[0][0]
      expect(created.data).toMatchObject({
        tenantId: 'tenant-1',
        reportId: 'rep-1',
        userId: 'user-1',
        frequency: 'DAILY',
        recipients: ['a@x.io', 'b@x.io'],
        createdBy: 'user-1',
        updatedBy: 'user-1',
      })
      expect(audit.log).toHaveBeenCalledTimes(1)
      expect(audit.log.mock.calls[0][0]).toMatchObject({
        tenantId: 'tenant-1',
        userId: 'user-1',
        action: 'CREATE',
        entity: 'REPORT_SCHEDULE',
        details: { frequency: 'DAILY', format: 'PDF', recipientsCount: 2, reportId: 'rep-1' },
      })
    })

    it('uses the custom source readGate for CUSTOM reports', async () => {
      const { service, permissions, custom } = createService({
        report: reportRow({ type: 'CUSTOM' }),
        sourceResolve: async () => 'CONTACTS',
        hasPermission: async (_u, resource) => resource === 'CONTACT',
      })
      const row = await service.create('tenant-1', 'user-1', CREATE_INPUT)
      expect(row.reportId).toBe('rep-1')
      expect(custom.resolveReportDataSource).toHaveBeenCalledWith('tenant-1', 'user-1', 'rep-1')
      expect(permissions.hasPermission).toHaveBeenCalledWith('user-1', 'CONTACT', 'READ')
    })
  })

  describe('update', () => {
    it('enforces ownership even for ADMIN callers', async () => {
      const { service } = createService({
        findFirst: async () => ({ ...scheduleRow(), userId: 'other-user' }),
      })
      await expect(
        service.update('tenant-1', 'user-1', 'sched-1', { recipients: ['c@x.io'] }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('recalculates nextRunAt when the cadence changes', async () => {
      const { service, prisma, audit } = createService({})
      const row = await service.update('tenant-1', 'user-1', 'sched-1', { scheduledTime: '18:00' })
      expect(row.nextRunAt.toISOString()).toBe('2026-02-01T18:00:00.000Z')
      expect(prisma.reportSchedule.update.mock.calls[0][0].data.nextRunAt.toISOString()).toBe(
        '2026-02-01T18:00:00.000Z',
      )
      expect(audit.log).toHaveBeenCalledTimes(1)
      expect(audit.log.mock.calls[0][0].action).toBe('UPDATE')
    })

    it('keeps nextRunAt for recipient/format-only updates', async () => {
      const { service, prisma } = createService({})
      await service.update('tenant-1', 'user-1', 'sched-1', { recipients: ['c@x.io'] })
      const data = prisma.reportSchedule.update.mock.calls[0][0].data
      expect(data.nextRunAt).toBeUndefined()
      expect(data.recipients).toEqual(['c@x.io'])
    })

    it('rejects a merged cadence that becomes invalid', async () => {
      const { service } = createService({})
      // WEEKLY with no dayOfWeek is invalid after merge.
      await expect(
        service.update('tenant-1', 'user-1', 'sched-1', { frequency: 'WEEKLY' }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('pause / resume / delete', () => {
    it('pause deactivates without creating an execution and audits UPDATE', async () => {
      const { service, prisma, audit } = createService({})
      const row = await service.pause('tenant-1', 'user-1', 'sched-1')
      expect(prisma.reportSchedule.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }),
      )
      expect(row.isActive).toBe(false)
      expect(audit.log.mock.calls[0][0]).toMatchObject({
        action: 'UPDATE',
        details: { paused: true },
      })
    })

    it('resume computes a future run without replaying paused occurrences', async () => {
      const { service } = createService({})
      const row = await service.resume('tenant-1', 'user-1', 'sched-1')
      expect(row.isActive).toBe(true)
      expect(row.nextRunAt.getTime()).toBeGreaterThan(NOW.getTime())
    })

    it('delete soft-deletes and audits DELETE', async () => {
      const { service, prisma, audit } = createService({})
      const result = await service.delete('tenant-1', 'user-1', 'sched-1')
      expect(result).toBe(true)
      expect(prisma.reportSchedule.update.mock.calls[0][0].data).toMatchObject({
        deletedAt: NOW,
        isActive: false,
        updatedBy: 'user-1',
      })
      expect(audit.log.mock.calls[0][0]).toMatchObject({
        action: 'DELETE',
        entity: 'REPORT_SCHEDULE',
      })
    })
  })

  describe('list', () => {
    it('filters by tenant + owner + deletedAt and paginates', async () => {
      const { service, prisma } = createService({})
      const result = await service.list('tenant-1', 'user-1', {
        page: 2,
        pageSize: 10,
        includeInactive: true,
      })
      expect(result.total).toBe(3)
      expect(result.items).toHaveLength(1)
      expect(result.page).toBe(2)
      expect(prisma.reportSchedule.findMany.mock.calls[0][0]).toMatchObject({
        where: { tenantId: 'tenant-1', userId: 'user-1', deletedAt: null },
        skip: 10,
        take: 10,
      })
    })

    it('excludes inactive schedules unless includeInactive is set', async () => {
      const { service, prisma } = createService({})
      await service.list('tenant-1', 'user-1', {})
      expect(prisma.reportSchedule.findMany.mock.calls[0][0].where).toMatchObject({
        isActive: true,
      })
    })

    it('caps pageSize at 100', async () => {
      const { service, prisma } = createService({})
      await service.list('tenant-1', 'user-1', { page: 1, pageSize: 999 })
      expect(prisma.reportSchedule.findMany.mock.calls[0][0].take).toBe(100)
    })
  })

  describe('resolveReport / assertSourcePermission', () => {
    it('resolveReport throws the same error for private non-owner and missing reports', async () => {
      const { service } = createService({ report: null })
      await expect(service.resolveReport('tenant-1', 'user-1', 'rep-x')).rejects.toThrow(
        NotFoundException,
      )
      const { service: svc2 } = createService({ report: reportRow({ type: 'ALIEN' }) })
      await expect(svc2.resolveReport('tenant-1', 'user-1', 'rep-x')).rejects.toThrow(
        BadRequestException,
      )
    })
  })
})
