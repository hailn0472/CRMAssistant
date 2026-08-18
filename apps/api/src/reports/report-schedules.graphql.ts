/**
 * Story 6.5 (Contract C11-C12): Pothos GraphQL surface for scheduled report
 * delivery. Derives every enum from the shared const tuples in
 * report-schedule-types.ts — never a hand-copied vocabulary. Registered from
 * ReportsModule.onModuleInit(); side-effect imported in graphql/schema.ts
 * (missing registration silently drops the fields — Trap T1).
 */
import { UnauthorizedException } from '@nestjs/common'

/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types */

import { builder } from '../graphql/schema.builder'
import { requirePermission } from '../common/guards/permission-check'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'
import {
  REPORT_SCHEDULE_FREQUENCIES,
  REPORT_DELIVERY_FORMATS,
  REPORT_SCHEDULE_EXECUTION_STATUSES,
} from './report-schedule-types'
import type { ReportScheduleRecord } from './report-schedules.service'
import type { ReportSchedulesService } from './report-schedules.service'

// ─── Enum Types ──────────────────────────────────────────────

const ReportScheduleFrequencyRef = builder.enumType('ReportScheduleFrequency', {
  values: REPORT_SCHEDULE_FREQUENCIES,
})

const ReportDeliveryFormatRef = builder.enumType('ReportDeliveryFormat', {
  values: REPORT_DELIVERY_FORMATS,
})

const ReportScheduleExecutionStatusRef = builder.enumType('ReportScheduleExecutionStatus', {
  values: REPORT_SCHEDULE_EXECUTION_STATUSES,
})

// ─── Object Types ────────────────────────────────────────────

type ReportScheduleReportShape = {
  id: string
  name: string
  type: string
}

const ReportScheduleReportRef = builder.objectRef<ReportScheduleReportShape>('ReportScheduleReport')

ReportScheduleReportRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    type: t.exposeString('type'),
  }),
})

type ReportScheduleExecutionShape = {
  id: string
  status: (typeof REPORT_SCHEDULE_EXECUTION_STATUSES)[number]
  scheduledFor: Date
  attemptCount: number
  nextRetryAt: Date | null
  completedAt: Date | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: Date
}

const ReportScheduleExecutionRef =
  builder.objectRef<ReportScheduleExecutionShape>('ReportScheduleExecution')

ReportScheduleExecutionRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    status: t.field({
      type: ReportScheduleExecutionStatusRef,
      resolve: (e) => e.status,
    }),
    scheduledFor: t.string({ resolve: (e) => e.scheduledFor.toISOString() }),
    attemptCount: t.exposeInt('attemptCount'),
    nextRetryAt: t.string({
      nullable: true,
      resolve: (e) => (e.nextRetryAt ? e.nextRetryAt.toISOString() : null),
    }),
    completedAt: t.string({
      nullable: true,
      resolve: (e) => (e.completedAt ? e.completedAt.toISOString() : null),
    }),
    // Sanitized reason only — never SMTP internals or provider message IDs.
    errorCode: t.string({ nullable: true, resolve: (e) => e.errorCode }),
    errorMessage: t.string({ nullable: true, resolve: (e) => e.errorMessage }),
    createdAt: t.string({ resolve: (e) => e.createdAt.toISOString() }),
  }),
})

type ReportScheduleShape = Omit<
  ReportScheduleRecord,
  'report' | 'tenant' | 'executions' | 'createdAt' | 'updatedAt' | 'nextRunAt' | 'lastRunAt'
> & {
  report: ReportScheduleReportShape
  nextRunAt: Date
  lastRunAt: Date | null
  createdAt: Date
  updatedAt: Date
  lastExecution: ReportScheduleExecutionShape | null
}

const ReportScheduleRef = builder.objectRef<ReportScheduleShape>('ReportSchedule')

ReportScheduleRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    reportId: t.exposeID('reportId'),
    report: t.field({ type: ReportScheduleReportRef, resolve: (s) => s.report }),
    frequency: t.field({ type: ReportScheduleFrequencyRef, resolve: (s) => s.frequency }),
    recipients: t.stringList({ resolve: (s) => s.recipients }),
    format: t.field({ type: ReportDeliveryFormatRef, resolve: (s) => s.format }),
    timezone: t.exposeString('timezone'),
    scheduledTime: t.exposeString('scheduledTime'),
    dayOfWeek: t.int({ nullable: true, resolve: (s) => s.dayOfWeek }),
    dayOfMonth: t.int({ nullable: true, resolve: (s) => s.dayOfMonth }),
    startMonth: t.int({ nullable: true, resolve: (s) => s.startMonth }),
    cronExpression: t.string({ nullable: true, resolve: (s) => s.cronExpression }),
    nextRunAt: t.string({ resolve: (s) => s.nextRunAt.toISOString() }),
    lastRunAt: t.string({
      nullable: true,
      resolve: (s) => (s.lastRunAt ? s.lastRunAt.toISOString() : null),
    }),
    isActive: t.exposeBoolean('isActive'),
    lastExecution: t.field({
      type: ReportScheduleExecutionRef,
      nullable: true,
      resolve: (s) => s.lastExecution,
    }),
    createdAt: t.string({ resolve: (s) => s.createdAt.toISOString() }),
    updatedAt: t.string({ resolve: (s) => s.updatedAt.toISOString() }),
  }),
})

type ReportScheduleConnectionShape = {
  items: ReportScheduleShape[]
  total: number
  page: number
  pageSize: number
}

const ReportScheduleConnectionRef = builder.objectRef<ReportScheduleConnectionShape>(
  'ReportScheduleConnection',
)

ReportScheduleConnectionRef.implement({
  fields: (t) => ({
    items: t.field({ type: [ReportScheduleRef], resolve: (c) => c.items }),
    total: t.exposeInt('total'),
    page: t.exposeInt('page'),
    pageSize: t.exposeInt('pageSize'),
  }),
})

// ─── Input Types ─────────────────────────────────────────────

const ScheduleReportInputRef = builder.inputType('ScheduleReportInput', {
  fields: (t) => ({
    reportId: t.id({ required: true }),
    frequency: t.field({ type: ReportScheduleFrequencyRef, required: true }),
    recipients: t.stringList({ required: true }),
    format: t.field({ type: ReportDeliveryFormatRef, required: true }),
    timezone: t.string({ required: true }),
    scheduledTime: t.string({ required: true }),
    dayOfWeek: t.int(),
    dayOfMonth: t.int(),
    startMonth: t.int(),
    cronExpression: t.string(),
  }),
})

const UpdateReportScheduleInputRef = builder.inputType('UpdateReportScheduleInput', {
  fields: (t) => ({
    frequency: t.field({ type: ReportScheduleFrequencyRef }),
    recipients: t.stringList(),
    format: t.field({ type: ReportDeliveryFormatRef }),
    timezone: t.string(),
    scheduledTime: t.string(),
    dayOfWeek: t.int(),
    dayOfMonth: t.int(),
    startMonth: t.int(),
    cronExpression: t.string(),
  }),
})

const ReportSchedulesPaginationInputRef = builder.inputType('ReportSchedulesPaginationInput', {
  fields: (t) => ({
    page: t.int(),
    pageSize: t.int(),
  }),
})

// ─── Service Singleton ───────────────────────────────────────

let reportSchedulesService: ReportSchedulesService | undefined

export function registerReportSchedulesGraphql(service: ReportSchedulesService): void {
  reportSchedulesService = service
}

function getReportSchedulesService(): ReportSchedulesService {
  if (!reportSchedulesService) {
    throw new Error('ReportSchedulesService is not initialized')
  }
  return reportSchedulesService
}

function requireUser(context: GraphqlContext): JwtPayload {
  if (!context.user) {
    throw new UnauthorizedException('Authentication required')
  }
  return context.user
}

function toShape(record: ReportScheduleRecord): ReportScheduleShape {
  const execution = record.executions[0]
  return {
    ...record,
    report: {
      id: record.report?.id ?? record.reportId,
      name: record.report?.name ?? 'Report',
      type: record.report?.type ?? 'UNKNOWN',
    },
    nextRunAt: record.nextRunAt,
    lastRunAt: record.lastRunAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastExecution: execution
      ? {
          id: execution.id,
          status: execution.status,
          scheduledFor: execution.scheduledFor,
          attemptCount: execution.attemptCount,
          nextRetryAt: execution.nextRetryAt,
          completedAt: execution.completedAt,
          errorCode: execution.errorCode,
          errorMessage: execution.errorMessage,
          createdAt: execution.createdAt,
        }
      : null,
  }
}

// ─── Queries ─────────────────────────────────────────────────

builder.queryFields((t) => ({
  reportSchedules: t.field({
    type: ReportScheduleConnectionRef,
    args: {
      pagination: t.arg({ type: ReportSchedulesPaginationInputRef }),
      includeInactive: t.arg.boolean(),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'READ')
      const result = await getReportSchedulesService().list(user.tenantId, user.userId, {
        page: args.pagination?.page ?? undefined,
        pageSize: args.pagination?.pageSize ?? undefined,
        includeInactive: args.includeInactive ?? false,
      })
      return {
        items: result.items.map(toShape),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      }
    },
  }),
}))

// ─── Mutations ───────────────────────────────────────────────

builder.mutationFields((t) => ({
  scheduleReport: t.field({
    type: ReportScheduleRef,
    args: { input: t.arg({ type: ScheduleReportInputRef, required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'CREATE')
      const isAdmin = user.roles.includes('ADMIN')
      const record = await getReportSchedulesService().create(
        user.tenantId,
        user.userId,
        args.input as Record<string, unknown>,
        { isAdmin },
      )
      return toShape(record)
    },
  }),
  updateSchedule: t.field({
    type: ReportScheduleRef,
    args: {
      id: t.arg.id({ required: true }),
      input: t.arg({ type: UpdateReportScheduleInputRef, required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'UPDATE')
      const record = await getReportSchedulesService().update(
        user.tenantId,
        user.userId,
        args.id as string,
        args.input as Record<string, unknown>,
      )
      return toShape(record)
    },
  }),
  deleteSchedule: t.field({
    type: 'Boolean',
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'DELETE')
      return getReportSchedulesService().delete(user.tenantId, user.userId, args.id as string)
    },
  }),
  pauseSchedule: t.field({
    type: ReportScheduleRef,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'UPDATE')
      const record = await getReportSchedulesService().pause(
        user.tenantId,
        user.userId,
        args.id as string,
      )
      return toShape(record)
    },
  }),
  resumeSchedule: t.field({
    type: ReportScheduleRef,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'UPDATE')
      const record = await getReportSchedulesService().resume(
        user.tenantId,
        user.userId,
        args.id as string,
      )
      return toShape(record)
    },
  }),
}))
