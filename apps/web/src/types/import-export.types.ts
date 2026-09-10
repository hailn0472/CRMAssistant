export type ImportStrategy = 'skip' | 'update' | 'create_new'

export type PreviewRow = {
  /** Line number in the user's file (line 1 is the header row). */
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

/** Returned immediately when an import is confirmed; the work runs server-side. */
export type ImportStartedResponse = {
  importId: string
  totalRows: number
}

export type ImportProgress = {
  batch: number
  totalBatches: number
  imported: number
  skipped: number
  updated: number
  failed: number
  totalRows: number
}

export type ImportStatusResponse = {
  importId: string
  status: 'running' | 'completed' | 'failed'
  progress: ImportProgress
  result?: ImportResultResponse
  error?: string
}

export type ExportFilters = {
  tags?: string[]
  company?: string
  search?: string
  jobTitle?: string
  createdAtFrom?: string
  createdAtTo?: string
}
