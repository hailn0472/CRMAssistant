/**
 * Pure document-type allowlist and validation helpers (Story 3.6).
 *
 * Deliberately has zero NestJS imports so it can be unit-tested in isolation.
 * Binary documents are validated by extension AND magic bytes: an `.exe`
 * renamed `contract.pdf` passes an extension check and a client-set
 * Content-Type, so the first bytes of the file are the deciding signal.
 */

export type AllowedDocumentType = {
  extension: string
  mimeType: string
  magic: Buffer
}

export const ALLOWED_DOCUMENT_TYPES: AllowedDocumentType[] = [
  { extension: 'pdf', mimeType: 'application/pdf', magic: Buffer.from([0x25, 0x50, 0x44, 0x46]) },
  // DOCX and XLSX are both ZIP containers, so PK\x03\x04 proves only "some ZIP".
  // Distinguishing them properly means reading the ZIP central directory, which is
  // out of scope; the extension disambiguates between them while the magic bytes
  // still eliminate the renamed-executable class of problem.
  {
    extension: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    magic: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  },
  {
    extension: 'xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    magic: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  },
  { extension: 'png', mimeType: 'image/png', magic: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  { extension: 'jpg', mimeType: 'image/jpeg', magic: Buffer.from([0xff, 0xd8, 0xff]) },
  { extension: 'jpeg', mimeType: 'image/jpeg', magic: Buffer.from([0xff, 0xd8, 0xff]) },
]

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024

/**
 * Reduces an uploaded file name to a storage-safe object-path segment:
 * strips path separators and `..`, replaces anything outside
 * `[A-Za-z0-9._-]` with `-`, collapses runs of `-`, and truncates to 100 chars.
 */
export function sanitizeFileName(name: string): string {
  return name
    .replace(/\.\./g, '')
    .replace(/[\\/]/g, '')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
}

/**
 * Validates a document upload by extension and magic bytes.
 *
 * The extension selects the allowlist entry; the file's first bytes must then
 * match that entry's magic. Returns the canonical `{ extension, mimeType }`
 * from the allowlist (never the client-declared MIME type), or `null` when
 * either check fails. `declaredMimeType` is accepted for signature symmetry
 * with the multer file object but is not authoritative — browsers report
 * inconsistent MIME types (notably `application/octet-stream`).
 */
export function detectDocumentType(
  fileName: string,
  _declaredMimeType: string,
  head: Buffer,
): { extension: string; mimeType: string } | null {
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex <= 0) return null
  const extension = fileName.slice(dotIndex + 1).toLowerCase()

  const entry = ALLOWED_DOCUMENT_TYPES.find((type) => type.extension === extension)
  if (!entry) return null

  if (head.length < entry.magic.length) return null
  for (let i = 0; i < entry.magic.length; i++) {
    if (head[i] !== entry.magic[i]) return null
  }

  return { extension: entry.extension, mimeType: entry.mimeType }
}
