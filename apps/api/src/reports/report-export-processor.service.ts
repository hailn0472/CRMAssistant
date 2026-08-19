/**
 * Story 6.6 (Contract D23-D27): durable report-export processor.
 *
 * Nest cron only WAKES the worker — PostgreSQL rows are the durable source
 * of truth (no in-memory queue). The minute scan finds PENDING/retryable
 * rows, then `processExport` claims the row atomically (updateMany →
 * PROCESSING + lease timestamp; a losing instance claims 0 rows and becomes
 * a strict no-op). The inline request path (`exportReport`) reserves the row
 * with the SAME atomic claim BEFORE its page-1 probe and continues under
 * that same lease via `processClaimed` — there is exactly one claim path for
 * inline, scan and stale recovery, so a PENDING row can never be processed
 * twice and a request never probes an unowned row.
 *
 * Lease reservation state machine (R1/R2/R4):
 * - Every successful claim clears `nextRetryAt` (R1): a due-retry row
 *   claimed once is PROCESSING + `nextRetryAt = null`, so an overlapping
 *   scan's retry predicate can never match it again — no double-claim.
 * - `reserve` gives the request a PROCESSING lease before the page-1 probe;
 *   the scan cannot claim the row during the probe (not PENDING, not a due
 *   retry, not stale). Probe failure finalizes synchronously under the held
 *   lease (`failInlineProbe` with the lease) — no orphan PENDING, no
 *   mutation-error + delayed worker FAILED edge.
 * - ≤100-row inline results complete under the same lease (`processClaimed`)
 *   without re-claiming; >100-row CUSTOM results atomically persist
 *   `expectedTotalRows` AND release to PENDING under the lease
 *   (`releaseForBackground`), so the worker claims only after the
 *   authoritative total is durable; sales never carry an expectation.
 *
 * Optimistic lease ownership (Contract D25/D26): every finalizer
 * (markReady / markFailed / retry updates / release / persist) runs
 * `updateMany` guarded by `status: 'PROCESSING'` AND `processingStartedAt`
 * EQUALS the lease the current owner wrote when it claimed. A stale-claim
 * takeover (>15 min lease expiry) writes a NEW processingStartedAt, so the
 * old owner's finalizers match 0 rows: the losing finalizer is a no-op and
 * must never notify or overwrite terminal metadata. `deletedAt: null` +
 * tenantId/userId in every guard mean deletion always wins: a late
 * upload/finalize after soft-delete is a no-op (with best-effort
 * orphan-object cleanup) and can never flip a deleted row READY or send a
 * notification.
 *
 * At-least-once generation: the object path is deterministic
 * (`reports/<tenantId>/<userId>/<exportId>/<filename>`); a retry after a
 * failed DB-READY update removes any orphan object before re-uploading, and
 * READY/FAILED rows are never re-processed (no second history row).
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { Cron } from '@nestjs/schedule'

import { PrismaService } from '../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import { PermissionsService } from '../permissions/permissions.service'
import { SupabaseStorageService } from '../storage/supabase-storage.service'
import { ReportExportPayloadService } from './report-export-payload.service'
import { ReportAttachmentService, ExportLimitError } from './report-attachment.service'
import { chartPngForPayload } from './report-export-chart'
import { catalogFor } from './custom-report-catalog'
import {
  EXPORT_BATCH_SIZE,
  EXPORT_CONCURRENCY,
  EXPORT_FAILED_NOTIFICATION_DEDUPE_PREFIX,
  EXPORT_MAX_ATTEMPTS,
  EXPORT_READY_NOTIFICATION_DEDUPE_PREFIX,
  EXPORT_STALE_CLAIM_LEASE_MS,
  REPORT_EXPORT_TERMINAL_STATUSES,
  exportRetryDelayMsForAttempt,
  sanitizeExportError,
  type ReportExportStatus,
} from './report-export-types'
import { REPORT_EXPORT_SELECT, type ReportExportRecord } from './report-exports.service'
import type { ReportRow } from './sales-reports.service'
import type { ReportConfig } from './report-config'
import type { CustomReportDataSource } from './custom-report-types'
import { SYSTEM_CLOCK, type Clock } from './report-schedule-types'

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let index = 0
  const runners = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      for (;;) {
        const current = index++
        if (current >= items.length) return
        results[current] = await worker(items[current]!)
      }
    },
  )
  await Promise.all(runners)
  return results
}

@Injectable()
export class ReportExportProcessor {
  private readonly logger = new Logger(ReportExportProcessor.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly payloadService: ReportExportPayloadService,
    private readonly attachmentService: ReportAttachmentService,
    private readonly storageService: SupabaseStorageService,
    private readonly notificationsService: NotificationsService,
    private readonly permissionsService: PermissionsService,
    // Injectable clock/bounds for deterministic tests; defaults to system.
    @Optional() private readonly clock: Clock = SYSTEM_CLOCK,
    @Optional() private readonly batchSize: number = EXPORT_BATCH_SIZE,
    @Optional() private readonly concurrency: number = EXPORT_CONCURRENCY,
  ) {}

  /** Minute scan: due PENDING/retryable rows — claim happens inside processExport. */
  @Cron('0 * * * * *')
  async scanDueExports(): Promise<void> {
    const now = this.clock.now()
    const rows = await this.prisma.reportExport.findMany({
      where: {
        deletedAt: null,
        OR: [{ status: 'PENDING' }, { status: 'PROCESSING', nextRetryAt: { lte: now } }],
      },
      select: REPORT_EXPORT_SELECT,
      orderBy: { createdAt: 'asc' },
      take: this.batchSize,
    })
    if (rows.length === 0) return
    this.logger.log(`Report export scan: ${rows.length} due row(s)`)
    await mapWithConcurrency(rows, this.concurrency, async (row) => {
      try {
        await this.processExport(row, undefined, now)
      } catch (error) {
        this.logger.error(
          `Unhandled processor error for export ${row.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    })
  }

  /** Minute scan: stale PROCESSING claims older than the lease are recovered. */
  @Cron('0 * * * * *')
  async recoverStaleClaims(): Promise<void> {
    const now = this.clock.now()
    const staleThreshold = new Date(now.getTime() - EXPORT_STALE_CLAIM_LEASE_MS)
    const rows = await this.prisma.reportExport.findMany({
      where: {
        deletedAt: null,
        status: 'PROCESSING',
        processingStartedAt: { lte: staleThreshold },
      },
      select: REPORT_EXPORT_SELECT,
      orderBy: { createdAt: 'asc' },
      take: this.batchSize,
    })
    if (rows.length === 0) return
    await mapWithConcurrency(rows, this.concurrency, async (row) => {
      try {
        await this.processExport(row, undefined, now, staleThreshold)
      } catch (error) {
        this.logger.error(
          `Unhandled stale-recovery error for export ${row.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    })
  }

  /**
   * THE single claim path — request reservations, minute scans and stale
   * recovery all pass through here. Atomically transitions PENDING (or a due
   * retry / expired-lease PROCESSING row) to PROCESSING with a fresh lease
   * (`processingStartedAt = now`). A losing claimant claims 0 rows and
   * returns false — it generates nothing, finalizes nothing and notifies
   * nothing. Returns the lease timestamp when this instance performed the
   * work, else null.
   *
   * R1: every successful claim ALSO clears `nextRetryAt`. A due-retry row
   * claimed once is PROCESSING with `nextRetryAt = null`, so an overlapping
   * scan's retry predicate (`status: 'PROCESSING'` AND `nextRetryAt <= now`)
   * can never match it again — the retry row cannot be double-claimed.
   */
  private async claimRow(id: string, now: Date, staleThreshold: Date | null): Promise<Date | null> {
    const result = await this.prisma.reportExport.updateMany({
      where: {
        id,
        deletedAt: null,
        ...(staleThreshold
          ? { status: 'PROCESSING', processingStartedAt: { lte: staleThreshold } }
          : {
              OR: [{ status: 'PENDING' }, { status: 'PROCESSING', nextRetryAt: { lte: now } }],
            }),
      },
      data: {
        status: 'PROCESSING',
        processingStartedAt: now,
        nextRetryAt: null,
        updatedBy: 'system',
      },
    })
    return result?.count === 1 ? now : null
  }

  /**
   * R2/R4: request-time reservation lease. Atomically claims the just-created
   * row so the request owns a PROCESSING lease BEFORE the page-1 probe: the
   * minute scan's claim predicate (PENDING | PROCESSING+due retry | stale
   * lease) cannot match a freshly-reserved row, so the scan can never claim
   * it mid-probe and a probe failure finalizes synchronously under the held
   * lease (never an orphan PENDING + later worker FAILED edge). Returns the
   * lease timestamp, or null when the row was already claimed elsewhere.
   */
  async reserve(row: ReportExportRecord, now: Date = this.clock.now()): Promise<Date | null> {
    return this.claimRow(row.id, now, null)
  }

  /**
   * Contract D24-D27: claim atomically, re-check access, execute the full
   * result from the immutable snapshot, render, upload, READY + notification.
   * Every terminal/retry write is lease-guarded: a second claimant (stale
   * recovery) or a deletion makes the losing owner's finalize a strict no-op.
   * Inline callers pass the already-loaded report; the worker reloads it.
   */
  async processExport(
    row: ReportExportRecord,
    knownReport?: ReportRow | undefined,
    now: Date = this.clock.now(),
    staleThreshold: Date | null = null,
  ): Promise<boolean> {
    // Atomic claim — the single claim path for scan and stale recovery. The
    // claim clears nextRetryAt (R1) and writes the lease timestamp.
    const lease = await this.claimRow(row.id, now, staleThreshold)
    if (!lease) return false // losing claimant: no generation, no finalization
    return this.processClaimed(row, lease, now, knownReport)
  }

  /**
   * Full processing pipeline for a row the CALLER already owns — the shared
   * body behind `processExport` (claim + this) and the inline request path
   * (reserve + this under the SAME lease, R2/R4). No re-claim: every
   * terminal/retry write stays guarded by `status: 'PROCESSING'` AND
   * `processingStartedAt` EQUALS the passed lease, so a takeover or deletion
   * still makes this instance a strict no-op.
   */
  async processClaimed(
    row: ReportExportRecord,
    lease: Date,
    now: Date = this.clock.now(),
    knownReport?: ReportRow | undefined,
  ): Promise<boolean> {
    // Defensive guards against a stale in-memory row (a claimed row is never
    // terminal in the DB — the claim predicate cannot match READY/FAILED).
    if (REPORT_EXPORT_TERMINAL_STATUSES.includes(row.status)) return true
    if (row.attemptCount >= EXPORT_MAX_ATTEMPTS) {
      await this.markFailed(
        row,
        'MAX_ATTEMPTS',
        'Maximum attempts exceeded',
        now,
        EXPORT_MAX_ATTEMPTS,
        lease,
      )
      return true
    }

    // Re-check owner/report/permission under the requester's CURRENT identity.
    const access = await this.validateAccess(row.tenantId, row.userId, row.reportId)
    if (!access.ok) {
      await this.markFailed(row, access.code, access.message, now, undefined, lease)
      return true
    }

    let report: ReportRow
    try {
      report = knownReport ?? (await this.loadReport(row.tenantId, row.userId, row.reportId))
    } catch {
      await this.markFailed(
        row,
        'REPORT_UNAVAILABLE',
        'Report is no longer available',
        now,
        undefined,
        lease,
      )
      return true
    }

    try {
      const snapshot = await this.snapshotFor(row)
      const { payload } = await this.payloadService.executeFull(
        row.tenantId,
        row.userId,
        report,
        snapshot,
        // Contract C14: the authoritative request-time total (persisted at
        // request time) is the trustworthy expectation for CUSTOM exports.
        row.expectedTotalRows ?? undefined,
      )
      // Contract C17: final byte count checked inside the renderer.
      const chartPng = await chartPngForPayload(payload)
      const branding = await this.tenantBranding(row.tenantId)
      const attachment = await this.attachmentService.render(payload, row.format, {
        profile: 'USER_EXPORT',
        branding,
        chartPng: chartPng ?? undefined,
      })
      // Deterministic tenant-first path — user text can never inject segments.
      const objectPath = ['reports', row.tenantId, row.userId, row.id, attachment.filename].join(
        '/',
      )

      // At-least-once: on retry, remove any orphan object at the same path
      // (e.g. upload succeeded but the READY update failed) before re-upload.
      if (row.attemptCount > 0) {
        await this.removeOrphanObject(objectPath)
      }

      const bucket = this.storageService.reportExportBucket()
      await this.storageService.uploadToBucket(
        bucket,
        objectPath,
        attachment.content,
        attachment.contentType,
      )

      // READY transition records safe metadata only — the signed URL is never
      // part of the row (Contract D26). Lease-guarded: if the lease was taken
      // over or the row was deleted mid-render, the write matches 0 rows, the
      // freshly uploaded object is removed best-effort and no notification is
      // sent (the takeover instance / deletion is the owner now).
      const ready = await this.markReady(row, {
        filename: attachment.filename,
        contentType: attachment.contentType,
        objectPath,
        fileSizeBytes: attachment.content.length,
        now,
        lease,
      })
      // Contract D26: notification failure must never roll back READY.
      // notifySafe already never throws; this second guard keeps the
      // invariant structural even if a future producer bypasses notifySafe.
      if (ready) {
        await this.notifyReady(row, report)
      }
    } catch (error) {
      await this.handleFailure(row, error, now, lease)
    }
    return true
  }

  /**
   * Request-time probe failure (M4 / R4 / Contract D25): an inline export
   * whose page-1 execution throws after the row was created must leave a
   * truthful terminal FAILED (or a retryable queue state for classified
   * transient errors) — never an orphan PENDING row. The request path passes
   * its HELD reservation lease so the failure finalizes synchronously under
   * the same lease: no re-claim, no mutation-error + delayed worker FAILED
   * edge. Without a held lease it claims first — a losing claimant returns
   * false and the worker classifies the row. Reuses the worker's failure
   * classification (ExportLimitError → typed code; BadRequest → terminal
   * INVALID_REQUEST; NotFound/Forbidden → terminal REPORT_UNAVAILABLE;
   * storage/network regex → retry backoff; else retryable UNKNOWN).
   */
  async failInlineProbe(
    row: ReportExportRecord,
    error: unknown,
    now: Date = this.clock.now(),
    lease?: Date,
  ): Promise<boolean> {
    const heldLease = lease ?? (await this.claimRow(row.id, now, null))
    if (!heldLease) return false // the worker already owns the row — it will classify
    await this.handleFailure(row, error, now, heldLease)
    return true
  }

  /**
   * R2/R4: lease-guarded release for the background worker. Atomically
   * persists the authoritative request-time total for CUSTOM (sales pass
   * nothing → the column stays null) AND returns the row to PENDING under
   * the request's lease, so the minute scan can claim it only AFTER
   * expectedTotalRows is durable (Contract C14/M1). `processingStartedAt`
   * and `nextRetryAt` are cleared so the scan's PENDING predicate owns the
   * row on the next tick. A losing release (lease taken over / row deleted)
   * returns false — the new owner decides the row's fate.
   */
  async releaseForBackground(
    row: ReportExportRecord,
    lease: Date,
    expectedTotalRows?: number | null,
  ): Promise<boolean> {
    const result = await this.prisma.reportExport.updateMany({
      where: this.leaseGuard(row, lease),
      data: {
        status: 'PENDING',
        processingStartedAt: null,
        nextRetryAt: null,
        ...(expectedTotalRows !== undefined ? { expectedTotalRows } : {}),
        updatedBy: row.userId,
      },
    })
    if ((result?.count ?? 0) === 0) {
      this.logger.warn(`Export ${row.id} background release skipped (lease lost/deleted)`)
      return false
    }
    this.logger.log(`Export ${row.id} released for background processing`)
    return true
  }

  /**
   * R2/R4: lease-guarded request-time persist of the CUSTOM expectation
   * (keeps PROCESSING) so the inline execution under the SAME lease still
   * fails DATA_CHANGED on request→execution drift (M1). A losing persist
   * (lease taken over / deleted) is a no-op — the new owner decides.
   */
  async persistExpectedTotalRows(
    row: ReportExportRecord,
    lease: Date,
    expectedTotalRows: number,
  ): Promise<boolean> {
    const result = await this.prisma.reportExport.updateMany({
      where: this.leaseGuard(row, lease),
      data: { expectedTotalRows, updatedBy: row.userId },
    })
    if ((result?.count ?? 0) === 0) {
      this.logger.warn(`Export ${row.id} expectedTotalRows persist skipped (lease lost/deleted)`)
      return false
    }
    return true
  }

  /** Contract D26: READY notification is best-effort; failure leaves READY intact. */
  private async notifyReady(row: ReportExportRecord, report: ReportRow): Promise<void> {
    try {
      await this.notificationsService.notifySafe(row.tenantId, row.userId, {
        recipientUserId: row.userId,
        type: 'REPORT_EXPORT_READY',
        title: `Export ready: ${report.name}`,
        body: `Your ${row.format} export "${report.name}" is ready to download.`,
        reportExportId: row.id,
        dedupeKey: `${EXPORT_READY_NOTIFICATION_DEDUPE_PREFIX}${row.id}`,
      })
    } catch (error) {
      // A thrown notification error is logged and swallowed — the READY row
      // (status/metadata/object) must survive notification failure.
      this.logger.error(
        `READY notification failed for export ${row.id} (row stays READY): ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  private async snapshotFor(row: ReportExportRecord): Promise<ReportConfig | null> {
    if (!row.filters) return null
    return row.filters as unknown as ReportConfig
  }

  /**
   * Failure classification shared by the worker AND the inline probe (M4):
   * bounds/data-drift failures are terminal with their typed code;
   * validation (BadRequest) and access/report (NotFound/Forbidden) failures
   * are terminal — retrying them cannot succeed; storage/network failures
   * consume the retry budget; anything else is a retryable UNKNOWN.
   */
  private async handleFailure(
    row: ReportExportRecord,
    error: unknown,
    now: Date,
    lease: Date,
  ): Promise<void> {
    if (error instanceof ExportLimitError) {
      // Non-retryable bounds/data-drift failure (Contract D25, C17).
      await this.markFailed(row, error.code, sanitizeExportError(error), now, undefined, lease)
      return
    }
    const message = sanitizeExportError(error)
    if (error instanceof BadRequestException) {
      // Invalid request/config — retrying cannot succeed (M4).
      await this.markFailed(row, 'INVALID_REQUEST', message, now, undefined, lease)
      return
    }
    if (error instanceof NotFoundException || error instanceof ForbiddenException) {
      // Report/source vanished or access revoked mid-flight (M4).
      await this.markFailed(row, 'REPORT_UNAVAILABLE', message, now, undefined, lease)
      return
    }
    if (
      error instanceof Error &&
      (error.message.includes('storage') ||
        error.message.includes('Storage') ||
        /ECONN|ETIMEDOUT|socket/i.test(error.message))
    ) {
      await this.handleRetryableFailure(row, 'STORAGE_UNAVAILABLE', message, now, lease)
      return
    }
    // Unknown error — consume the retry budget (mirrors schedule processor).
    await this.handleRetryableFailure(row, 'UNKNOWN', message, now, lease)
  }

  private async handleRetryableFailure(
    row: ReportExportRecord,
    errorCode: string,
    errorMessage: string,
    now: Date,
    lease: Date,
  ): Promise<void> {
    const nextAttempt = row.attemptCount + 1
    if (nextAttempt >= EXPORT_MAX_ATTEMPTS) {
      // Contract S13: terminal FAILED records the exhausted attempt count.
      await this.markFailed(row, errorCode, errorMessage, now, EXPORT_MAX_ATTEMPTS, lease)
      return
    }
    const nextRetryAt = new Date(now.getTime() + exportRetryDelayMsForAttempt(row.attemptCount + 1))
    const result = await this.prisma.reportExport.updateMany({
      where: this.leaseGuard(row, lease),
      data: {
        attemptCount: nextAttempt,
        nextRetryAt,
        processingStartedAt: null,
        errorCode,
        errorMessage,
        updatedBy: 'system',
      },
    })
    if ((result?.count ?? 0) === 0) {
      // Lease lost (takeover/deletion) — the new owner owns the row now.
      this.logger.warn(`Export ${row.id} retry update skipped (lease lost/deleted)`)
      return
    }
    this.logger.warn(
      `Export ${row.id} attempt ${nextAttempt} failed (${errorCode}); next retry at ${nextRetryAt.toISOString()}`,
    )
  }

  /** Contract D26: atomic READY metadata write; notification failure never rolls it back. */
  private async markReady(
    row: ReportExportRecord,
    meta: {
      filename: string
      contentType: string
      objectPath: string
      fileSizeBytes: number
      now: Date
      lease: Date
    },
  ): Promise<boolean> {
    const result = await this.prisma.reportExport.updateMany({
      where: this.leaseGuard(row, meta.lease),
      data: {
        status: 'READY',
        filename: meta.filename,
        contentType: meta.contentType,
        objectPath: meta.objectPath,
        fileSizeBytes: meta.fileSizeBytes,
        completedAt: meta.now,
        nextRetryAt: null,
        processingStartedAt: null,
        errorCode: null,
        errorMessage: null,
        updatedBy: 'system',
      },
    })
    if ((result?.count ?? 0) === 0) {
      // M8: the row was deleted or the lease was taken over while we were
      // rendering/uploading. Remove the freshly uploaded orphan object
      // best-effort; never mark READY and never notify.
      this.logger.warn(
        `Export ${row.id} READY finalize skipped (lease lost or row deleted); removing orphan object`,
      )
      await this.removeOrphanObject(meta.objectPath)
      return false
    }
    this.logger.log(`Export ${row.id} ready (${meta.fileSizeBytes} bytes)`)
    return true
  }

  /** Contract D27: terminal FAILED + best-effort object removal + one deduped notification. */
  private async markFailed(
    row: ReportExportRecord,
    errorCode: string,
    errorMessage: string,
    now: Date,
    finalAttemptCount?: number,
    lease?: Date,
  ): Promise<boolean> {
    const result = await this.prisma.reportExport.updateMany({
      where: this.leaseGuard(row, lease),
      data: {
        status: 'FAILED',
        completedAt: now,
        nextRetryAt: null,
        processingStartedAt: null,
        errorCode,
        errorMessage: sanitizeExportError(errorMessage),
        ...(finalAttemptCount !== undefined ? { attemptCount: finalAttemptCount } : {}),
        updatedBy: 'system',
      },
    })
    if ((result?.count ?? 0) === 0) {
      // Losing finalizer (I1): another owner took over or the row was
      // deleted — never notify and never overwrite terminal metadata.
      this.logger.warn(`Export ${row.id} FAILED finalize skipped (lease lost/deleted)`)
      return false
    }
    if (row.objectPath) {
      await this.removeOrphanObject(row.objectPath)
    }
    await this.notificationsService.notifySafe(row.tenantId, row.userId, {
      recipientUserId: row.userId,
      type: 'REPORT_EXPORT_FAILED',
      title: 'Report export failed',
      body: `The export could not be completed${row.reportId ? ' for the requested report' : ''}. ${
        errorCode === 'FILE_TOO_LARGE'
          ? 'The file exceeds the 50 MB limit — narrow the date filters and try again.'
          : errorCode === 'ROW_LIMIT'
            ? 'The report exceeds the 50,000-row limit — narrow the date filters and try again.'
            : errorCode === 'COLUMN_LIMIT'
              ? 'The report exceeds the 50-column limit — remove columns and try again.'
              : errorCode === 'DATA_CHANGED'
                ? 'The report data changed while the export was running — run the export again to capture the latest data.'
                : errorCode === 'INVALID_REQUEST'
                  ? 'The export request could not be validated — review the report configuration and try again.'
                  : 'Please review your report configuration and try again.'
      }`,
      reportExportId: row.id,
      dedupeKey: `${EXPORT_FAILED_NOTIFICATION_DEDUPE_PREFIX}${row.id}`,
    })
    this.logger.error(`Export ${row.id} failed permanently (${errorCode})`)
    return true
  }

  /**
   * Optimistic lease ownership predicate (Contract D25/D26): the row must
   * still be PROCESSING under the lease this owner wrote when it claimed.
   * `deletedAt: null` + tenantId/userId make deletion and cross-tenant writes
   * lose unconditionally.
   */
  private leaseGuard(
    row: ReportExportRecord,
    lease?: Date,
  ): {
    id: string
    tenantId: string
    userId: string
    deletedAt: null
    status: 'PROCESSING'
    processingStartedAt?: { equals: Date }
  } {
    return {
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      deletedAt: null,
      status: 'PROCESSING',
      ...(lease ? { processingStartedAt: { equals: lease } } : {}),
    }
  }

  private async removeOrphanObject(objectPath: string): Promise<void> {
    try {
      await this.storageService.removeFromBucket(
        this.storageService.reportExportBucket(),
        objectPath,
      )
    } catch {
      // best-effort — the object may not exist
    }
  }

  private async validateAccess(
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
    // Background path has no GraphQL context — resolve ADMIN bypass from the
    // persisted role rows (mirrors the schedule processor precedent).
    const roles = await this.prisma.userRole.findMany({
      where: { userId: ownerId, role: { tenantId } },
      select: { role: { select: { name: true } } },
    })
    if (roles.some((r) => r.role.name === 'ADMIN')) {
      return { ok: true }
    }
    const reportRead = await this.permissionsService.hasPermission(ownerId, 'REPORT', 'READ')
    if (!reportRead) {
      return {
        ok: false,
        code: 'ACCESS_REVOKED',
        message: 'Required REPORT:READ permission revoked',
      }
    }
    if (report.type === 'CUSTOM') {
      let source: CustomReportDataSource
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
          code: 'ACCESS_REVOKED',
          message: `Required ${gate}:READ permission revoked`,
        }
      }
      return { ok: true }
    }
    const dealRead = await this.permissionsService.hasPermission(ownerId, 'DEAL', 'READ')
    if (!dealRead) {
      return { ok: false, code: 'ACCESS_REVOKED', message: 'Required DEAL:READ permission revoked' }
    }
    return { ok: true }
  }

  private async tenantBranding(
    tenantId: string,
  ): Promise<{ name: string; primaryColor: string | null } | null> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, primaryColor: true },
    })
    return tenant ? { name: tenant.name, primaryColor: tenant.primaryColor } : null
  }

  private async loadReport(tenantId: string, userId: string, reportId: string): Promise<ReportRow> {
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
      throw new Error('Report not found')
    }
    return row as unknown as ReportRow
  }
}

export type { ReportExportStatus }
