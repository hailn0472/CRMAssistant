import { Transform } from 'class-transformer'
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator'

export type CsvRow = {
  email: string
  firstName: string
  lastName: string
  phone?: string
  company?: string
  jobTitle?: string
  tags?: string
}

/**
 * Result of parsing an uploaded file: the typed rows plus the set of `CsvRow`
 * fields the file actually carried. `presentColumns` is what lets the `update`
 * strategy leave absent columns untouched instead of nulling them.
 */
export type ParsedCsv = {
  rows: CsvRow[]
  presentColumns: Set<string>
}

export type CsvRowResult = CsvRow & {
  rowNumber: number
}

export type PreviewRow = {
  rowNumber: number
  email: string
  firstName: string
  lastName: string
  status: 'new' | 'duplicate' | 'invalid'
  existingContact?: {
    id: string
    email: string
    firstName: string
    lastName: string
  }
  reason?: string
}

export type ImportPreviewResponse = {
  preview: true
  totalRows: number
  newRows: number
  duplicateRows: number
  invalidRows: number
  previewRows: PreviewRow[]
}

export type ImportResultResponse = {
  totalRows: number
  imported: number
  skipped: number
  updated: number
  failed: number
  errors: Array<{ row: number; reason: string }>
  duration: number
}

export type DuplicateCheckResult = {
  newRows: CsvRowResult[]
  duplicateRows: Array<
    CsvRowResult & {
      existingContact: { id: string; email: string; firstName: string; lastName: string }
    }
  >
  invalidRows: Array<CsvRowResult & { reason: string }>
}

export type ImportStrategy = 'skip' | 'update' | 'create_new'

export const IMPORT_STRATEGIES: ImportStrategy[] = ['skip', 'update', 'create_new']

/** Live counters for an in-flight import, served to the frontend by polling. */
export type ImportProgress = {
  batch: number
  totalBatches: number
  imported: number
  skipped: number
  updated: number
  failed: number
  totalRows: number
}

/** Immediate response to a confirmed import; the work continues in the background. */
export type ImportStartedResponse = {
  importId: string
  totalRows: number
}

export type ImportStatusResponse = {
  importId: string
  status: 'running' | 'completed' | 'failed'
  progress: ImportProgress
  result?: ImportResultResponse
  error?: string
}

export class ExportQueryDto {
  @IsIn(['csv'])
  @IsOptional()
  format?: string

  @IsString()
  @IsOptional()
  tags?: string

  @IsString()
  @IsOptional()
  search?: string

  @IsString()
  @IsOptional()
  company?: string

  @IsString()
  @IsOptional()
  jobTitle?: string

  @IsString()
  @IsOptional()
  createdAtFrom?: string

  @IsString()
  @IsOptional()
  createdAtTo?: string
}

export class ImportQueryDto {
  @IsIn(IMPORT_STRATEGIES)
  @IsOptional()
  strategy?: ImportStrategy

  // Accepts the usual truthy spellings so `?confirm=1` cannot silently fall
  // through to a preview for a caller that meant to commit.
  @Transform(({ value }) => {
    if (value === undefined || value === '') return undefined
    return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase())
  })
  @IsBoolean()
  @IsOptional()
  confirm?: boolean
}
