import { Injectable } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import { DuplicateDetectionService } from './duplicate-detection.service'
import type {
  CsvRow,
  ImportPreviewResponse,
  ImportResultResponse,
  ImportStrategy,
  PreviewRow,
} from './dto/import-result.dto'
import type { Prisma } from '@prisma/client'

const BATCH_SIZE = 100

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly duplicateDetectionService: DuplicateDetectionService,
  ) {}

  async previewImport(
    tenantId: string,
    _userId: string,
    csvRows: CsvRow[],
  ): Promise<ImportPreviewResponse> {
    const detection = await this.duplicateDetectionService.detectDuplicates(tenantId, csvRows)

    const previewRows: PreviewRow[] = [
      ...detection.newRows.map((r) => ({
        rowNumber: r.rowNumber + 1,
        email: r.email,
        firstName: r.firstName,
        lastName: r.lastName,
        status: 'new' as const,
      })),
      ...detection.duplicateRows.map((r) => ({
        rowNumber: r.rowNumber + 1,
        email: r.email,
        firstName: r.firstName,
        lastName: r.lastName,
        status: 'duplicate' as const,
        existingContact: r.existingContact,
      })),
      ...detection.invalidRows.map((r) => ({
        rowNumber: r.rowNumber + 1,
        email: r.email,
        firstName: r.firstName,
        lastName: r.lastName,
        status: 'invalid' as const,
        reason: r.reason,
      })),
    ]

    return {
      preview: true,
      totalRows: csvRows.length,
      newRows: detection.newRows.length,
      duplicateRows: detection.duplicateRows.length,
      invalidRows: detection.invalidRows.length,
      previewRows,
    }
  }

  async confirmImport(
    tenantId: string,
    userId: string,
    csvRows: CsvRow[],
    strategy: ImportStrategy = 'skip',
  ): Promise<ImportResultResponse> {
    const startTime = Date.now()
    const errors: Array<{ row: number; reason: string }> = []
    let imported = 0
    let skipped = 0
    let updated = 0

    try {
      // Wrap entire detection + write logic in a transaction to prevent TOCTOU races.
      // Inside the transaction, use `tx` (the transaction client) for all DB operations.
      await this.prisma.$transaction(async (tx) => {
        if (strategy === 'create_new') {
          // For create_new: skip duplicate detection entirely (avoids the P2002 crash
          // when duplicate emails are passed to createMany).
          // Instead, just filter invalid rows (empty emails) and deduplicate by
          // lowercase email within the CSV itself (keep last occurrence).
          const validRows: Array<CsvRow & { rowNumber: number }> = []
          for (let i = 0; i < csvRows.length; i++) {
            const row = csvRows[i]!
            const email = row.email.trim().toLowerCase()
            if (!email) {
              errors.push({ row: i + 1, reason: 'Empty email' })
            } else {
              validRows.push({ ...row, email: row.email.trim(), rowNumber: i })
            }
          }

          // Deduplicate by lowercase email — keep last occurrence within CSV
          const emailMap = new Map<string, CsvRow & { rowNumber: number }>()
          for (const row of validRows) {
            emailMap.set(row.email.toLowerCase(), row)
          }
          const dedupedRows = [...emailMap.values()]

          // Create all with skipDuplicates to let the DB handle any remaining
          // conflicts safely (e.g. rows inserted by a concurrent import)
          if (dedupedRows.length > 0) {
            for (let i = 0; i < dedupedRows.length; i += BATCH_SIZE) {
              const batch = dedupedRows.slice(i, i + BATCH_SIZE)
              const createData = batch.map((row) => ({
                tenantId,
                email: row.email,
                firstName: row.firstName || 'Unknown',
                lastName: row.lastName || 'Unknown',
                phone: row.phone || null,
                company: row.company || null,
                jobTitle: row.jobTitle || null,
                ownerId: userId,
                createdBy: userId,
                updatedBy: userId,
              }))
              await tx.contact.createMany({ data: createData, skipDuplicates: true })
              imported += batch.length
            }
          }

          // Process tags for created contacts
          const rowsWithTags = dedupedRows.filter((r) => !!r.tags && r.tags.trim() !== '')
          if (rowsWithTags.length > 0) {
            await this.assignTagsInTx(
              tx,
              tenantId,
              rowsWithTags.map((r) => ({ email: r.email, tags: r.tags! })),
            )
          }
        } else {
          // For skip and update strategies: run duplicate detection inside the transaction
          const detection = await this.duplicateDetectionService.detectDuplicates(
            tenantId,
            csvRows,
            tx,
          )
          const newRows = detection.newRows
          const duplicateRows = detection.duplicateRows
          const invalidRows = detection.invalidRows

          // Track invalid rows as failures
          for (const invalid of invalidRows) {
            errors.push({ row: invalid.rowNumber + 1, reason: invalid.reason })
          }

          // Determine which rows to process based on strategy
          let rowsToCreate: Array<CsvRow & { rowNumber: number }> = []
          let rowsToUpdate: Array<CsvRow & { rowNumber: number; existingId: string }> = []

          if (strategy === 'skip') {
            rowsToCreate = newRows
            skipped = duplicateRows.length
          } else if (strategy === 'update') {
            rowsToCreate = newRows
            rowsToUpdate = duplicateRows.map((d) => ({
              email: d.email,
              firstName: d.firstName,
              lastName: d.lastName,
              phone: d.phone,
              company: d.company,
              jobTitle: d.jobTitle,
              tags: d.tags,
              rowNumber: d.rowNumber,
              existingId: d.existingContact.id,
            }))
          }

          // Process creates in batches
          if (rowsToCreate.length > 0) {
            for (let i = 0; i < rowsToCreate.length; i += BATCH_SIZE) {
              const batch = rowsToCreate.slice(i, i + BATCH_SIZE)
              const createData = batch.map((row) => ({
                tenantId,
                email: row.email,
                firstName: row.firstName || 'Unknown',
                lastName: row.lastName || 'Unknown',
                phone: row.phone || null,
                company: row.company || null,
                jobTitle: row.jobTitle || null,
                ownerId: userId,
                createdBy: userId,
                updatedBy: userId,
              }))
              await tx.contact.createMany({ data: createData, skipDuplicates: true })
              imported += batch.length
            }
          }

          // Process updates in batches
          if (rowsToUpdate.length > 0) {
            for (let i = 0; i < rowsToUpdate.length; i += BATCH_SIZE) {
              const batch = rowsToUpdate.slice(i, i + BATCH_SIZE)
              for (const row of batch) {
                await tx.contact.updateMany({
                  where: { id: row.existingId, tenantId },
                  data: {
                    email: row.email,
                    firstName: row.firstName,
                    lastName: row.lastName,
                    phone: row.phone || null,
                    company: row.company || null,
                    jobTitle: row.jobTitle || null,
                    updatedBy: userId,
                  },
                })
              }
              updated += batch.length
            }
          }

          // Process tag assignments for all created/updated contacts
          const rowsWithTags: Array<{ email: string; tags: string }> = [
            ...rowsToCreate
              .filter(
                (r): r is CsvRow & { rowNumber: number; tags: string } =>
                  !!r.tags && r.tags.trim() !== '',
              )
              .map((r) => ({ email: r.email, tags: r.tags })),
            ...rowsToUpdate
              .filter(
                (r): r is CsvRow & { rowNumber: number; existingId: string; tags: string } =>
                  !!r.tags && r.tags.trim() !== '',
              )
              .map((r) => ({ email: r.email, tags: r.tags })),
          ]

          if (rowsWithTags.length > 0) {
            await this.assignTagsInTx(tx, tenantId, rowsWithTags)
          }
        }
      })
    } catch (error) {
      // Critical error — report all rows as failed
      const totalAttempted = csvRows.length - errors.length
      const remainingRows = totalAttempted - imported - updated
      for (let i = 0; i < remainingRows; i++) {
        errors.push({
          row: errors.length + i + 1,
          reason: error instanceof Error ? error.message : 'Import failed',
        })
      }
      imported = imported // Keep what was successfully imported
    }

    const duration = Date.now() - startTime

    return {
      totalRows: csvRows.length,
      imported,
      skipped,
      updated,
      failed: errors.length,
      errors,
      duration,
    }
  }

  /**
   * Assign tags to contacts using a transaction client.
   * This variant is used inside $transaction() to keep tag operations
   * within the same atomic context as the create/update operations.
   */
  private async assignTagsInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    rows: Array<{ email: string; tags: string }>,
  ): Promise<void> {
    for (const row of rows) {
      if (!row.tags || !row.tags.trim()) continue

      const tagNames = row.tags
        .split(/[,;]/)
        .map((t) => t.trim())
        .filter(Boolean)

      if (tagNames.length === 0) continue

      // Find or create each tag
      const tagIds: string[] = []
      for (const tagName of tagNames) {
        try {
          let tag = await tx.tag.findFirst({
            where: { tenantId, name: tagName },
          })

          if (!tag) {
            tag = await tx.tag.create({
              data: { tenantId, name: tagName },
            })
          }

          tagIds.push(tag.id)
        } catch {
          // Silently skip invalid tag names
        }
      }

      if (tagIds.length === 0) continue

      // Find the created/updated contact by email
      const contact = await tx.contact.findFirst({
        where: { tenantId, email: row.email },
      })

      if (contact) {
        await tx.contactTag.createMany({
          data: tagIds.map((tagId) => ({
            contactId: contact.id,
            tagId,
          })),
          skipDuplicates: true,
        })
      }
    }
  }
}
