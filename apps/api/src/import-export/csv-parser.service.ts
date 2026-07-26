import { Injectable } from '@nestjs/common'

import type { CsvRow } from './dto/import-result.dto'

const REQUIRED_COLUMNS = ['email', 'firstname', 'lastname'] as const

// Display names for error messages (preserves casing)
const COLUMN_DISPLAY_NAMES: Record<string, string> = {
  email: 'email',
  firstname: 'firstName',
  lastname: 'lastName',
}

/**
 * Simple CSV parser that handles BOM, CRLF/LF, quoted fields, and TSV auto-detection.
 * Implemented without external dependencies to avoid npm install requirements.
 */
@Injectable()
export class CsvParserService {
  /**
   * Parse a CSV string into an array of typed row objects.
   * Strips BOM, handles quoted fields, trims whitespace, auto-detects delimiter.
   */
  parse(csvContent: string): CsvRow[] {
    // Strip BOM
    let content = csvContent.replace(/^\uFEFF/, '')

    // Normalize line endings
    content = content.replace(/\r\n/g, '\n')

    if (!content.trim()) {
      return []
    }

    // Detect delimiter: tab or comma
    const firstLine = content.split('\n')[0] ?? ''
    const delimiter = firstLine.includes('\t') ? '\t' : ','

    // Parse with quote-aware splitting
    const lines = content.split('\n')
    const rows: string[][] = []

    let currentRow: string[] = []
    let insideQuotes = false
    let currentField = ''

    for (const line of lines) {
      for (const char of line) {
        if (char === '"') {
          insideQuotes = !insideQuotes
        } else if (!insideQuotes && char === delimiter) {
          currentRow.push(currentField)
          currentField = ''
        } else {
          currentField += char
        }
      }

      if (insideQuotes) {
        // Continue building field across lines (quoted multiline value)
        currentField += '\n'
      } else {
        currentRow.push(currentField)
        currentField = ''
        if (currentRow.some((f) => f.trim() !== '')) {
          rows.push(currentRow)
        }
        currentRow = []
      }
    }

    if (rows.length === 0) {
      return []
    }

    // Parse headers
    const headers = rows[0]!.map((h) => h.trim().toLowerCase())

    // Validate required columns
    for (const required of REQUIRED_COLUMNS) {
      if (!headers.includes(required)) {
        throw new Error(
          `Invalid CSV: missing required column "${COLUMN_DISPLAY_NAMES[required] ?? required}"`,
        )
      }
    }

    // Parse data rows
    const dataRows = rows.slice(1).filter((row) => row.some((cell) => cell.trim() !== ''))

    return dataRows.map((row) => {
      const obj: Record<string, string> = {}
      for (let i = 0; i < headers.length; i++) {
        obj[headers[i]!] = (row[i] ?? '').trim()
      }
      return {
        email: obj.email ?? '',
        firstName: obj.firstname ?? '',
        lastName: obj.lastname ?? '',
        phone: obj.phone ?? '',
        company: obj.company ?? '',
        jobTitle: obj.jobtitle ?? '',
        tags: obj.tags ?? '',
      } as CsvRow
    })
  }
}
