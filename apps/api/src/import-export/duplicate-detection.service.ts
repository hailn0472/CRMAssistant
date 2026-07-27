import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import type { CsvRow, DuplicateCheckResult } from './dto/import-result.dto'

/** Same shape ContactsService.normalizeEmail enforces on the GraphQL write path. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Matches the column widths used elsewhere for contact text fields. */
const MAX_FIELD_LENGTH = 255

type ExistingContactRow = {
  id: string
  email: string
  firstName: string
  lastName: string
}

@Injectable()
export class DuplicateDetectionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Detect duplicates by matching emails case-insensitively within a tenant.
   * Returns categorized rows: new, duplicate (with existing contact info), or invalid.
   *
   * @param tx - Optional Prisma transaction client for use inside $transaction().
   *             When provided, all DB queries run within that transaction context,
   *             preventing TOCTOU races between detection and writes.
   */
  async detectDuplicates(
    tenantId: string,
    csvRows: CsvRow[],
    tx?: Prisma.TransactionClient,
  ): Promise<DuplicateCheckResult> {
    const prisma = tx ?? this.prisma

    const newRows: DuplicateCheckResult['newRows'] = []
    const duplicateRows: DuplicateCheckResult['duplicateRows'] = []
    const invalidRows: DuplicateCheckResult['invalidRows'] = []

    // Separate invalid rows from ones worth checking against the database
    const validRows: Array<{ row: CsvRow; rowNumber: number; email: string }> = []

    for (let i = 0; i < csvRows.length; i++) {
      const row = csvRows[i]!
      const email = row.email.trim().toLowerCase()

      // Callers that batch a large file pass rows already carrying their
      // position in the original file; preserve it so error messages keep
      // pointing at the right line rather than restarting per batch.
      const rowNumber = (row as CsvRow & { rowNumber?: number }).rowNumber ?? i

      const reason = this.validateRow(row, email)
      if (reason) {
        invalidRows.push({ ...row, email: row.email.trim(), rowNumber, reason })
      } else {
        validRows.push({ row, rowNumber, email })
      }
    }

    if (validRows.length === 0) {
      return { newRows, duplicateRows, invalidRows }
    }

    // Match on LOWER(email) so a contact stored as "John@Example.com" is still
    // recognised for a CSV row of "john@example.com". Prisma's `mode:
    // 'insensitive'` does not apply to `in` filters, so this needs raw SQL.
    // Values are parameterized via Prisma.join — never interpolated.
    const existingEmails = [...new Set(validRows.map((v) => v.email))]
    const existingContacts = await prisma.$queryRaw<ExistingContactRow[]>(Prisma.sql`
      SELECT "id", "email", "firstName", "lastName"
      FROM "Contact"
      WHERE "tenantId" = ${tenantId}
        AND "deletedAt" IS NULL
        AND LOWER("email") IN (${Prisma.join(existingEmails)})
    `)

    // Build lookup map keyed by lowercase email
    const existingMap = new Map<string, ExistingContactRow>()
    for (const contact of existingContacts) {
      existingMap.set(contact.email.toLowerCase(), contact)
    }

    // Categorize each row
    for (const { row, rowNumber, email } of validRows) {
      const existing = existingMap.get(email)
      if (existing) {
        duplicateRows.push({
          ...row,
          email: row.email.trim(),
          rowNumber,
          existingContact: {
            id: existing.id,
            email: existing.email,
            firstName: existing.firstName,
            lastName: existing.lastName,
          },
        })
      } else {
        newRows.push({
          ...row,
          email: row.email.trim(),
          rowNumber,
        })
      }
    }

    return { newRows, duplicateRows, invalidRows }
  }

  /** Returns a reason string when the row cannot be imported, or null when it is valid. */
  private validateRow(row: CsvRow, normalizedEmail: string): string | null {
    if (!normalizedEmail) return 'Empty email'
    if (!EMAIL_PATTERN.test(normalizedEmail)) return 'Invalid email format'
    if (normalizedEmail.length > MAX_FIELD_LENGTH) return 'Email exceeds 255 characters'
    if (!row.firstName.trim()) return 'Missing firstName'
    if (!row.lastName.trim()) return 'Missing lastName'

    for (const [field, value] of [
      ['firstName', row.firstName],
      ['lastName', row.lastName],
      ['phone', row.phone],
      ['company', row.company],
      ['jobTitle', row.jobTitle],
    ] as const) {
      if (value && value.trim().length > MAX_FIELD_LENGTH) {
        return `${field} exceeds ${MAX_FIELD_LENGTH} characters`
      }
    }

    return null
  }
}
