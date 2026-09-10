import { BadRequestException, Injectable } from '@nestjs/common'
import { parse as parseCsv } from 'csv-parse/sync'

import type { CsvRow, ParsedCsv } from './dto/import-result.dto'

const REQUIRED_COLUMNS = ['email', 'firstname', 'lastname'] as const

// Display names for error messages (preserves casing)
const COLUMN_DISPLAY_NAMES: Record<string, string> = {
  email: 'email',
  firstname: 'firstName',
  lastname: 'lastName',
}

// Maps a normalized (lowercased) CSV header to the CsvRow field it fills.
const FIELD_BY_COLUMN: Record<string, keyof CsvRow> = {
  email: 'email',
  firstname: 'firstName',
  lastname: 'lastName',
  phone: 'phone',
  company: 'company',
  jobtitle: 'jobTitle',
  tags: 'tags',
}

/**
 * Hard cap on parsed rows. A 10MB upload is roughly 150k rows, which would
 * otherwise be held in memory and pushed through a single transaction.
 */
export const MAX_IMPORT_ROWS = 50_000

/**
 * CSV parser built on `csv-parse`, which handles BOM, CRLF/LF/CR line endings,
 * RFC 4180 quote escaping (`""`) and quoted multi-line values. The parser also
 * reports which columns the file actually contained so the `update` strategy can
 * leave absent columns untouched instead of nulling them.
 */
@Injectable()
export class CsvParserService {
  /**
   * Parse a CSV/TSV string into typed rows plus the set of columns present.
   * Throws BadRequestException for anything the caller should surface as a 400.
   */
  parse(csvContent: string): ParsedCsv {
    if (!csvContent.trim()) {
      return { rows: [], presentColumns: new Set() }
    }

    let presentColumns = new Set<string>()

    let records: Array<Record<string, string>>
    try {
      records = parseCsv(csvContent, {
        bom: true,
        // Auto-detect comma vs tab across the whole file rather than sniffing
        // the header line alone.
        delimiter: [',', '\t'],
        skip_empty_lines: true,
        trim: true,
        // Reject rows whose column count does not match the header instead of
        // silently truncating them (an unescaped comma used to shift data).
        relax_column_count: false,
        columns: (header: string[]) => {
          const normalized = header.map((h) => h.trim().toLowerCase())

          const seen = new Set<string>()
          for (const column of normalized) {
            if (seen.has(column)) {
              throw new BadRequestException(`Invalid CSV: duplicate column "${column}"`)
            }
            seen.add(column)
          }

          for (const required of REQUIRED_COLUMNS) {
            if (!seen.has(required)) {
              throw new BadRequestException(
                `Invalid CSV: missing required column "${COLUMN_DISPLAY_NAMES[required] ?? required}"`,
              )
            }
          }

          presentColumns = new Set(
            [...seen]
              .map((column) => FIELD_BY_COLUMN[column])
              .filter((field): field is keyof CsvRow => !!field),
          )

          return normalized
        },
      })
    } catch (error) {
      if (error instanceof BadRequestException) throw error
      throw new BadRequestException(
        `Invalid CSV: ${error instanceof Error ? error.message : 'unable to parse file'}`,
      )
    }

    if (records.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(
        `Invalid CSV: file contains ${records.length} rows, the maximum is ${MAX_IMPORT_ROWS}`,
      )
    }

    const rows = records.map((record) => ({
      email: record.email ?? '',
      firstName: record.firstname ?? '',
      lastName: record.lastname ?? '',
      phone: record.phone ?? '',
      company: record.company ?? '',
      jobTitle: record.jobtitle ?? '',
      tags: record.tags ?? '',
    }))

    return { rows, presentColumns }
  }
}
