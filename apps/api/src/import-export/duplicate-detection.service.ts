import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import type { CsvRow, DuplicateCheckResult } from './dto/import-result.dto'

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

    // Separate invalid rows (empty email) from valid ones
    const validRows: Array<{ row: CsvRow; rowNumber: number; email: string }> = []

    for (let i = 0; i < csvRows.length; i++) {
      const row = csvRows[i]!
      const email = row.email.trim().toLowerCase()

      if (!email) {
        invalidRows.push({
          ...row,
          email: row.email.trim(),
          rowNumber: i,
          reason: 'Empty email',
        })
      } else {
        validRows.push({ row, rowNumber: i, email })
      }
    }

    if (validRows.length === 0) {
      return { newRows, duplicateRows, invalidRows }
    }

    // Query existing contacts by email (within tenant)
    const existingEmails = [...new Set(validRows.map((v) => v.email))]
    const existingContacts = await prisma.contact.findMany({
      where: {
        tenantId,
        email: { in: existingEmails },
        deletedAt: null,
      },
      select: { id: true, email: true, firstName: true, lastName: true },
    })

    // Build lookup map keyed by lowercase email
    const existingMap = new Map<string, (typeof existingContacts)[number]>()
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
}
