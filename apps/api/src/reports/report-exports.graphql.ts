import { UnauthorizedException } from '@nestjs/common'

/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types */

import { builder } from '../graphql/schema.builder'
import { requirePermission } from '../common/guards/permission-check'
import { ReportFiltersInputRef } from './reports.graphql'
import { ReportDeliveryFormatRef } from './report-schedules.graphql'
import { ActivityReportFilterInputRef } from './activity-reports.graphql'
import type { GraphqlContext } from '../graphql/graphql-context'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'
import {
  toReportExportView,
  type ReportExportsService,
  type ReportExportView,
} from './report-exports.service'
import type { ReportFiltersInput } from './sales-reports.service'
import type { ActivityReportFilterInput } from './activity-reports.service'
import { REPORT_EXPORT_STATUSES } from './report-export-types'

// ─── Enums (derive from the closed const tuples — never a second vocabulary)

const ReportExportStatusRef = builder.enumType('ReportExportStatus', {
  values: REPORT_EXPORT_STATUSES,
})

// Story 6.8 (Contract A6/E30): source discriminator.
const ReportExportSourceTypeRef = builder.enumType('ReportExportSourceType', {
  values: ['SAVED_REPORT', 'ACTIVITY_REPORT'],
})

// ─── Types ──────────────────────────────────────────────────────────────────

const ReportExportReportSummaryRef = builder.objectRef<{
  id: string
  name: string
  type: string
}>('ReportExportReport')

ReportExportReportSummaryRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    type: t.exposeString('type'),
  }),
})

const ReportExportRef = builder.objectRef<ReportExportView>('ReportExport')

ReportExportRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    sourceType: t.field({
      type: ReportExportSourceTypeRef,
      nullable: false,
      resolve: (e) => e.sourceType,
    }),
    status: t.field({ type: ReportExportStatusRef, resolve: (e) => e.status }),
    format: t.field({ type: ReportDeliveryFormatRef, resolve: (e) => e.format }),
    filterSummary: t.exposeString('filterSummary'),
    dateRangeStart: t.string({ nullable: true, resolve: (e) => e.dateRangeStart }),
    dateRangeEnd: t.string({ nullable: true, resolve: (e) => e.dateRangeEnd }),
    filename: t.string({ nullable: true, resolve: (e) => e.filename }),
    contentType: t.string({ nullable: true, resolve: (e) => e.contentType }),
    fileSizeBytes: t.int({ nullable: true, resolve: (e) => e.fileSizeBytes }),
    attemptCount: t.exposeInt('attemptCount'),
    errorCode: t.string({ nullable: true, resolve: (e) => e.errorCode }),
    errorMessage: t.string({ nullable: true, resolve: (e) => e.errorMessage }),
    createdAt: t.exposeString('createdAt'),
    completedAt: t.string({ nullable: true, resolve: (e) => e.completedAt }),
    report: t.field({
      type: ReportExportReportSummaryRef,
      nullable: true,
      resolve: (e) => e.report,
    }),
  }),
})

const ReportExportConnectionRef = builder.objectRef<{
  items: ReportExportView[]
  total: number
  page: number
  pageSize: number
}>('ReportExportConnection')

ReportExportConnectionRef.implement({
  fields: (t) => ({
    items: t.field({ type: [ReportExportRef], resolve: (c) => c.items }),
    total: t.exposeInt('total'),
    page: t.exposeInt('page'),
    pageSize: t.exposeInt('pageSize'),
  }),
})

const ReportExportDownloadRef = builder.objectRef<{ url: string; expiresAt: string }>(
  'ReportExportDownload',
)

ReportExportDownloadRef.implement({
  fields: (t) => ({
    url: t.exposeString('url'),
    expiresAt: t.exposeString('expiresAt'),
  }),
})

// ─── Input types ────────────────────────────────────────────────────────────

const PaginationInputRef = builder.inputType('PaginationInput', {
  fields: (t) => ({
    page: t.int(),
    pageSize: t.int(),
  }),
})

// ─── Service singleton ──────────────────────────────────────────────────────

let reportExportsService: ReportExportsService | undefined

function getReportExportsService(): ReportExportsService {
  if (!reportExportsService) {
    throw new Error('ReportExportsService is not initialized')
  }
  return reportExportsService
}

function requireUser(context: GraphqlContext): JwtPayload {
  if (!context.user) {
    throw new UnauthorizedException('Authentication required')
  }
  return context.user
}

// ─── Queries ────────────────────────────────────────────────────────────────

builder.queryFields((t) => ({
  // Owner-only export history — newest first (Contract B7/D29).
  reportExports: t.field({
    type: ReportExportConnectionRef,
    nullable: false,
    args: {
      pagination: t.arg({ type: PaginationInputRef }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'READ')
      // M3: the service enriches rows with their report summaries in ONE
      // batched query — no per-row lookup (no N+1).
      return getReportExportsService().list(user.tenantId, user.userId, {
        page: args.pagination?.page ?? undefined,
        pageSize: args.pagination?.pageSize ?? undefined,
      })
    },
  }),
  // Owner-only detail (Contract B7/D29).
  reportExport: t.field({
    type: ReportExportRef,
    nullable: false,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'READ')
      return getReportExportsService().detail(user.tenantId, user.userId, args.id)
    },
  }),
}))

// ─── Mutations ──────────────────────────────────────────────────────────────

builder.mutationFields((t) => ({
  // Contract B7: exact epic argument names reportId/format/filters.
  exportReport: t.field({
    type: ReportExportRef,
    nullable: false,
    args: {
      reportId: t.arg.id({ required: true }),
      format: t.arg({ type: ReportDeliveryFormatRef, required: true }),
      filters: t.arg({ type: ReportFiltersInputRef }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      const row = await getReportExportsService().exportReport(
        user.tenantId,
        user.userId,
        args.reportId,
        args.format,
        (args.filters as ReportFiltersInput | null | undefined) ?? null,
      )
      return toReportExportView(
        row,
        row.reportId
          ? await getReportExportsService().reportSummary(row.reportId, row.tenantId)
          : null,
      )
    },
  }),
  // Contract D28: fresh 86,400-second signed URL for owner READY rows only.
  reportExportDownloadUrl: t.field({
    type: ReportExportDownloadRef,
    nullable: false,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'READ')
      return getReportExportsService().downloadUrl(user.tenantId, user.userId, args.id)
    },
  }),
  // Story 6.8 (Contract E30): activity report export through the SAME
  // durable Story 6.6 machinery. Gate = JWT + REPORT:READ + REPORT:EXPORT +
  // CONTACT:READ + TASK:READ + DEAL:READ; CSV is rejected in the service.
  exportActivityReport: t.field({
    type: ReportExportRef,
    nullable: false,
    args: {
      filters: t.arg({ type: ActivityReportFilterInputRef, required: true }),
      format: t.arg({ type: ReportDeliveryFormatRef, required: true }),
    },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'READ')
      await requirePermission(context, 'REPORT', 'EXPORT')
      await requirePermission(context, 'CONTACT', 'READ')
      await requirePermission(context, 'TASK', 'READ')
      await requirePermission(context, 'DEAL', 'READ')
      const row = await getReportExportsService().exportActivityReport(
        user.tenantId,
        user.userId,
        args.filters as ActivityReportFilterInput,
        args.format,
      )
      // ACTIVITY_REPORT rows carry reportId null — the summary lookup
      // returns null and the frontend renders the `Activity report` label.
      return toReportExportView(
        row,
        row.reportId
          ? await getReportExportsService().reportSummary(row.reportId, row.tenantId)
          : null,
      )
    },
  }),
  // Contract D29: owner-only soft delete + best-effort object removal. Same
  // REPORT:READ gate as list/detail/download — a user without REPORT:READ is
  // denied before any existence probe (indistinguishable denial).
  deleteReportExport: t.field({
    type: 'Boolean',
    nullable: false,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_parent, args, context) => {
      const user = requireUser(context)
      await requirePermission(context, 'REPORT', 'READ')
      return getReportExportsService().remove(user.tenantId, user.userId, args.id)
    },
  }),
}))

// ─── Registration ───────────────────────────────────────────────────────────

export function registerReportExportsGraphql(service: ReportExportsService): void {
  reportExportsService = service
}
