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
