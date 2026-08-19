/**
 * Story 6.6 (Contract B7-B12, D28-D29): owner-scoped report export service.
 *
 * `exportReport` authorizes (JWT + REPORT:READ + current source read
 * permission), loads the visible active report, persists the normalized
 * filter snapshot, creates the durable ReportExport row, and runs bounded
 * results inline (sales always; CUSTOM only when totalRows <= 100). Larger
 * CUSTOM results stay PENDING for the minute worker.
 *
 * Ownership invariants: every history/detail/download/delete query filters by
 * BOTH tenantId and userId — ADMIN never bypasses export-row ownership.
 * `objectPath` and signed URLs never cross the service boundary.
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { PermissionsService } from '../permissions/permissions.service'
import { SupabaseStorageService } from '../storage/supabase-storage.service'
import { catalogFor } from './custom-report-catalog'
import { isPlatformReportType } from './report-types'
import { ReportExportPayloadService, normalizeSalesSnapshot } from './report-export-payload.service'
import type { ExportExecutionResult } from './report-export-payload.service'
import { ReportExportProcessor } from './report-export-processor.service'
import {
  CUSTOM_INLINE_MAX_ROWS,
  SIGNED_URL_TTL_SECONDS,
  type ReportExportStatus,
} from './report-export-types'
import { salesFilterSummary } from './report-document-payload'
import type { ReportFiltersInput, ReportRow } from './sales-reports.service'
import type { ReportConfig } from './report-config'
import type { ReportDeliveryFormat } from './report-schedule-types'
import { SYSTEM_CLOCK, type Clock } from './report-schedule-types'

export const REPORT_EXPORT_SELECT = {
  id: true,
  tenantId: true,
  reportId: true,
  userId: true,
  format: true,
  status: true,
  filters: true,
  filterSummary: true,
  dateRangeStart: true,
  dateRangeEnd: true,
  filename: true,
  contentType: true,
  objectPath: true,
  fileSizeBytes: true,
  expectedTotalRows: true,
  attemptCount: true,
  nextRetryAt: true,
  processingStartedAt: true,
  completedAt: true,
  errorCode: true,
  errorMessage: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
} as const

export type ReportExportRecord = Prisma.ReportExportGetPayload<{
  select: typeof REPORT_EXPORT_SELECT
}>

export type ReportExportConnection = {
  items: ReportExportView[]
  total: number
  page: number
  pageSize: number
}

export type ReportExportDownload = {
  url: string
  expiresAt: string
}

const EXPORT_NOT_FOUND = 'Export not found'

/**
 * A serializable safe view of an export row — the Pothos ref type derives
 * from this shape so no storage path/credentials can ever leak into GraphQL.
 */
export type ReportExportView = {
  id: string
  status: ReportExportStatus
  format: ReportDeliveryFormat
  filterSummary: string
  dateRangeStart: string | null
  dateRangeEnd: string | null
  filename: string | null
  contentType: string | null
  fileSizeBytes: number | null
  attemptCount: number
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
  report: { id: string; name: string; type: string } | null
}

export function toReportExportView(
  row: ReportExportRecord,
  report?: { id: string; name: string; type: string } | null,
): ReportExportView {
  return {
    id: row.id,
    status: row.status,
    format: row.format,
    filterSummary: row.filterSummary,
    dateRangeStart: row.dateRangeStart ? row.dateRangeStart.toISOString().slice(0, 10) : null,
    dateRangeEnd: row.dateRangeEnd ? row.dateRangeEnd.toISOString().slice(0, 10) : null,
    filename: row.filename,
    contentType: row.contentType,
    fileSizeBytes: row.fileSizeBytes,
    attemptCount: row.attemptCount,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    report: report ?? null,
  }
}

@Injectable()
export class ReportExportsService {
  private readonly logger = new Logger(ReportExportsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly payloadService: ReportExportPayloadService,
    private readonly processor: ReportExportProcessor,
    private readonly storageService: SupabaseStorageService,
    private readonly permissionsService: PermissionsService,
    private readonly audit: AuditService,
    @Optional() private readonly clock: Clock = SYSTEM_CLOCK,
  ) {}

  // ─── Request ──────────────────────────────────────────────────────────────

  /**
   * Contract B9/B12: authorize, persist the snapshot row, reserve a
   * PROCESSING lease, probe page 1 under that lease, then either run bounded
   * results inline under the SAME lease (`processClaimed`) or release the
   * row to PENDING for the worker with the authoritative total persisted
   * (`releaseForBackground`). Inline/probe failure leaves a truthful
   * terminal/queued row — never a fake READY and never an orphan PENDING.
   */
  async exportReport(
    tenantId: string,
    userId: string,
    reportId: string,
    format: ReportDeliveryFormat,
    filters?: ReportFiltersInput | null,
  ): Promise<ReportExportRecord> {
    const report = await this.loadVisibleReport(tenantId, userId, reportId)
    await this.requireSourceRead(tenantId, userId, report)

    if (report.type === 'CUSTOM' && filters && Object.keys(filters).length > 0) {
      throw new BadRequestException(
        'Custom report exports use the saved configuration; sales filters are not accepted',
      )
    }

    const now = this.clock.now()
    // Immutable replay input: for sales the FULL server-normalized effective
    // config (saved config merged with validated overrides) — never raw
    // GraphQL objects; for CUSTOM the saved config owns filters → null.
    const snapshot = report.type === 'CUSTOM' ? null : normalizeSalesSnapshot(report, filters)
    const filterSummary = snapshot ? salesFilterSummary(snapshot) : 'Saved configuration'

    const row = await this.prisma.reportExport.create({
      data: {
        tenantId,
        reportId: report.id,
        userId,
        format,
        status: 'PENDING',
        filters: (snapshot as unknown as Prisma.InputJsonValue | undefined) ?? undefined,
        filterSummary,
        createdBy: userId,
        updatedBy: userId,
      },
      select: REPORT_EXPORT_SELECT,
    })

    // Exactly one service-level audit row for an accepted request — carries
    // reportId/format/filter keys only, never result data or a signed URL.
    await this.audit.log({
      tenantId,
      userId,
      action: 'CREATE',
      entity: 'REPORT_EXPORT',
      entityId: row.id,
      details: {
        reportId: report.id,
        format,
        filterKeys: snapshot ? Object.keys(snapshot) : [],
      },
    })

    // R2/R4: reserve BEFORE the probe — the request owns the PROCESSING
    // lease, so the minute scan's claim predicate (PENDING | due retry |
    // stale lease) can never match the row during the page-1 probe window.
    const lease = await this.processor.reserve(row, now)
    if (!lease) {
      // A concurrent worker scan claimed the row in the create→reserve
      // window — return the truthful worker-owned row; never probe it.
      const owned = await this.findOwned(row.tenantId, row.userId, row.id)
      if (!owned) throw new NotFoundException(EXPORT_NOT_FOUND)
      return owned
    }

    // Inline decision uses authoritative result metadata (Contract B12).
    // If the page-1 probe fails AFTER the row was created, the row must
    // reflect a truthful terminal FAILED (or a classified retry queue state)
    // — never an orphan PENDING that a later worker scan turns into a
    // surprise background FAILED notification (M4). R4: the failure is
    // finalized synchronously under OUR held lease, so there is no
    // mutation-error + delayed worker ownership edge.
    let first: ExportExecutionResult
    try {
      first = await this.payloadService.executePage1(tenantId, userId, report, snapshot)
    } catch (error) {
      await this.processor.failInlineProbe(row, error, now, lease)
      throw error
    }

    const canRunInline = report.type !== 'CUSTOM' || first.totalRows <= CUSTOM_INLINE_MAX_ROWS
    if (!canRunInline) {
      // R2/R4: atomically persist the authoritative request-time total
      // (CUSTOM; sales stay null) AND release the row to PENDING under the
      // lease — the worker claims it only AFTER expectedTotalRows is durable
      // (M1 / Contract C14). A losing release means the lease was taken over
      // or the row deleted: the new owner decides, and the mutation returns
      // the truthful row.
      await this.processor.releaseForBackground(
        row,
        lease,
        report.type === 'CUSTOM' ? first.totalRows : null,
      )
      const updated = await this.findOwned(row.tenantId, row.userId, row.id)
      if (!updated) throw new NotFoundException(EXPORT_NOT_FOUND)
      this.logger.log(`Export ${row.id} queued for background processing (${first.totalRows} rows)`)
      return updated
    }

    // CUSTOM ≤100: keep the request-time expectation under the lease so the
    // inline execution still fails DATA_CHANGED on request→execution drift.
    if (report.type === 'CUSTOM') {
      const persisted = await this.processor.persistExpectedTotalRows(row, lease, first.totalRows)
      if (!persisted) {
        // The persist lost the lease or the row was deleted — never execute
        // inline under stale ownership. Return the truthful current row; the
        // new owner (worker takeover / deletion) decides the row's fate.
        const owned = await this.findOwned(row.tenantId, row.userId, row.id)
        if (!owned) throw new NotFoundException(EXPORT_NOT_FOUND)
        return owned
      }
    }

    // Continue inline UNDER THE SAME lease — no re-claim (R2). The worker
    // cannot own the row while we hold the fresh reservation lease; a losing
    // processClaimed finalize (takeover/delete) is still a strict no-op. For
    // CUSTOM, pass the UPDATED immutable row so the DATA_CHANGED guard sees
    // the persisted request-time expectation — the `row` returned by create
    // still carries `expectedTotalRows: null` and would silently disable it.
    const claimedRow: ReportExportRecord =
      report.type === 'CUSTOM' ? { ...row, expectedTotalRows: first.totalRows } : row
    await this.processor.processClaimed(claimedRow, lease, now, report)
    const updated = await this.findOwned(row.tenantId, row.userId, row.id)
    if (!updated) {
      throw new NotFoundException(EXPORT_NOT_FOUND)
    }
    return updated
  }

  // ─── History / detail / download / delete ─────────────────────────────────

  async list(
    tenantId: string,
    userId: string,
    pagination: { page?: number; pageSize?: number } = {},
  ): Promise<ReportExportConnection> {
    const page = Math.max(pagination.page ?? 1, 1)
    const pageSize = Math.min(Math.max(pagination.pageSize ?? 10, 1), 100)
    const where: Prisma.ReportExportWhereInput = { tenantId, userId, deletedAt: null }
    const [items, total] = await Promise.all([
      this.prisma.reportExport.findMany({
        where,
        select: REPORT_EXPORT_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.reportExport.count({ where }),
    ])
    return { items: await this.enrichWithReportSummaries(tenantId, items), total, page, pageSize }
  }

  /**
   * M3: batch-enrich export rows with their report summaries in ONE query
   * (id in [...]) — never one `report.findFirst` per row. Tenant-scoped and
   * deleted-filtered like the previous per-row lookup, so owner pagination
   * and secrecy semantics are unchanged.
   */
  private async enrichWithReportSummaries(
    tenantId: string,
    items: ReportExportRecord[],
  ): Promise<ReportExportView[]> {
    const reportIds = [...new Set(items.map((item) => item.reportId))]
    const found =
      reportIds.length > 0
        ? await this.prisma.report.findMany({
            where: { id: { in: reportIds }, tenantId, deletedAt: null },
            select: { id: true, name: true, type: true },
          })
        : []
    const reports = found ?? []
    const byId = new Map(reports.map((r) => [r.id, r]))
    return items.map((row) => toReportExportView(row, byId.get(row.reportId) ?? null))
  }

  async detail(tenantId: string, userId: string, id: string): Promise<ReportExportView> {
    const row = await this.findOwned(tenantId, userId, id)
    if (!row) {
      throw new NotFoundException(EXPORT_NOT_FOUND)
    }
    return toReportExportView(row, await this.reportSummary(row.reportId, row.tenantId))
  }

  /**
   * Contract D28 + M2: owner-only READY rows mint a FRESH 86,400-second
   * signed URL each call; non-READY/foreign/missing rows all return Export
   * not found. Before minting, the CURRENT report visibility and the owner's
   * source read permission are re-verified under the owner identity — a
   * report flipped private, deleted, or a revoked DEAL/source permission
   * yields the same indistinguishable Export not found and Storage is never
   * called.
   */
  async downloadUrl(tenantId: string, userId: string, id: string): Promise<ReportExportDownload> {
    const row = await this.prisma.reportExport.findFirst({
      where: { id, tenantId, userId, status: 'READY', deletedAt: null },
      select: REPORT_EXPORT_SELECT,
    })
    if (!row || !row.objectPath) {
      throw new NotFoundException(EXPORT_NOT_FOUND)
    }
    // Re-verify the related report is still active/visible AND the owner
    // still holds the source read permission (Contract D28/M2) — mirrors the
    // request/worker gate. Revocation, private/deleted/missing reports and
    // missing owners all land here before any Storage call.
    const access = await this.validateBackgroundAccess(tenantId, userId, row.reportId)
    if (!access.ok) {
      throw new NotFoundException(EXPORT_NOT_FOUND)
    }
    const bucket = this.storageService.reportExportBucket()
    const url = await this.storageService.createSignedUrlFromBucket(
      bucket,
      row.objectPath,
      SIGNED_URL_TTL_SECONDS,
    )
    return {
      url,
      expiresAt: new Date(this.clock.now().getTime() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
    }
  }

  /** Contract D29: owner-only soft delete + best-effort object removal. */
  async remove(tenantId: string, userId: string, id: string): Promise<boolean> {
    const row = await this.findOwned(tenantId, userId, id)
    if (!row) {
      // Identical result whether or not another tenant's ID exists.
      return false
    }
    const result = await this.prisma.reportExport.updateMany({
      where: { id: row.id, tenantId, userId, deletedAt: null },
      data: { deletedAt: this.clock.now(), updatedBy: userId },
    })
    if ((result?.count ?? 0) === 0) {
      return false
    }
    if (row.objectPath) {
      try {
        await this.storageService.removeFromBucket(
          this.storageService.reportExportBucket(),
          row.objectPath,
        )
      } catch (error) {
        this.logger.warn(
          `Best-effort export object removal failed for ${row.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }
    await this.audit.log({
      tenantId,
      userId,
      action: 'DELETE',
      entity: 'REPORT_EXPORT',
      entityId: row.id,
      details: { reportId: row.reportId, format: row.format },
    })
    return true
  }

  // ─── Access helpers ───────────────────────────────────────────────────────

  /**
   * Contract B9: report load gate — private non-owner, cross-tenant, deleted
   * and missing reports are indistinguishable (`Export not found`).
   */
  async loadVisibleReport(tenantId: string, userId: string, reportId: string): Promise<ReportRow> {
    const row = await this.prisma.report.findFirst({
      where: {
        id: reportId,
        tenantId,
        deletedAt: null,
        OR: [{ createdBy: userId }, { isPublic: true }],
      },
      select: {
        id: true,
        tenantId: true,
        name: true,
        type: true,
        config: true,
        createdBy: true,
        isPublic: true,
        createdAt: true,
        updatedAt: true,
        updatedBy: true,
        deletedAt: true,
      },
    })
    if (!row) {
      throw new NotFoundException(EXPORT_NOT_FOUND)
    }
    return row as unknown as ReportRow
  }

  /**
   * Contract B9: REPORT:READ + current source read permission
   * (DEAL:READ for sales; the catalog readGate for CUSTOM). The gate is
   * read-derived — REPORT:CREATE is never required.
   */
  async requireSourceRead(tenantId: string, userId: string, report: ReportRow): Promise<void> {
    const ok = await this.permissionsService.hasPermission(userId, 'REPORT', 'READ')
    if (!ok) {
      throw new NotFoundException(EXPORT_NOT_FOUND)
    }
    if (report.type === 'CUSTOM') {
      const source = await this.payloadService.resolveCustomSource(tenantId, userId, report.id)
      const gate = catalogFor(source).readGate
      const sourceOk = await this.permissionsService.hasPermission(userId, gate, 'READ')
      if (!sourceOk) {
        throw new NotFoundException(EXPORT_NOT_FOUND)
      }
      return
    }
    const dealOk = await this.permissionsService.hasPermission(userId, 'DEAL', 'READ')
    if (!dealOk) {
      throw new NotFoundException(EXPORT_NOT_FOUND)
    }
  }

  /** Background re-check under the requester's CURRENT identity (D24). */
  async validateBackgroundAccess(
    tenantId: string,
    ownerId: string,
    reportId: string,
  ): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
    const owner = await this.prisma.user.findFirst({
      where: { id: ownerId, tenantId, isActive: true, deletedAt: null },
      select: { id: true },
    })
    if (!owner) {
      return { ok: false, code: 'ACCESS_REVOKED', message: 'Export owner is no longer active' }
    }
    let report: ReportRow
    try {
      report = await this.loadVisibleReport(tenantId, ownerId, reportId)
    } catch {
      return { ok: false, code: 'REPORT_UNAVAILABLE', message: 'Report is no longer available' }
    }
    if (!isPlatformReportType(report.type)) {
      return {
        ok: false,
        code: 'UNSUPPORTED_REPORT',
        message: 'Report type is no longer supported',
      }
    }
    // Background path has no GraphQL context — resolve ADMIN bypass from the
    // persisted role rows, mirroring the schedule processor precedent.
    const roles = await this.prisma.userRole.findMany({
      where: { userId: ownerId, role: { tenantId } },
      select: { role: { select: { name: true } } },
    })
    if (roles.some((r) => r.role.name === 'ADMIN')) {
      return { ok: true }
    }
    try {
      await this.requireSourceRead(tenantId, ownerId, report)
      return { ok: true }
    } catch {
      return { ok: false, code: 'ACCESS_REVOKED', message: 'Required read permission revoked' }
    }
  }

  async findOwned(
    tenantId: string,
    userId: string,
    id: string,
  ): Promise<ReportExportRecord | null> {
    return this.prisma.reportExport.findFirst({
      where: { id, tenantId, userId, deletedAt: null },
      select: REPORT_EXPORT_SELECT,
    })
  }

  async reportSummary(
    reportId: string,
    tenantId: string,
  ): Promise<{ id: string; name: string; type: string } | null> {
    const report = await this.prisma.report.findFirst({
      where: { id: reportId, tenantId, deletedAt: null },
      select: { id: true, name: true, type: true },
    })
    return report ?? null
  }

  async loadSnapshot(row: ReportExportRecord): Promise<ReportConfig | null> {
    if (!row.filters) return null
    return row.filters as unknown as ReportConfig
  }
}

export type { ReportDeliveryFormat }
