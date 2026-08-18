/**
 * Story 6.5 (Contract E23-E28, AC 9-15): processor unit tests with a mocked
 * Prisma client, injected clock and fake transport — cron metadata, atomic
 * claim/no-op losing instance, 1/2/4-minute persisted retries, terminal
 * FAILED with one deduped notification, SKIPPED semantics and stale recovery.
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-explicit-any */
import 'reflect-metadata'
import { BadRequestException } from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

import {
  ReportScheduleProcessor,
  sanitizeExecutionError,
  DEFAULT_BATCH_SIZE,
  DEFAULT_CONCURRENCY,
  STALE_CLAIM_LEASE_MS,
} from '../report-schedule-processor.service'
import { AttachmentLimitError } from '../report-attachment.service'
import { EmailConfigurationError, EmailSendError } from '../report-email.service'
import { MAX_ATTEMPTS } from '../report-schedule-calculation'
import type { PrismaService } from '../../prisma/prisma.service'
import type { ScheduledReportPayloadService } from '../scheduled-report-payload.service'
import type { ReportAttachmentService } from '../report-attachment.service'
import type { ReportEmailService } from '../report-email.service'
import type { NotificationsService } from '../../notifications/notifications.service'
import type { PermissionsService } from '../../permissions/permissions.service'
import type { ConfigService } from '@nestjs/config'

const NOW = new Date('2026-02-01T12:00:00Z')

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
    nextRunAt: new Date('2026-02-01T11:00:00Z'),
    lastRunAt: null,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
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

function executionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exec-1',
    tenantId: 'tenant-1',
    scheduleId: 'sched-1',
    reportId: 'rep-1',
    scheduledFor: new Date('2026-02-01T11:00:00Z'),
    status: 'PROCESSING',
    attemptCount: 1,
    nextRetryAt: null,
    processingStartedAt: NOW,
    completedAt: null,
    errorCode: null,
    errorMessage: null,
    providerMessageId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function createProcessor(overrides: {
  due?: unknown[]
  retries?: unknown[]
  executionCreate?: (args: { data: Record<string, unknown> }) => Promise<unknown>
  executionCreateError?: unknown
  executionUpdateMany?: (args: unknown) => Promise<{ count: number }>
  executionUpdate?: (args: { data: Record<string, unknown> }) => Promise<unknown>
  scheduleUpdate?: (args: { data: Record<string, unknown> }) => Promise<unknown>
  userFindFirst?: unknown
  reportFindFirst?: unknown
  roles?: unknown[]
  hasPermission?: (u: string, r: string, a: string) => Promise<boolean>
  payloadError?: Error
  attachmentError?: Error
  emailError?: Error
  emailResult?: { providerMessageId: string | null }
  notifySafe?: jest.Mock
}) {
  const prisma = {
    reportSchedule: {
      findMany: jest.fn().mockImplementation(async () => overrides.due ?? []),
      update: jest
        .fn()
        .mockImplementation(async (args) =>
          overrides.scheduleUpdate
            ? overrides.scheduleUpdate(args)
            : { ...scheduleRow(), ...(args.data ?? {}) },
        ),
    },
    reportScheduleExecution: {
      create: jest.fn().mockImplementation(async (args) => {
        if (overrides.executionCreateError) throw overrides.executionCreateError
        return overrides.executionCreate
          ? overrides.executionCreate(args)
          : executionRow({ ...(args.data ?? {}) })
      }),
      findUnique: jest.fn().mockImplementation(async () => executionRow({ id: 'other-exec' })),
      updateMany: jest
        .fn()
        .mockImplementation(async (args) =>
          overrides.executionUpdateMany ? overrides.executionUpdateMany(args) : { count: 1 },
        ),
      update: jest
        .fn()
        .mockImplementation(async (args) =>
          overrides.executionUpdate
            ? overrides.executionUpdate(args)
            : { ...executionRow(), ...(args.data ?? {}) },
        ),
      findMany: jest
        .fn()
        .mockImplementation(async () =>
          (overrides.retries ?? []).map((r) => ({ ...(r as object), schedule: scheduleRow() })),
        ),
    },
    user: {
      findFirst: jest
        .fn()
        .mockImplementation(async () =>
          overrides.userFindFirst !== undefined ? overrides.userFindFirst : { id: 'user-1' },
        ),
    },
    report: {
      findFirst: jest
        .fn()
        .mockImplementation(async () =>
          overrides.reportFindFirst !== undefined
            ? overrides.reportFindFirst
            : { id: 'rep-1', type: 'PIPELINE_ANALYSIS' },
        ),
    },
    userRole: {
      findMany: jest
        .fn()
        .mockImplementation(async () => overrides.roles ?? [{ role: { name: 'SALES_REP' } }]),
    },
    $transaction: jest.fn().mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return arg(prisma) // interactive transaction callback
      }
      return Promise.all(arg as unknown[])
    }),
  }
  const payloadService = {
    loadReport: jest.fn().mockImplementation(async () => scheduleRow().report),
    resolveCustomSource: jest.fn().mockImplementation(async () => 'DEALS'),
    buildForReport: jest.fn().mockImplementation(async () => {
      if (overrides.payloadError) throw overrides.payloadError
      return {
        reportId: 'rep-1',
        reportType: 'PIPELINE_ANALYSIS',
        reportName: 'Q1 Pipeline',
        generatedAt: NOW.toISOString(),
        dateRangeLabel: '2026-01-01 — 2026-01-31',
        summaryMetrics: [
          { key: 'PIPELINE_VALUE', label: 'Total value', value: 125000, unit: 'CURRENCY' },
        ],
        columns: [],
        rows: [],
        totalRows: 0,
        warnings: [],
        currency: 'USD',
        mixedCurrencies: false,
        crmUrl: 'https://crm.example/reports/sales?reportId=rep-1',
      }
    }),
  }
  const attachmentService = {
    render: jest.fn().mockImplementation(async () => {
      if (overrides.attachmentError) throw overrides.attachmentError
      return { filename: 'q1.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF') }
    }),
  }
  const emailService = {
    send: jest.fn().mockImplementation(async () => {
      if (overrides.emailError) throw overrides.emailError
      return overrides.emailResult ?? { providerMessageId: 'provider-1' }
    }),
  }
  const notifications = {
    notifySafe: overrides.notifySafe ?? jest.fn().mockResolvedValue(undefined),
  }
  const permissions = {
    hasPermission: jest
      .fn()
      .mockImplementation(async (_u, _r, _a) =>
        overrides.hasPermission ? overrides.hasPermission(_u, _r, _a) : true,
      ),
  }
  const config = {
    get: jest
      .fn()
      .mockImplementation((key: string) =>
        key === 'CRM_WEB_BASE_URL' ? 'https://crm.example' : undefined,
      ),
  }
  const clock = { now: () => NOW }

  const processor = new ReportScheduleProcessor(
    prisma as unknown as PrismaService,
    payloadService as unknown as ScheduledReportPayloadService,
    attachmentService as unknown as ReportAttachmentService,
    emailService as unknown as ReportEmailService,
    notifications as unknown as NotificationsService,
    permissions as unknown as PermissionsService,
    config as unknown as ConfigService,
    clock,
    DEFAULT_BATCH_SIZE,
    DEFAULT_CONCURRENCY,
  )
  return {
    processor,
    prisma,
    payloadService,
    attachmentService,
    emailService,
    notifications,
    permissions,
  }
}

describe('ReportScheduleProcessor', () => {
  it('registers the hourly due scan and minute retry scan cron jobs', () => {
    // SetMetadata stores on descriptor.value (the method function).
    const due = Reflect.getMetadata(
      'SCHEDULE_CRON_OPTIONS',
      ReportScheduleProcessor.prototype.scanDueSchedules,
    )
    const retry = Reflect.getMetadata(
      'SCHEDULE_CRON_OPTIONS',
      ReportScheduleProcessor.prototype.scanRetries,
    )
    expect(due.cronTime).toBe('0 0 * * * *')
    expect(retry.cronTime).toBe('0 * * * * *')
  })

  it('exposes bounded batch and concurrency defaults', () => {
    expect(DEFAULT_BATCH_SIZE).toBe(100)
    expect(DEFAULT_CONCURRENCY).toBe(5)
    expect(STALE_CLAIM_LEASE_MS).toBe(15 * 60 * 1000)
  })

  describe('sanitizeExecutionError', () => {
    it('redacts recipient addresses, strips newlines and truncates', () => {
      const message = `550 5.1.1 <a@x.io> rejected\r\nsmtp; data too long ${'x'.repeat(1000)}`
      const out = sanitizeExecutionError(new Error(message), ['a@x.io'])
      expect(out).not.toContain('a@x.io')
      expect(out).not.toContain('\r\n')
      expect(out.length).toBeLessThanOrEqual(500)
    })
  })

  describe('scanDueSchedules', () => {
    it('claims the due occurrence, advances nextRunAt and delivers SUCCESS', async () => {
      const { processor, prisma, emailService, payloadService } = createProcessor({
        due: [scheduleRow()],
      })
      await processor.scanDueSchedules()
      // claim: create execution with scheduledFor = due nextRunAt
      const createArgs = prisma.reportScheduleExecution.create.mock.calls[0][0] as {
        data: {
          scheduledFor: Date
          scheduleId: string
          reportId: string
          status: string
          attemptCount: number
        }
      }
      expect(createArgs.data).toMatchObject({
        scheduleId: 'sched-1',
        reportId: 'rep-1',
        status: 'PROCESSING',
        attemptCount: 1,
      })
      expect(createArgs.data.scheduledFor.toISOString()).toBe('2026-02-01T11:00:00.000Z')
      // advance to next daily 09:00 after 12:00Z
      const updateArgs = prisma.reportSchedule.update.mock.calls[0][0] as {
        data: { nextRunAt: Date }
      }
      expect(updateArgs.data.nextRunAt.toISOString()).toBe('2026-02-02T09:00:00.000Z')
      // generation + delivery
      expect(payloadService.buildForReport).toHaveBeenCalledWith(
        'tenant-1',
        'user-1',
        expect.anything(),
        'https://crm.example',
      )
      expect(emailService.send).toHaveBeenCalledTimes(1)
      const sendArgs = emailService.send.mock.calls[0][0]
      expect(sendArgs.to).toEqual(['a@x.io'])
      expect(sendArgs.messageId).toContain('exec-')
      // SUCCESS persisted with providerMessageId + lastRunAt
      const successUpdate = prisma.reportScheduleExecution.update.mock.calls.find(
        (c) => c[0].data.status === 'SUCCESS',
      )
      expect(successUpdate).toBeTruthy()
      expect(successUpdate[0].data.providerMessageId).toBe('provider-1')
      expect(prisma.reportSchedule.update.mock.calls.some((c) => c[0].data.lastRunAt)).toBe(true)
    })

    it('performs no generation/send when another instance claimed the occurrence', async () => {
      const p2002 = new PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'x',
      })
      const { processor, payloadService, emailService } = createProcessor({
        due: [scheduleRow()],
        executionCreateError: p2002,
      })
      await processor.scanDueSchedules()
      expect(payloadService.buildForReport).not.toHaveBeenCalled()
      expect(emailService.send).not.toHaveBeenCalled()
    })

    it('honours the batch size limit in the due query', async () => {
      const { processor, prisma } = createProcessor({ due: [] })
      await processor.scanDueSchedules()
      const where = prisma.reportSchedule.findMany.mock.calls[0][0]
      expect(where).toMatchObject({
        where: { isActive: true, deletedAt: null, nextRunAt: { lte: NOW } },
        take: 100,
      })
    })
  })

  describe('retries', () => {
    it('persists 1/2/4-minute exponential retries and FAILED + one notification at attempt 4', async () => {
      const failingTransport = new EmailSendError('SMTP busy', 'RETRYABLE')
      const { processor, prisma, notifications } = createProcessor({
        due: [scheduleRow()],
        emailError: failingTransport,
        executionUpdate: async (args) => executionRow({ ...(args.data ?? {}) }),
        notifySafe: jest.fn().mockResolvedValue(undefined),
      })
      const sendMock = processor['emailService'] as unknown as { send: jest.Mock }
      let attempt = 0
      sendMock.send.mockImplementation(async () => {
        attempt += 1
        if (attempt < 4) throw new EmailSendError('SMTP busy', 'RETRYABLE')
        return { providerMessageId: 'p-4' }
      })

      await processor.scanDueSchedules() // attempt 1 → retryable
      const updates = prisma.reportScheduleExecution.update.mock.calls.map((c) => c[0])
      const retryUpdate = updates.find((u) => u.data.nextRetryAt)
      expect(retryUpdate).toBeTruthy()
      expect(retryUpdate.data.nextRetryAt.toISOString()).toBe('2026-02-01T12:01:00.000Z')
      expect(retryUpdate.data.attemptCount).toBe(2)
      expect(notifications.notifySafe).not.toHaveBeenCalled()

      // attempts 2 and 3 fail retryable → +2min, +4min (from the failed-attempt
      // instant = injected NOW). Rows are due when nextRetryAt <= NOW.
      const retryRows = [
        executionRow({
          id: 'exec-1',
          attemptCount: 2,
          nextRetryAt: new Date('2026-02-01T11:59:00Z'),
          processingStartedAt: null,
        }),
        executionRow({
          id: 'exec-1',
          attemptCount: 3,
          nextRetryAt: new Date('2026-02-01T11:59:00Z'),
          processingStartedAt: null,
        }),
        executionRow({
          id: 'exec-1',
          attemptCount: 4,
          nextRetryAt: new Date('2026-02-01T11:59:00Z'),
          processingStartedAt: null,
        }),
      ]
      const firstFail = retryRows[0]!
      const secondFail = retryRows[1]!
      const thirdFail = retryRows[2]!

      const {
        processor: p2,
        prisma: pr2,
        notifications: n2,
      } = createProcessor({
        retries: [firstFail],
        emailError: failingTransport,
        executionUpdate: async (args) => executionRow({ ...(args.data ?? {}) }),
      })
      await p2.scanRetries()
      const u2 = pr2.reportScheduleExecution.update.mock.calls.map((c) => c[0])
      expect(u2.find((u) => u.data.attemptCount === 3)?.data.nextRetryAt.toISOString()).toBe(
        '2026-02-01T12:02:00.000Z',
      ) // +2min
      expect(n2.notifySafe).not.toHaveBeenCalled()

      const {
        processor: p3,
        prisma: pr3,
        notifications: n3,
      } = createProcessor({
        retries: [secondFail],
        emailError: failingTransport,
        executionUpdate: async (args) => executionRow({ ...(args.data ?? {}) }),
      })
      await p3.scanRetries()
      const u3 = pr3.reportScheduleExecution.update.mock.calls.map((c) => c[0])
      expect(u3.find((u) => u.data.attemptCount === 4)?.data.nextRetryAt.toISOString()).toBe(
        '2026-02-01T12:04:00.000Z',
      ) // +4min
      expect(n3.notifySafe).not.toHaveBeenCalled()

      // attempt 4 fails → terminal FAILED + one notification with dedupe key
      const {
        processor: p4,
        prisma: pr4,
        notifications: n4,
      } = createProcessor({
        retries: [thirdFail],
        emailError: failingTransport,
        executionUpdate: async (args) => executionRow({ ...(args.data ?? {}) }),
      })
      await p4.scanRetries()
      const u4 = pr4.reportScheduleExecution.update.mock.calls.map((c) => c[0])
      const failed = u4.find((u) => u.data.status === 'FAILED')
      expect(failed).toBeTruthy()
      expect(failed.data.completedAt).toEqual(NOW)
      expect(n4.notifySafe).toHaveBeenCalledTimes(1)
      expect(n4.notifySafe.mock.calls[0][0]).toBe('tenant-1')
      expect(n4.notifySafe.mock.calls[0][2]).toMatchObject({
        recipientUserId: 'user-1',
        type: 'REPORT_SCHEDULE_FAILED',
        dedupeKey: 'report-schedule-failed:exec-1',
      })
      expect(n4.notifySafe.mock.calls[0][2].title).toContain('Q1 Pipeline')
    })

    it('re-running the retry scan against a terminal execution never resends', async () => {
      const { processor, prisma } = createProcessor({
        retries: [executionRow({ status: 'FAILED', attemptCount: 4 })],
        executionUpdateMany: async () => ({ count: 0 }), // claim fails
      })
      await processor.scanRetries()
      expect(prisma.reportScheduleExecution.update).not.toHaveBeenCalled()
    })
  })

  describe('SKIPPED semantics', () => {
    it('skips and deactivates when the owner is no longer active', async () => {
      const { processor, prisma, emailService, notifications } = createProcessor({
        due: [scheduleRow()],
        userFindFirst: null,
      })
      await processor.scanDueSchedules()
      const updates = prisma.reportScheduleExecution.update.mock.calls.map((c) => c[0])
      const skipped = updates.find((u) => u.data.status === 'SKIPPED')
      expect(skipped).toBeTruthy()
      expect(skipped.data.errorCode).toBe('OWNER_INACTIVE')
      // schedule deactivated
      expect(
        prisma.reportSchedule.update.mock.calls.some((c) => c[0].data.isActive === false),
      ).toBe(true)
      expect(emailService.send).not.toHaveBeenCalled()
      expect(notifications.notifySafe).not.toHaveBeenCalled()
    })

    it('skips (no retries) when the report is no longer visible', async () => {
      const { processor, prisma, notifications } = createProcessor({
        due: [scheduleRow()],
        reportFindFirst: null,
      })
      await processor.scanDueSchedules()
      const updates = prisma.reportScheduleExecution.update.mock.calls.map((c) => c[0])
      const skipped = updates.find((u) => u.data.status === 'SKIPPED')
      expect(skipped?.data.errorCode).toBe('REPORT_UNAVAILABLE')
      expect(notifications.notifySafe).not.toHaveBeenCalled()
    })

    it('skips on attachment limit overflow (non-transient)', async () => {
      const { processor, prisma } = createProcessor({
        due: [scheduleRow()],
        attachmentError: new AttachmentLimitError('too big'),
      })
      await processor.scanDueSchedules()
      const updates = prisma.reportScheduleExecution.update.mock.calls.map((c) => c[0])
      const skipped = updates.find((u) => u.data.status === 'SKIPPED')
      expect(skipped?.data.errorCode).toBe('ATTACHMENT_LIMIT')
    })

    it('skips unsupported reports instead of retrying', async () => {
      const { processor, prisma } = createProcessor({
        due: [scheduleRow()],
        payloadError: new BadRequestException('Unsupported report type'),
      })
      await processor.scanDueSchedules()
      const updates = prisma.reportScheduleExecution.update.mock.calls.map((c) => c[0])
      const skipped = updates.find((u) => u.data.status === 'SKIPPED')
      expect(skipped?.data.errorCode).toBe('UNSUPPORTED_REPORT')
    })

    it('skips when a retried schedule was paused/deleted meanwhile', async () => {
      const inactiveSchedule = scheduleRow({ isActive: false })
      const { processor, prisma, notifications } = createProcessor({
        retries: [
          executionRow({
            attemptCount: 2,
            nextRetryAt: new Date('2026-02-01T11:59:00Z'),
            processingStartedAt: null,
          }),
        ],
      })
      // Override the schedule attached to the retry row with an inactive one.
      const findMany = prisma.reportScheduleExecution.findMany as jest.Mock
      findMany.mockResolvedValueOnce([
        { ...executionRow({ attemptCount: 2 }), schedule: inactiveSchedule },
      ])
      await processor.scanRetries()
      const updates = prisma.reportScheduleExecution.update.mock.calls.map((c) => c[0])
      const skipped = updates.find((u) => u.data.status === 'SKIPPED')
      expect(skipped?.data.errorCode).toBe('SCHEDULE_INACTIVE')
      expect(notifications.notifySafe).not.toHaveBeenCalled()
    })
  })

  describe('tenant scoping', () => {
    it('scopes the ADMIN role lookup to the schedule tenant', async () => {
      const { processor, prisma } = createProcessor({ due: [scheduleRow()] })
      await processor.scanDueSchedules()
      const args = prisma.userRole.findMany.mock.calls[0][0]
      expect(args.where).toMatchObject({ userId: 'user-1', role: { tenantId: 'tenant-1' } })
    })
  })

  describe('terminal failure modes', () => {
    it('FAILED immediately (no retry) on email configuration errors', async () => {
      const { processor, prisma, notifications } = createProcessor({
        due: [scheduleRow()],
        emailError: new EmailConfigurationError('SMTP_HOST missing'),
      })
      await processor.scanDueSchedules()
      const updates = prisma.reportScheduleExecution.update.mock.calls.map((c) => c[0])
      const failed = updates.find((u) => u.data.status === 'FAILED')
      expect(failed?.data.errorCode).toBe('EMAIL_CONFIG')
      expect(notifications.notifySafe).toHaveBeenCalledTimes(1)
    })

    it('SKIPPED and deactivates (no notification) on terminal SMTP rejection', async () => {
      const { processor, prisma, notifications } = createProcessor({
        due: [scheduleRow()],
        emailError: new EmailSendError('554 relay denied', 'TERMINAL'),
      })
      await processor.scanDueSchedules()
      const updates = prisma.reportScheduleExecution.update.mock.calls.map((c) => c[0])
      const skipped = updates.find((u) => u.data.status === 'SKIPPED')
      expect(skipped?.data.errorCode).toBe('SMTP_REJECTED')
      expect(skipped?.data.errorMessage).not.toContain('a@x.io') // sanitized
      // schedule deactivated so a permanently-invalid recipient cannot re-notify each period
      expect(
        prisma.reportSchedule.update.mock.calls.some((c) => c[0].data.isActive === false),
      ).toBe(true)
      expect(notifications.notifySafe).not.toHaveBeenCalled()
    })

    it('treats unknown errors as transient and consumes the retry budget', async () => {
      const { processor, prisma } = createProcessor({
        due: [scheduleRow()],
        emailError: new Error('mystery failure'),
      })
      await processor.scanDueSchedules()
      const updates = prisma.reportScheduleExecution.update.mock.calls.map((c) => c[0])
      const retry = updates.find((u) => u.data.nextRetryAt)
      expect(retry?.data.attemptCount).toBe(2)
      expect(retry?.data.errorCode).toBe('UNKNOWN')
    })

    it('terminates FAILED when an execution exceeds the attempt budget', async () => {
      const { processor, prisma } = createProcessor({
        retries: [
          executionRow({
            attemptCount: MAX_ATTEMPTS + 1,
            nextRetryAt: new Date('2026-02-01T11:59:00Z'),
            processingStartedAt: null,
          }),
        ],
      })
      await processor.scanRetries()
      const updates = prisma.reportScheduleExecution.update.mock.calls.map((c) => c[0])
      const failed = updates.find((u) => u.data.status === 'FAILED')
      expect(failed?.data.errorCode).toBe('MAX_ATTEMPTS')
    })
  })

  describe('stale claim recovery', () => {
    it('re-claims PROCESSING rows whose lease expired (15 min) and continues', async () => {
      const stale = executionRow({
        processingStartedAt: new Date('2026-02-01T11:00:00Z'), // 1h old
        attemptCount: 1,
        nextRetryAt: null,
      })
      const { processor, prisma } = createProcessor({
        retries: [stale],
      })
      await processor.scanRetries()
      const claimWhere = prisma.reportScheduleExecution.updateMany.mock.calls[0][0].where
      expect(claimWhere).toMatchObject({ id: 'exec-1', status: 'PROCESSING' })
      expect(claimWhere.OR[1].processingStartedAt.lte.toISOString()).toBe(
        '2026-02-01T11:45:00.000Z',
      )
      // recovery continues the same execution (delivery attempted again)
      expect(prisma.reportScheduleExecution.update).toHaveBeenCalled()
    })
  })
})
