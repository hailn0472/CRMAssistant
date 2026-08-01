/**
 * Pure formatting/validation helpers for deal documents (Story 3.6).
 * No React — unit-testable in isolation. The drop zone renders the exact
 * message `validateDocumentFile` returns, so the spec asserts one source of
 * truth for the client-side error copy.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

const ALLOWED_DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.png', '.jpg', '.jpeg']

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`

  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = units[0]!
  for (const candidate of units) {
    if (value < 1024) {
      unit = candidate
      break
    }
    value /= 1024
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${unit}`
}

export function fileKindLabel(mimeType: string): string {
  switch (mimeType) {
    case 'application/pdf':
      return 'PDF'
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'DOCX'
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return 'XLSX'
    case 'image/png':
      return 'PNG'
    case 'image/jpeg':
      return 'JPG'
    default:
      return 'FILE'
  }
}

/**
 * Client-side validation mirroring the server allowlist (AC 15/40). Returns an
 * error message or `null` when the file may be uploaded. The server remains the
 * authority — this exists to fail fast and to drive the drop-zone copy.
 */
export function validateDocumentFile(file: { name: string; size: number }): string | null {
  const dotIndex = file.name.lastIndexOf('.')
  const ext = dotIndex > 0 ? file.name.slice(dotIndex).toLowerCase() : ''

  if (!ALLOWED_DOCUMENT_EXTENSIONS.includes(ext)) {
    return ext
      ? `Unsupported file type "${ext}". Allowed: PDF, DOCX, XLSX, PNG, JPG`
      : 'This file has no extension. Only PDF, DOCX, XLSX, PNG and JPG files are accepted.'
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return 'This file is larger than the 10MB limit. Choose a smaller file.'
  }

  return null
}
