import { IsOptional, IsString } from 'class-validator'

export type CsvRow = {
  email: string
  firstName: string
  lastName: string
  phone?: string
  company?: string
  jobTitle?: string
  tags?: string
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

export type BatchProgress = {
  batch: number
  totalBatches: number
  imported: number
  skipped: number
  updated: number
  failed: number
  totalRows: number
}

export class ExportQueryDto {
  @IsString()
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
}

export class ImportQueryDto {
  @IsString()
  @IsOptional()
  strategy?: ImportStrategy

  @IsString()
  @IsOptional()
  confirm?: string
}
