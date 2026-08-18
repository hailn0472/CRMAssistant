/**
 * Story 6.5 (Contract E23-E28, AC 9-15): hourly due dispatch, durable retries
 * and terminal failure notification.
 *
 * Nest cron only WAKES the processor — PostgreSQL execution rows are the
 * durable source of truth. Each due occurrence is claimed under a unique
 * (scheduleId, scheduledFor) constraint in a short transaction; a losing
 * instance performs no generation/send. Retry = initial attempt + three
 * retries at 1/2/4 minutes, persisted in `nextRetryAt` so process restarts
 * never lose state. Terminal outcomes: SUCCESS (SMTP accepted), FAILED (after
 * attempt 4) with exactly one deduped REPORT_SCHEDULE_FAILED notification,
 * SKIPPED (inactive/deleted/access-revoked/unsupported — no retries).
 */
import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { ConfigService } from '@nestjs/config'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

import { PrismaService } from '../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import { PermissionsService } from '../permissions/permissions.service'
import { isPlatformReportType } from './report-types'
import { catalogFor } from './custom-report-catalog'
import {
  TERMINAL_EXECUTION_STATUSES,
  type Clock,
  type ReportDeliveryFormat,
  type ReportScheduleExecutionStatus,
  SYSTEM_CLOCK,
} from './report-schedule-types'
import {
  calculateNextRun,
  MAX_ATTEMPTS,
  retryDelayMsForAttempt,
} from './report-schedule-calculation'
import {
  cadenceFromSchedule,
  REPORT_SCHEDULE_SELECT,
  type ReportScheduleRecord,
} from './report-schedules.service'
import { ScheduledReportPayloadService } from './scheduled-report-payload.service'
import { ReportAttachmentService, AttachmentLimitError } from './report-attachment.service'
import {
  ReportEmailService,
  EmailConfigurationError,
  EmailSendError,
  executionMessageId,
} from './report-email.service'
import { renderScheduledReportEmail } from './report-email-template'

export const DEFAULT_BATCH_SIZE = 100
export const DEFAULT_CONCURRENCY = 5
export const STALE_CLAIM_LEASE_MS = 15 * 60 * 1000 // default 15 minutes
export const MAX_ERROR_MESSAGE_LENGTH = 500
export const SCHEDULE_FAILED_NOTIFICATION_DEDUPE_PREFIX = 'report-schedule-failed:'

type ExecutionRow = {
  id: string
  tenantId: string
  scheduleId: string
  reportId: string
  scheduledFor: Date
  status: ReportScheduleExecutionStatus
  attemptCount: number
  nextRetryAt: Date | null
  processingStartedAt: Date | null
  completedAt: Date | null
  errorCode: string | null
  errorMessage: string | null
  providerMessageId: string | null
  createdAt: Date
  updatedAt: Date
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Sanitized/truncated error text — no secrets, newlines or recipient list. */
export function sanitizeExecutionError(error: unknown, recipients: string[]): string {
  let message = error instanceof Error ? error.message : String(error)
  for (const recipient of recipients) {
    message = message.replace(new RegExp(escapeRegExp(recipient), 'gi'), '[redacted]')
  }
  return message
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, MAX_ERROR_MESSAGE_LENGTH)
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let index = 0
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      for (;;) {
        const current = index++
        if (current >= items.length) return
        results[current] = await worker(items[current]!)
      }
    },
  )
  await Promise.all(workers)
  return results
}

@Injectable()
export class ReportScheduleProcessor {
  private readonly logger = new Logger(ReportScheduleProcessor.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly payloadService: ScheduledReportPayloadService,
    private readonly attachmentService: ReportAttachmentService,
    private readonly emailService: ReportEmailService,
    private readonly notificationsService: NotificationsService,
    private readonly permissionsService: PermissionsService,
    private readonly configService: ConfigService,
    // Injectable clock/bounds for deterministic tests; defaults to system.
    @Optional() private readonly clock: Clock = SYSTEM_CLOCK,
    @Optional() private readonly batchSize: number = DEFAULT_BATCH_SIZE,
    @Optional() private readonly concurrency: number = DEFAULT_CONCURRENCY,
  ) {}

  /** Hourly due scan (six-field Nest cron: second minute hour ...). */
  @Cron('0 0 * * * *')
  async scanDueSchedules(): Promise<void> {
    const now = this.clock.now()
    const due = await this.prisma.reportSchedule.findMany({
      where: { isActive: true, deletedAt: null, nextRunAt: { lte: now } },
      select: REPORT_SCHEDULE_SELECT,
      orderBy: { nextRunAt: 'asc' },
      take: this.batchSize,
    })
    if (due.length === 0) return
    this.logger.log(`Report schedule due scan: ${due.length} due schedule(s)`)
    await mapWithConcurrency(due, this.concurrency, async (schedule) => {
      const claim = await this.claimDueOccurrence(schedule, now)
      if (!claim.claimed) {
        return // losing instance — no generation/send
      }
      try {
        await this.processExecution(claim.execution, schedule)
      } catch (error) {
        this.logger.error(
          `Unhandled processor error for execution ${claim.execution.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    })
  }

  /** Minute-level retry + stale-claim recovery scan. */
  @Cron('0 * * * * *')
  async scanRetries(): Promise<void> {
    const now = this.clock.now()
    const staleThreshold = new Date(now.getTime() - STALE_CLAIM_LEASE_MS)
    const rows = await this.prisma.reportScheduleExecution.findMany({
      where: {
        status: 'PROCESSING',
        OR: [
          { nextRetryAt: { lte: now }, processingStartedAt: null },
          { processingStartedAt: { lte: staleThreshold } },
        ],
      },
      include: {
        schedule: {
          include: { report: { select: { id: true, name: true, type: true } } },
        },
      },
      orderBy: { nextRetryAt: 'asc' },
      take: this.batchSize,
    })
    if (rows.length === 0) return
    this.logger.log(`Report schedule retry scan: ${rows.length} due execution(s)`)
    await mapWithConcurrency(rows, this.concurrency, async (row) => {
      const claimed = await this.claimRetry(row.id, now, staleThreshold)
      if (!claimed) return
      const schedule = row.schedule as unknown as ReportScheduleRecord
      try {
        await this.processExecution(row as unknown as ExecutionRow, schedule)
      } catch (error) {
        this.logger.error(
          `Unhandled processor error for retry execution ${row.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    })
  }

  /**
   * Contract E24: claim each due occurrence by creating the unique execution
   * row and atomically advancing nextRunAt in the same short transaction.
   * Missed-run coalescing: at most one recovery execution per stored due
   * occurrence, then nextRunAt jumps to the next future occurrence — no
   * catch-up flood (Contract B10).
   */
  private async claimDueOccurrence(
    schedule: {
      id: string
      tenantId: string
      reportId: string
      nextRunAt: Date
      frequency: ReportScheduleRecord['frequency']
      timezone: string
      scheduledTime: string
      dayOfWeek: number | null
      dayOfMonth: number | null
      startMonth: number | null
      cronExpression: string | null
    },
    now: Date,
  ): Promise<{ execution: ExecutionRow; claimed: boolean }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const scheduledFor = schedule.nextRunAt
        const execution = await tx.reportScheduleExecution.create({
          data: {
            tenantId: schedule.tenantId,
            scheduleId: schedule.id,
            reportId: schedule.reportId,
            scheduledFor,
            status: 'PROCESSING',
            attemptCount: 1,
            processingStartedAt: now,
          },
        })
        const next = calculateNextRun(cadenceFromSchedule(schedule), now)
        await tx.reportSchedule.update({
          where: { id: schedule.id },
          data: { nextRunAt: next, updatedBy: 'system' },
        })
        return { execution: execution as unknown as ExecutionRow, claimed: true }
      })
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        // Unique (scheduleId, scheduledFor) — another instance claimed it.
        // The interactive transaction is aborted by the unique violation, so
        // read the existing row OUTSIDE the transaction.
        const existing = await this.prisma.reportScheduleExecution.findUnique({
          where: {
            scheduleId_scheduledFor: {
              scheduleId: schedule.id,
              scheduledFor: schedule.nextRunAt,
            },
          },
        })
        return { execution: existing as unknown as ExecutionRow, claimed: false }
      }
      throw error
    }
  }

  /** Atomic conditional claim for retry/stale rows; a losing instance skips. */
  private async claimRetry(executionId: string, now: Date, staleThreshold: Date): Promise<boolean> {
    const result = await this.prisma.reportScheduleExecution.updateMany({
      where: {
        id: executionId,
        status: 'PROCESSING',
        OR: [
          { nextRetryAt: { lte: now }, processingStartedAt: null },
          { processingStartedAt: { lte: staleThreshold } },
        ],
      },
      data: { processingStartedAt: now },
    })
    return result.count === 1
  }

  /**
   * Contract C15: re-check owner/report/permission state at execution time
   * under the schedule owner's CURRENT identity. Invalid state → SKIPPED +
   * schedule deactivation, no retries, no attachment.
   */
  private async validateExecutionAccess(
    tenantId: string,
    ownerId: string,
    reportId: string,
  ): Promise<{ ok: true; reportType: string } | { ok: false; code: string; message: string }> {
    const owner = await this.prisma.user.findFirst({
      where: { id: ownerId, tenantId, isActive: true, deletedAt: null },
      select: { id: true },
    })
    if (!owner) {
      return { ok: false, code: 'OWNER_INACTIVE', message: 'Schedule owner is no longer active' }
    }
    const report = await this.prisma.report.findFirst({
      where: {
        id: reportId,
        tenantId,
        deletedAt: null,
        OR: [{ createdBy: ownerId }, { isPublic: true }],
      },
      select: { id: true, type: true },
    })
    if (!report) {
      return { ok: false, code: 'REPORT_UNAVAILABLE', message: 'Report is no longer available' }
    }
    if (!isPlatformReportType(report.type)) {
      return {
        ok: false,
        code: 'UNSUPPORTED_REPORT',
        message: 'Report type is no longer supported',
      }
    }
    // Background path has no GraphQL context — resolve the ADMIN bypass from
    // the persisted role rows (Contract C13/C15). User IDs are globally
    // unique, but scope the role to the schedule tenant for tenant-isolation
    // consistency.
    const roles = await this.prisma.userRole.findMany({
      where: { userId: ownerId, role: { tenantId } },
      select: { role: { select: { name: true } } },
    })
    if (roles.some((r) => r.role.name === 'ADMIN')) {
      return { ok: true, reportType: report.type }
    }
    const reportRead = await this.permissionsService.hasPermission(ownerId, 'REPORT', 'READ')
    if (!reportRead) {
      return {
        ok: false,
        code: 'PERMISSION_REVOKED',
        message: 'Required REPORT:READ permission revoked',
      }
    }
    if (report.type === 'CUSTOM') {
      let source
      try {
        source = await this.payloadService.resolveCustomSource(tenantId, ownerId, reportId)
      } catch {
        return { ok: false, code: 'REPORT_UNAVAILABLE', message: 'Report is no longer available' }
      }
      const gate = catalogFor(source).readGate
      const ok = await this.permissionsService.hasPermission(ownerId, gate, 'READ')
      if (!ok) {
        return {
          ok: false,
          code: 'PERMISSION_REVOKED',
          message: `Required ${gate}:READ permission revoked`,
        }
      }
      return { ok: true, reportType: 'CUSTOM' }
    }
    const dealRead = await this.permissionsService.hasPermission(ownerId, 'DEAL', 'READ')
    if (!dealRead) {
      return {
        ok: false,
        code: 'PERMISSION_REVOKED',
        message: 'Required DEAL:READ permission revoked',
      }
    }
    return { ok: true, reportType: report.type }
  }

  /**
   * Generates, renders, sends and persists one attempt. Never holds a DB
   * transaction while generating files or talking to SMTP (Contract E24).
   */
  private async processExecution(
    execution: ExecutionRow,
    schedule: ReportScheduleRecord,
  ): Promise<void> {
    const now = this.clock.now()

    // Guard: terminal executions must never be regenerated or resent.
    if (TERMINAL_EXECUTION_STATUSES.includes(execution.status)) return
    if (execution.attemptCount > MAX_ATTEMPTS) {
      await this.markTerminal(execution, 'FAILED', 'MAX_ATTEMPTS', 'Maximum attempts exceeded', now)
      return
    }
    if (schedule.deletedAt || !schedule.isActive) {
      await this.markSkipped(
        execution,
        schedule,
        'SCHEDULE_INACTIVE',
        'Schedule is paused or deleted',
        now,
      )
      return
    }

    const access = await this.validateExecutionAccess(
      execution.tenantId,
      schedule.userId,
      execution.reportId,
    )
    if (!access.ok) {
      await this.markSkipped(execution, schedule, access.code, access.message, now)
      return
    }

    const report = await this.payloadService.loadReport(
      execution.tenantId,
      schedule.userId,
      execution.reportId,
    )
    if (!report) {
      await this.markSkipped(
        execution,
        schedule,
        'REPORT_UNAVAILABLE',
        'Report is no longer available',
        now,
      )
      return
    }

    const baseUrl = this.configService.get<string>('CRM_WEB_BASE_URL') ?? ''

    try {
      const payload = await this.payloadService.buildForReport(
        execution.tenantId,
        schedule.userId,
        report,
        baseUrl,
      )
      const attachment = await this.attachmentService.render(payload, schedule.format)
      const rendered = renderScheduledReportEmail({
        payload,
        branding: {
          name: schedule.tenant?.name ?? 'CRM',
          logoUrl: schedule.tenant?.logoUrl ?? null,
          primaryColor: schedule.tenant?.primaryColor ?? null,
        },
        attachmentFilename: attachment.filename,
      })
      const result = await this.emailService.send({
        to: schedule.recipients,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        attachments: [attachment],
        messageId: executionMessageId(execution.id),
      })
      await this.markSuccess(execution, schedule, result.providerMessageId, now)
    } catch (error) {
      if (error instanceof AttachmentLimitError) {
        await this.markSkipped(
          execution,
          schedule,
          'ATTACHMENT_LIMIT',
          sanitizeExecutionError(error, schedule.recipients),
          now,
        )
        return
      }
      if (error instanceof EmailConfigurationError) {
        await this.markFailed(
          execution,
          schedule,
          'EMAIL_CONFIG',
          sanitizeExecutionError(error, schedule.recipients),
          now,
        )
        return
      }
      if (error instanceof EmailSendError) {
        if (error.kind === 'TERMINAL') {
          // Invalid address / SMTP 5xx is non-retryable and will not fix
          // itself — write SKIPPED and deactivate so a permanently-invalid
          // recipient does not fail and re-notify every occurrence.
          await this.markSkipped(
            execution,
            schedule,
            'SMTP_REJECTED',
            sanitizeExecutionError(error, schedule.recipients),
            now,
          )
          return
        }
        await this.handleRetryableFailure(
          execution,
          schedule,
          'SMTP_TRANSIENT',
          sanitizeExecutionError(error, schedule.recipients),
          now,
        )
        return
      }
      if (error instanceof BadRequestException) {
        // Unsupported/invalid report config — non-retryable SKIPPED.
        await this.markSkipped(
          execution,
          schedule,
          'UNSUPPORTED_REPORT',
          sanitizeExecutionError(error, schedule.recipients),
          now,
        )
        return
      }
      // Unknown error — treat as transient, consume the retry budget.
      await this.handleRetryableFailure(
        execution,
        schedule,
        'UNKNOWN',
        sanitizeExecutionError(error, schedule.recipients),
        now,
      )
    }
  }

  /** Contract E25/E26: exponential 1/2/4-minute persisted retries. */
  private async handleRetryableFailure(
    execution: ExecutionRow,
    schedule: ReportScheduleRecord,
    errorCode: string,
    errorMessage: string,
    now: Date,
  ): Promise<void> {
    if (execution.attemptCount >= MAX_ATTEMPTS) {
      await this.markFailed(execution, schedule, errorCode, errorMessage, now)
      return
    }
    const nextRetryAt = new Date(now.getTime() + retryDelayMsForAttempt(execution.attemptCount))
    await this.prisma.reportScheduleExecution.update({
      where: { id: execution.id },
      data: {
        attemptCount: execution.attemptCount + 1,
        nextRetryAt,
        processingStartedAt: null,
        errorCode,
        errorMessage,
      },
    })
    this.logger.warn(
      `Schedule execution ${execution.id} attempt ${execution.attemptCount} failed (${errorCode}); next retry at ${nextRetryAt.toISOString()}`,
    )
  }

  private async markSuccess(
    execution: ExecutionRow,
    schedule: ReportScheduleRecord,
    providerMessageId: string | null,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.reportScheduleExecution.update({
        where: { id: execution.id },
        data: {
          status: 'SUCCESS',
          completedAt: now,
          providerMessageId,
          nextRetryAt: null,
          processingStartedAt: null,
        },
      }),
      this.prisma.reportSchedule.update({
        where: { id: schedule.id },
        data: { lastRunAt: now, updatedBy: 'system' },
      }),
    ])
    this.logger.log(`Schedule execution ${execution.id} delivered successfully`)
  }

  /**
   * Contract E27: SKIPPED with a safe reason and no retries; schedule
   * deactivated. lastRunAt reflects the terminal outcome.
   */
  private async markSkipped(
    execution: ExecutionRow,
    schedule: ReportScheduleRecord,
    errorCode: string,
    errorMessage: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.reportScheduleExecution.update({
        where: { id: execution.id },
        data: {
          status: 'SKIPPED',
          completedAt: now,
          nextRetryAt: null,
          processingStartedAt: null,
          errorCode,
          errorMessage,
        },
      }),
      this.prisma.reportSchedule.update({
        where: { id: schedule.id },
        data: { isActive: false, lastRunAt: now, updatedBy: 'system' },
      }),
    ])
    this.logger.warn(`Schedule execution ${execution.id} skipped (${errorCode})`)
  }

  /**
   * Contract E26: terminal FAILED on the fourth failed attempt + exactly one
   * deduped REPORT_SCHEDULE_FAILED notification. Notification failure never
   * changes the execution's FAILED status (notifySafe never throws).
   */
  private async markFailed(
    execution: ExecutionRow,
    schedule: ReportScheduleRecord,
    errorCode: string,
    errorMessage: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.reportScheduleExecution.update({
        where: { id: execution.id },
        data: {
          status: 'FAILED',
          completedAt: now,
          nextRetryAt: null,
          processingStartedAt: null,
          errorCode,
          errorMessage,
        },
      }),
      this.prisma.reportSchedule.update({
        where: { id: schedule.id },
        data: { lastRunAt: now, updatedBy: 'system' },
      }),
    ])
    await this.notificationsService.notifySafe(schedule.tenantId, schedule.userId, {
      recipientUserId: schedule.userId,
      type: 'REPORT_SCHEDULE_FAILED',
      title: `Scheduled report delivery failed: ${schedule.report?.name ?? 'report'}`,
      body: `The scheduled report "${schedule.report?.name ?? 'report'}" could not be delivered after ${MAX_ATTEMPTS} attempts. Review your schedule at /reports/schedules.`,
      dedupeKey: `${SCHEDULE_FAILED_NOTIFICATION_DEDUPE_PREFIX}${execution.id}`,
    })
    this.logger.error(
      `Schedule execution ${execution.id} failed permanently after ${MAX_ATTEMPTS} attempts (${errorCode})`,
    )
  }

  private async markTerminal(
    execution: ExecutionRow,
    status: 'FAILED',
    errorCode: string,
    errorMessage: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.reportScheduleExecution.update({
      where: { id: execution.id },
      data: {
        status,
        completedAt: now,
        nextRetryAt: null,
        processingStartedAt: null,
        errorCode,
        errorMessage,
      },
    })
  }
}

export type { ReportDeliveryFormat }
