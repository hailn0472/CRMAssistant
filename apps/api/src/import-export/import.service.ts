import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { performance } from 'node:perf_hooks'

import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import { DuplicateDetectionService } from './duplicate-detection.service'
import { ImportProgressStore } from './import-progress.store'
import { BACKGROUND_METRICS_PORT, type BackgroundMetricsPort } from '../observability/metrics.types'
import type {
  CsvRow,
  ImportPreviewResponse,
  ImportResultResponse,
  ImportStartedResponse,
  ImportStatusResponse,
  ImportStrategy,
  ParsedCsv,
  PreviewRow,
} from './dto/import-result.dto'
import type { Prisma } from '@prisma/client'

const BATCH_SIZE = 100

/** Rows returned in the preview payload. The UI shows 10; the rest give it headroom. */
const PREVIEW_ROW_LIMIT = 20

/**
 * Per-batch transaction budget. Batches are deliberately small so this never
 * approaches Prisma's default 5s interactive-transaction timeout.
 */
const TRANSACTION_OPTIONS = { timeout: 30_000, maxWait: 10_000 }

type IndexedRow = CsvRow & { rowNumber: number }

type BatchOutcome = {
  imported: number
  skipped: number
  updated: number
  errors: Array<{ row: number; reason: string }>
}

/**
 * Converts a zero-based CSV data-row index into the line number the user sees
 * in their spreadsheet (line 1 is the header row).
 */
function toFileLine(rowNumber: number): number {
  return rowNumber + 2
}

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly duplicateDetectionService: DuplicateDetectionService,
    private readonly progressStore: ImportProgressStore,
    private readonly auditService: AuditService,
    @Optional()
    @Inject(BACKGROUND_METRICS_PORT)
    private readonly backgroundMetrics?: BackgroundMetricsPort,
  ) {}

  async previewImport(
    tenantId: string,
    _userId: string,
    csvRows: CsvRow[],
  ): Promise<ImportPreviewResponse> {
    const detection = await this.duplicateDetectionService.detectDuplicates(tenantId, csvRows)

    // Interleave the three categories back into file order and cap the payload,
    // so the table the user inspects actually contains their duplicates and
    // invalid rows rather than the first N new ones.
    const previewRows: PreviewRow[] = [
      ...detection.newRows.map((r) => ({
        rowNumber: toFileLine(r.rowNumber),
        email: r.email,
        firstName: r.firstName,
        lastName: r.lastName,
        status: 'new' as const,
      })),
      ...detection.duplicateRows.map((r) => ({
        rowNumber: toFileLine(r.rowNumber),
        email: r.email,
        firstName: r.firstName,
        lastName: r.lastName,
        status: 'duplicate' as const,
        existingContact: r.existingContact,
      })),
      ...detection.invalidRows.map((r) => ({
        rowNumber: toFileLine(r.rowNumber),
        email: r.email,
        firstName: r.firstName,
        lastName: r.lastName,
        status: 'invalid' as const,
        reason: r.reason,
      })),
    ]
      .sort((a, b) => a.rowNumber - b.rowNumber)
      .slice(0, PREVIEW_ROW_LIMIT)

    return {
      preview: true,
      totalRows: csvRows.length,
      newRows: detection.newRows.length,
      duplicateRows: detection.duplicateRows.length,
      invalidRows: detection.invalidRows.length,
      previewRows,
    }
  }

  /**
   * Registers an import, kicks it off in the background and returns immediately.
   * Progress is polled via `getStatus`, so a large file never depends on one
   * long-lived HTTP request.
   */
  startImport(
    tenantId: string,
    userId: string,
    parsed: ParsedCsv,
    strategy: ImportStrategy = 'skip',
  ): ImportStartedResponse {
    const importId = randomUUID()
    const rows = this.dedupeByEmail(parsed.rows)
    const totalBatches = Math.max(Math.ceil(rows.length / BATCH_SIZE), 1)

    this.progressStore.start(importId, tenantId, parsed.rows.length, totalBatches)

    void this.executeImport(tenantId, userId, parsed, strategy, importId).catch(
      (error: unknown) => {
        // executeImport already records failures in the store; this guards against
        // an unexpected throw escaping the fire-and-forget call.
        this.logger.error(
          `Import ${importId} failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
        )
      },
    )

    return { importId, totalRows: parsed.rows.length }
  }

  getStatus(importId: string, tenantId: string): ImportStatusResponse | null {
    return this.progressStore.get(importId, tenantId)
  }

  /**
   * Runs the import batch by batch. Each batch commits in its own transaction,
   * so a failure part-way through leaves earlier batches persisted and the
   * reported counts describe what is actually in the database.
   */
  async executeImport(
    tenantId: string,
    userId: string,
    parsed: ParsedCsv,
    strategy: ImportStrategy = 'skip',
    importId?: string,
  ): Promise<ImportResultResponse> {
    const startedAt = performance.now()
    try {
      const execution = await this.executeImportInternal(
        tenantId,
        userId,
        parsed,
        strategy,
        importId,
      )
      this.recordBackgroundJob(execution.fatal ? 'error' : 'success', performance.now() - startedAt)
      return execution.result
    } catch (error) {
      this.recordBackgroundJob('error', performance.now() - startedAt)
      throw error
    }
  }

  private async executeImportInternal(
    tenantId: string,
    userId: string,
    parsed: ParsedCsv,
    strategy: ImportStrategy = 'skip',
    importId?: string,
  ): Promise<{ result: ImportResultResponse; fatal: boolean }> {
    const startTime = Date.now()
    const totalRows = parsed.rows.length

    // Deduplicate by lowercase email for every strategy — two rows for the same
    // email previously produced double counts (and, under `update`, two writes).
    const rows = this.dedupeByEmail(parsed.rows)
    const dropped = parsed.rows.length - rows.length

    const errors: Array<{ row: number; reason: string }> = []
    let imported = 0
    let skipped = 0
    let updated = 0

    const isAdmin = strategy === 'update' ? await this.userIsAdmin(tenantId, userId) : false
    const totalBatches = Math.max(Math.ceil(rows.length / BATCH_SIZE), 1)

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batch = rows.slice(batchIndex * BATCH_SIZE, (batchIndex + 1) * BATCH_SIZE)
      if (batch.length === 0) continue

      try {
        const outcome = await this.prisma.$transaction(
          (tx) =>
            this.processBatch(tx, {
              tenantId,
              userId,
              batch,
              strategy,
              presentColumns: parsed.presentColumns,
              isAdmin,
            }),
          TRANSACTION_OPTIONS,
        )

        imported += outcome.imported
        skipped += outcome.skipped
        updated += outcome.updated
        errors.push(...outcome.errors)
      } catch (error) {
        // The batch rolled back — none of its rows were written, so report every
        // row in it as failed against its real line number.
        const reason = error instanceof Error ? error.message : 'Import failed'
        for (const row of batch) {
          errors.push({ row: toFileLine(row.rowNumber), reason })
        }
        this.logger.error(`Import batch ${batchIndex + 1}/${totalBatches} failed: ${reason}`)
      }

      if (importId) {
        this.progressStore.update(importId, {
          batch: batchIndex + 1,
          imported,
          skipped,
          updated,
          failed: errors.length + dropped,
        })
      }
    }

    // Rows removed as intra-file duplicates are reported rather than silently lost.
    if (dropped > 0) {
      errors.push({ row: 0, reason: `${dropped} duplicate row(s) within the file were ignored` })
    }

    const result: ImportResultResponse = {
      totalRows,
      imported,
      skipped,
      updated,
      failed: errors.length,
      errors,
      duration: Date.now() - startTime,
    }

    await this.recordAudit(tenantId, userId, strategy, result)

    const hadFatalBatch = imported + updated + skipped === 0 && errors.length > 0
    if (importId) {
      if (hadFatalBatch) {
        this.progressStore.fail(importId, errors[0]?.reason ?? 'Import failed', result)
      } else {
        this.progressStore.complete(importId, result)
      }
    }

    return { result, fatal: hadFatalBatch }
  }

  /** Keeps the last occurrence of each email, mirroring spreadsheet expectations. */
  private dedupeByEmail(csvRows: CsvRow[]): IndexedRow[] {
    const byEmail = new Map<string, IndexedRow>()
    for (let i = 0; i < csvRows.length; i++) {
      const row = csvRows[i]!
      const key = row.email.trim().toLowerCase()
      // Rows with an unusable email are kept individually so duplicate
      // detection can report each one as invalid.
      byEmail.set(key || `__invalid_${i}`, { ...row, rowNumber: i })
    }
    return [...byEmail.values()].sort((a, b) => a.rowNumber - b.rowNumber)
  }

  private async processBatch(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string
      userId: string
      batch: IndexedRow[]
      strategy: ImportStrategy
      presentColumns: Set<string>
      isAdmin: boolean
    },
  ): Promise<BatchOutcome> {
    const { tenantId, userId, batch, strategy, presentColumns, isAdmin } = params
    const errors: Array<{ row: number; reason: string }> = []
    let skipped = 0
    let updated = 0

    const detection = await this.duplicateDetectionService.detectDuplicates(tenantId, batch, tx)

    for (const invalid of detection.invalidRows) {
      errors.push({ row: toFileLine(invalid.rowNumber), reason: invalid.reason })
    }

    const rowsToCreate = detection.newRows
    const rowsToUpdate: Array<IndexedRow & { existingId: string }> = []

    if (strategy === 'skip') {
      skipped = detection.duplicateRows.length
    } else if (strategy === 'create_new') {
      // The tenant-scoped unique index on email makes a genuine second contact
      // impossible, so duplicates are reported instead of silently dropped.
      for (const duplicate of detection.duplicateRows) {
        errors.push({ row: toFileLine(duplicate.rowNumber), reason: 'Email already exists' })
      }
    } else {
      const candidates = detection.duplicateRows.map((d) => ({
        ...d,
        existingId: d.existingContact.id,
      }))
      const editableIds = await this.resolveEditableContactIds(
        tx,
        tenantId,
        userId,
        isAdmin,
        candidates.map((c) => c.existingId),
      )

      for (const candidate of candidates) {
        if (editableIds.has(candidate.existingId)) {
          rowsToUpdate.push(candidate)
        } else {
          errors.push({
            row: toFileLine(candidate.rowNumber),
            reason: 'Insufficient permissions to update this contact',
          })
        }
      }
    }

    const batchStart = new Date()

    let imported = 0
    if (rowsToCreate.length > 0) {
      const created = await tx.contact.createMany({
        data: rowsToCreate.map((row) => ({
          tenantId,
          // Stored lowercase to match ContactsService.normalizeEmail, which keeps
          // the tenant-scoped unique index and duplicate detection consistent.
          email: row.email.trim().toLowerCase(),
          firstName: row.firstName.trim(),
          lastName: row.lastName.trim(),
          phone: row.phone?.trim() || null,
          company: row.company?.trim() || null,
          jobTitle: row.jobTitle?.trim() || null,
          ownerId: userId,
          createdBy: userId,
          updatedBy: userId,
        })),
        skipDuplicates: true,
      })
      imported = created.count
    }

    for (const row of rowsToUpdate) {
      await tx.contact.updateMany({
        where: { id: row.existingId, tenantId },
        data: this.buildUpdateData(row, presentColumns, userId),
      })
      updated++
    }

    // One lookup serves both tag assignment and the concurrency check below.
    const emails = batch.map((r) => r.email.trim().toLowerCase()).filter(Boolean)
    const contacts =
      emails.length > 0
        ? await tx.contact.findMany({
            where: { tenantId, email: { in: emails } },
            select: { id: true, email: true, createdAt: true },
          })
        : []
    const contactByEmail = new Map(contacts.map((c) => [c.email.toLowerCase(), c]))

    // A shortfall means another writer inserted the same email between detection
    // and the write. Attribute it to the exact rows rather than inventing counts.
    if (imported < rowsToCreate.length) {
      for (const row of rowsToCreate) {
        const contact = contactByEmail.get(row.email.trim().toLowerCase())
        if (contact && contact.createdAt < batchStart) {
          errors.push({
            row: toFileLine(row.rowNumber),
            reason: 'Email already exists (created concurrently)',
          })
        }
      }
    }

    await this.assignTags(tx, tenantId, [...rowsToCreate, ...rowsToUpdate], contactByEmail)

    return { imported, skipped, updated, errors }
  }

  /**
   * Builds the update payload from the columns the CSV actually contained, so a
   * partial file (e.g. only email/firstName/lastName) does not wipe the fields
   * it never mentioned.
   */
  private buildUpdateData(
    row: IndexedRow,
    presentColumns: Set<string>,
    userId: string,
  ): Prisma.ContactUpdateManyMutationInput {
    const data: Prisma.ContactUpdateManyMutationInput = { updatedBy: userId }

    if (presentColumns.has('firstName')) data.firstName = row.firstName.trim()
    if (presentColumns.has('lastName')) data.lastName = row.lastName.trim()
    if (presentColumns.has('phone')) data.phone = row.phone?.trim() || null
    if (presentColumns.has('company')) data.company = row.company?.trim() || null
    if (presentColumns.has('jobTitle')) data.jobTitle = row.jobTitle?.trim() || null

    return data
  }

  /**
   * Mirrors ContactsService.resolveAccessLevel (owner or an EDIT/FULL sharing
   * rule, with an ADMIN bypass) but resolves a whole batch in two queries
   * instead of one round-trip per row.
   */
  private async resolveEditableContactIds(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    isAdmin: boolean,
    contactIds: string[],
  ): Promise<Set<string>> {
    if (contactIds.length === 0) return new Set()
    if (isAdmin) return new Set(contactIds)

    const owned = await tx.contact.findMany({
      where: { id: { in: contactIds }, tenantId, ownerId: userId },
      select: { id: true },
    })
    const editable = new Set(owned.map((c) => c.id))

    const remaining = contactIds.filter((id) => !editable.has(id))
    if (remaining.length === 0) return editable

    const rules = await tx.sharingRule.findMany({
      where: {
        tenantId,
        resourceType: 'CONTACT',
        resourceId: { in: remaining },
        deletedAt: null,
        accessLevel: { in: ['EDIT', 'FULL'] },
        OR: [
          { sharedWithUserId: userId },
          { sharedWithTeam: { members: { some: { id: userId } } } },
        ],
      },
      select: { resourceId: true },
    })
    for (const rule of rules) editable.add(rule.resourceId)

    return editable
  }

  private async userIsAdmin(tenantId: string, userId: string): Promise<boolean> {
    const adminRoles = await this.prisma.userRole.count({
      where: { userId, role: { tenantId, deletedAt: null, name: 'ADMIN' } },
    })
    return adminRoles > 0
  }

  /**
   * Resolves every tag named in the batch with one upsert per distinct name, then
   * links them. `upsert` on @@unique([tenantId, name]) replaces the previous
   * find-then-create, whose swallowed P2002 would poison the whole transaction.
   */
  private async assignTags(
    tx: Prisma.TransactionClient,
    tenantId: string,
    rows: IndexedRow[],
    contactByEmail: Map<string, { id: string }>,
  ): Promise<void> {
    const rowsWithTags = rows.filter((r) => !!r.tags && r.tags.trim() !== '')
    if (rowsWithTags.length === 0) return

    const tagNamesByRow = new Map<IndexedRow, string[]>()
    const distinctNames = new Set<string>()

    for (const row of rowsWithTags) {
      // Dedupe within the row so "VIP, Enterprise; VIP" links VIP once.
      const names = [
        ...new Set(
          row
            .tags!.split(/[,;]/)
            .map((t) => t.trim())
            .filter(Boolean),
        ),
      ]
      if (names.length === 0) continue
      tagNamesByRow.set(row, names)
      for (const name of names) distinctNames.add(name)
    }

    if (distinctNames.size === 0) return

    const tagIdByName = new Map<string, string>()
    for (const name of distinctNames) {
      const tag = await tx.tag.upsert({
        where: { tenantId_name: { tenantId, name } },
        create: { tenantId, name },
        update: {},
        select: { id: true },
      })
      tagIdByName.set(name, tag.id)
    }

    const links: Array<{ contactId: string; tagId: string }> = []
    for (const [row, names] of tagNamesByRow) {
      // Resolve the contact from the write we just performed rather than by
      // re-querying the email, which could attach tags to somebody else's record.
      const contact = contactByEmail.get(row.email.trim().toLowerCase())
      if (!contact) continue
      for (const name of names) {
        const tagId = tagIdByName.get(name)
        if (tagId) links.push({ contactId: contact.id, tagId })
      }
    }

    if (links.length > 0) {
      await tx.contactTag.createMany({ data: links, skipDuplicates: true })
    }
  }

  private async recordAudit(
    tenantId: string,
    userId: string,
    strategy: ImportStrategy,
    result: ImportResultResponse,
  ): Promise<void> {
    try {
      await this.auditService.log({
        tenantId,
        userId,
        action: 'CONTACT_IMPORTED',
        entity: 'Contact',
        entityId: 'bulk-import',
        details: {
          strategy,
          totalRows: result.totalRows,
          imported: result.imported,
          skipped: result.skipped,
          updated: result.updated,
          failed: result.failed,
          durationMs: result.duration,
        },
      })
    } catch (error) {
      // Audit failures must not discard an import that already committed.
      this.logger.warn(
        `Failed to write import audit log: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  private recordBackgroundJob(outcome: 'success' | 'error', durationMilliseconds: number): void {
    const labels = { jobGroup: 'import' as const, outcome }
    try {
      this.backgroundMetrics?.recordJob(labels)
    } catch {
      // Observability must never change import business behavior.
    }
    try {
      this.backgroundMetrics?.observeJobDuration(labels, Math.max(0, durationMilliseconds) / 1_000)
    } catch {
      // Observability must never change import business behavior.
    }
  }
}
