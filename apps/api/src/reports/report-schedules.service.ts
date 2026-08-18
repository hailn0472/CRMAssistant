/**
 * Story 6.5 (Contract C11-C16, B9): owner-scoped schedule CRUD/pause/resume/
 * list with tenant/report/source gates, server-owned next-run computation and
 * exactly one service-level audit record per user mutation.
 *
 * Ownership is ALWAYS enforced for schedule mutations (ADMIN bypasses the
 * permission gates, never ownership — Contract C13). Background execution
 * never goes through this service; it lives in ReportScheduleProcessor.
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import type { Prisma } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { PermissionsService } from '../permissions/permissions.service'
import type { ReportRow } from './sales-reports.service'
import { CustomReportsService } from './custom-reports.service'
import { catalogFor } from './custom-report-catalog'
import { isPlatformReportType } from './report-types'
import {
  ScheduleValidationError,
  normalizeAndValidateScheduleInput,
  normalizeAndValidateScheduleUpdate,
  validateCadenceConsistency,
  type Clock,
  type NormalizedScheduleInput,
  type ReportDeliveryFormat,
  type ReportScheduleFrequency,
  SYSTEM_CLOCK,
} from './report-schedule-types'
import { calculateNextRun, type ScheduleCadence } from './report-schedule-calculation'

export const REPORT_SCHEDULE_ENTITY = 'REPORT_SCHEDULE'

export type ScheduleListInput = {
  page?: number
  pageSize?: number
  includeInactive?: boolean
}

/** Every field the Pothos refs expose must be in this select (Trap T1). */
export const REPORT_SCHEDULE_SELECT = {
  id: true,
  tenantId: true,
  reportId: true,
  userId: true,
  frequency: true,
  recipients: true,
  format: true,
  timezone: true,
  scheduledTime: true,
  dayOfWeek: true,
  dayOfMonth: true,
  startMonth: true,
  cronExpression: true,
  nextRunAt: true,
  lastRunAt: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
  report: {
    select: {
      id: true,
      name: true,
      type: true,
      isPublic: true,
      createdAt: true,
      updatedAt: true,
      createdBy: true,
      deletedAt: true,
    },
  },
  tenant: {
    select: {
      id: true,
      name: true,
      logoUrl: true,
      primaryColor: true,
    },
  },
  executions: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: {
      id: true,
      tenantId: true,
      scheduleId: true,
      reportId: true,
      scheduledFor: true,
      status: true,
      attemptCount: true,
      nextRetryAt: true,
      processingStartedAt: true,
      completedAt: true,
      errorCode: true,
      errorMessage: true,
      providerMessageId: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} as const

export type ReportScheduleRecord = Prisma.ReportScheduleGetPayload<{
  select: typeof REPORT_SCHEDULE_SELECT
}>

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

export function cadenceFromSchedule(schedule: {
  frequency: ReportScheduleFrequency
  timezone: string
  scheduledTime: string
  dayOfWeek: number | null
  dayOfMonth: number | null
  startMonth: number | null
  cronExpression: string | null
}): ScheduleCadence {
  return {
    frequency: schedule.frequency,
    timezone: schedule.timezone,
    scheduledTime: schedule.scheduledTime,
    dayOfWeek: schedule.dayOfWeek ?? undefined,
    dayOfMonth: schedule.dayOfMonth ?? undefined,
    startMonth: schedule.startMonth ?? undefined,
    cronExpression: schedule.cronExpression ?? undefined,
  }
}

@Injectable()
export class ReportSchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly permissionsService: PermissionsService,
    private readonly customReportsService: CustomReportsService,
    // Injectable clock for deterministic tests; defaults to the system clock.
    @Optional() private readonly clock: Clock = SYSTEM_CLOCK,
  ) {}

  /**
   * Contract C14: the referenced active report must be tenant-scoped,
   * non-deleted and owned-or-public. Private non-owner, cross-tenant,
   * soft-deleted or missing reports all yield the same `Report not found`.
   */
  async resolveReport(tenantId: string, userId: string, reportId: string): Promise<ReportRow> {
    const report = await this.prisma.report.findFirst({
      where: {
        id: reportId,
        tenantId,
        deletedAt: null,
        OR: [{ createdBy: userId }, { isPublic: true }],
      },
    })
    if (!report) {
      throw new NotFoundException('Report not found')
    }
    if (!isPlatformReportType(report.type)) {
      throw new BadRequestException(`Unsupported report type: ${report.type}`)
    }
    return report
  }

  /**
   * Contract C13: source-domain permission required to execute the report —
   * DEAL:READ for the six sales types; the custom source catalog's readGate
   * for CUSTOM. ADMIN bypass remains established behavior (Contract C13).
   */
  async assertSourcePermission(
    tenantId: string,
    userId: string,
    report: ReportRow,
    opts: { isAdmin?: boolean } = {},
  ): Promise<void> {
    if (opts.isAdmin) return
    if (report.type === 'CUSTOM') {
      const source = await this.customReportsService.resolveReportDataSource(
        tenantId,
        userId,
        report.id,
      )
      const gate = catalogFor(source).readGate
      const ok = await this.permissionsService.hasPermission(userId, gate, 'READ')
      if (!ok) {
        throw new ForbiddenException(`Missing required permission: ${gate}:READ`)
      }
      return
    }
    const ok = await this.permissionsService.hasPermission(userId, 'DEAL', 'READ')
    if (!ok) {
      throw new ForbiddenException('Missing required permission: DEAL:READ')
    }
  }

  private async findOwned(
    tenantId: string,
    userId: string,
    id: string,
  ): Promise<ReportScheduleRecord> {
    const schedule = await this.prisma.reportSchedule.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: REPORT_SCHEDULE_SELECT,
    })
    if (!schedule) {
      throw new NotFoundException('Schedule not found')
    }
    if (schedule.userId !== userId) {
      throw new ForbiddenException('You can only manage your own schedules')
    }
    return schedule
  }

  async create(
    tenantId: string,
    userId: string,
    input: unknown,
    opts: { isAdmin?: boolean } = {},
  ): Promise<ReportScheduleRecord> {
    let normalized: NormalizedScheduleInput
    try {
      normalized = normalizeAndValidateScheduleInput(input)
    } catch (error) {
      if (error instanceof ScheduleValidationError) {
        throw new BadRequestException(error.message)
      }
      throw error
    }
    if (!normalized.reportId) {
      throw new BadRequestException('reportId is required')
    }
    const report = await this.resolveReport(tenantId, userId, normalized.reportId)
    await this.assertSourcePermission(tenantId, userId, report, opts)

    const cadence: ScheduleCadence = {
      frequency: normalized.frequency,
      timezone: normalized.timezone,
      scheduledTime: normalized.scheduledTime,
      dayOfWeek: normalized.dayOfWeek,
      dayOfMonth: normalized.dayOfMonth,
      startMonth: normalized.startMonth,
      cronExpression: normalized.cronExpression,
    }
    const nextRunAt = calculateNextRun(cadence, this.clock.now())

    const schedule = await this.prisma.reportSchedule.create({
      data: {
        tenantId,
        reportId: report.id,
        userId,
        frequency: normalized.frequency,
        recipients: normalized.recipients,
        format: normalized.format,
        timezone: normalized.timezone,
        scheduledTime: normalized.scheduledTime,
        dayOfWeek: normalized.dayOfWeek ?? null,
        dayOfMonth: normalized.dayOfMonth ?? null,
        startMonth: normalized.startMonth ?? null,
        cronExpression: normalized.cronExpression ?? null,
        nextRunAt,
        createdBy: userId,
        updatedBy: userId,
      },
      select: REPORT_SCHEDULE_SELECT,
    })

    await this.auditService.log({
      tenantId,
      userId,
      action: 'CREATE',
      entity: REPORT_SCHEDULE_ENTITY,
      entityId: schedule.id,
      details: {
        frequency: normalized.frequency,
        format: normalized.format,
        recipientsCount: normalized.recipients.length,
        reportId: report.id,
      },
    })
    return schedule
  }

  /**
   * Contract B9: cadence-affecting updates recalculate `nextRunAt` from the
   * server clock; recipient/format-only changes keep the existing schedule.
   * Paused schedules stay paused (updating does not resume).
   */
  async update(
    tenantId: string,
    userId: string,
    id: string,
    input: unknown,
  ): Promise<ReportScheduleRecord> {
    const existing = await this.findOwned(tenantId, userId, id)

    let update: Partial<NormalizedScheduleInput>
    try {
      update = normalizeAndValidateScheduleUpdate(input)
    } catch (error) {
      if (error instanceof ScheduleValidationError) {
        throw new BadRequestException(error.message)
      }
      throw error
    }

    const mergedCadence: ScheduleCadence = {
      frequency: update.frequency ?? existing.frequency,
      timezone: update.timezone ?? existing.timezone,
      scheduledTime: update.scheduledTime ?? existing.scheduledTime,
      dayOfWeek: update.dayOfWeek ?? existing.dayOfWeek ?? undefined,
      dayOfMonth: update.dayOfMonth ?? existing.dayOfMonth ?? undefined,
      startMonth: update.startMonth ?? existing.startMonth ?? undefined,
      cronExpression: update.cronExpression ?? existing.cronExpression ?? undefined,
    }
    try {
      validateCadenceConsistency(mergedCadence.frequency, mergedCadence)
    } catch (error) {
      if (error instanceof ScheduleValidationError) {
        throw new BadRequestException(error.message)
      }
      throw error
    }

    const cadenceChanged =
      (update.frequency !== undefined && update.frequency !== existing.frequency) ||
      (update.timezone !== undefined && update.timezone !== existing.timezone) ||
      (update.scheduledTime !== undefined && update.scheduledTime !== existing.scheduledTime) ||
      (update.dayOfWeek !== undefined && (update.dayOfWeek ?? null) !== existing.dayOfWeek) ||
      (update.dayOfMonth !== undefined && (update.dayOfMonth ?? null) !== existing.dayOfMonth) ||
      (update.startMonth !== undefined && (update.startMonth ?? null) !== existing.startMonth) ||
      (update.cronExpression !== undefined &&
        (update.cronExpression ?? null) !== existing.cronExpression)

    const nextRunAt = cadenceChanged
      ? calculateNextRun(mergedCadence, this.clock.now())
      : existing.nextRunAt

    const schedule = await this.prisma.reportSchedule.update({
      where: { id: existing.id },
      data: {
        frequency: mergedCadence.frequency,
        timezone: mergedCadence.timezone,
        scheduledTime: mergedCadence.scheduledTime,
        dayOfWeek: mergedCadence.dayOfWeek ?? null,
        dayOfMonth: mergedCadence.dayOfMonth ?? null,
        startMonth: mergedCadence.startMonth ?? null,
        cronExpression: mergedCadence.cronExpression ?? null,
        recipients: update.recipients ?? existing.recipients,
        format: update.format ?? existing.format,
        ...(cadenceChanged ? { nextRunAt } : {}),
        updatedBy: userId,
      },
      select: REPORT_SCHEDULE_SELECT,
    })

    await this.auditService.log({
      tenantId,
      userId,
      action: 'UPDATE',
      entity: REPORT_SCHEDULE_ENTITY,
      entityId: schedule.id,
      details: {
        frequency: schedule.frequency,
        format: schedule.format,
        recipientsCount: schedule.recipients.length,
        cadenceChanged,
      },
    })
    return schedule
  }

  /** Contract B9: pause sets isActive=false without creating an execution. */
  async pause(tenantId: string, userId: string, id: string): Promise<ReportScheduleRecord> {
    const existing = await this.findOwned(tenantId, userId, id)
    const schedule = await this.prisma.reportSchedule.update({
      where: { id: existing.id },
      data: { isActive: false, updatedBy: userId },
      select: REPORT_SCHEDULE_SELECT,
    })
    await this.auditService.log({
      tenantId,
      userId,
      action: 'UPDATE',
      entity: REPORT_SCHEDULE_ENTITY,
      entityId: schedule.id,
      details: { paused: true },
    })
    return schedule
  }

  /**
   * Contract B9: resume sets isActive=true and computes a future run from the
   * server clock — it never replays paused occurrences.
   */
  async resume(tenantId: string, userId: string, id: string): Promise<ReportScheduleRecord> {
    const existing = await this.findOwned(tenantId, userId, id)
    const cadence = cadenceFromSchedule(existing)
    const nextRunAt = calculateNextRun(cadence, this.clock.now())
    const schedule = await this.prisma.reportSchedule.update({
      where: { id: existing.id },
      data: { isActive: true, nextRunAt, updatedBy: userId },
      select: REPORT_SCHEDULE_SELECT,
    })
    await this.auditService.log({
      tenantId,
      userId,
      action: 'UPDATE',
      entity: REPORT_SCHEDULE_ENTITY,
      entityId: schedule.id,
      details: { resumed: true, nextRunAt: nextRunAt.toISOString() },
    })
    return schedule
  }

  /** Contract B9/C12: soft delete — deletedAt, isActive=false, no future run. */
  async delete(tenantId: string, userId: string, id: string): Promise<boolean> {
    const existing = await this.findOwned(tenantId, userId, id)
    await this.prisma.reportSchedule.update({
      where: { id: existing.id },
      data: { deletedAt: this.clock.now(), isActive: false, updatedBy: userId },
    })
    await this.auditService.log({
      tenantId,
      userId,
      action: 'DELETE',
      entity: REPORT_SCHEDULE_ENTITY,
      entityId: existing.id,
      details: {},
    })
    return true
  }

  /** Contract C12: owner-only listing with tenant isolation + pagination. */
  async list(
    tenantId: string,
    userId: string,
    filter: ScheduleListInput = {},
  ): Promise<{ items: ReportScheduleRecord[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, filter.page ?? DEFAULT_PAGE)
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filter.pageSize ?? DEFAULT_PAGE_SIZE))
    const where: Prisma.ReportScheduleWhereInput = {
      tenantId,
      userId,
      deletedAt: null,
      ...(filter.includeInactive ? {} : { isActive: true }),
    }
    const [total, items] = await this.prisma.$transaction([
      this.prisma.reportSchedule.count({ where }),
      this.prisma.reportSchedule.findMany({
        where,
        select: REPORT_SCHEDULE_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])
    return { items, total, page, pageSize }
  }

  async findById(tenantId: string, userId: string, id: string): Promise<ReportScheduleRecord> {
    return this.findOwned(tenantId, userId, id)
  }

  /** Background access: schedule rows for the processor (tenant-scoped). */
  async findScheduleForExecution(
    tenantId: string,
    id: string,
  ): Promise<ReportScheduleRecord | null> {
    return this.prisma.reportSchedule.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: REPORT_SCHEDULE_SELECT,
    })
  }
}

// Re-export for GraphQL-layer consumers.
export type { NormalizedScheduleInput, ReportDeliveryFormat, ReportScheduleFrequency }
