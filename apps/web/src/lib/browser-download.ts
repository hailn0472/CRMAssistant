/**
 * Browser download helper for handling signed and direct URLs safely.
 *
 * Implements true cross-origin Blob downloads:
 * 1. Sanitizes user-provided or server-provided filename.
 * 2. Fetches the signed URL immediately using `credentials: 'omit'` (no persistent caching or leak).
 * 3. Checks `response.ok` and converts to same-origin Blob.
 * 4. Creates an Object URL and triggers an anchor download with sanitized filename.
 * 5. Cleans up the anchor and revokes the Object URL in `finally`.
 * 6. Throws typed BrowserDownloadError on fetch/blob/click failures without UI side-effects.
 */

export type BrowserDownloadErrorCode =
  | 'HTTP_ERROR'
  | 'NETWORK_ERROR'
  | 'BLOB_ERROR'
  | 'CLICK_FAILED'

export interface BrowserDownloadErrorOptions {
  code: BrowserDownloadErrorCode
  status?: number
  cause?: unknown
}

export class BrowserDownloadError extends Error {
  readonly code: BrowserDownloadErrorCode
  readonly status?: number
  override readonly cause?: unknown

  constructor(message: string, options: BrowserDownloadErrorOptions) {
    super(message)
    this.name = 'BrowserDownloadError'
    this.code = options.code
    this.status = options.status
    this.cause = options.cause
    Object.setPrototypeOf(this, BrowserDownloadError.prototype)
  }
}

/**
 * Sanitizes a filename to prevent path traversal or unwanted control chars,
 * ensuring safe download filename across browsers.
 */
export function sanitizeDownloadFilename(filename?: string | null, fallback = 'download'): string {
  if (!filename || typeof filename !== 'string') return fallback

  const trimmed = filename.trim()
  if (!trimmed) return fallback

  // Replace path separators with underscores, remove control chars, and strip leading/trailing non-alphanumeric chars
  const sanitized = trimmed
    .replace(/[/\\]+/g, '_')
    .replace(/[\x00-\x1f\x7f]+/g, '')
    .replace(/^[_\s.-]+|[_\s.-]+$/g, '')

  return sanitized || fallback
}

export interface TriggerBlobDownloadOptions {
  url: string
  filename?: string | null
  fallbackFilename?: string
}

/**
 * Downloads a resource via Fetch + Blob to guarantee same-origin `download` attribute
 * respect across all modern browsers (including cross-origin Supabase signed URLs).
 *
 * Pure, UI-agnostic helper — callers handle their own notifications/toasts.
 */
export async function downloadFileFromUrl({
  url,
  filename,
  fallbackFilename = 'report-export',
}: TriggerBlobDownloadOptions): Promise<void> {
  const safeFilename = sanitizeDownloadFilename(filename, fallbackFilename)

  let objectUrl: string | null = null
  let anchor: HTMLAnchorElement | null = null

  try {
    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
      })
    } catch (fetchErr) {
      throw new BrowserDownloadError('Download failed due to network or access restrictions', {
        code: 'NETWORK_ERROR',
        cause: fetchErr,
      })
    }

    if (!response.ok) {
      throw new BrowserDownloadError(`Download request failed with status ${response.status}`, {
        code: 'HTTP_ERROR',
        status: response.status,
      })
    }

    let blob: Blob
    try {
      blob = await response.blob()
    } catch (blobErr) {
      throw new BrowserDownloadError('Failed to read download blob', {
        code: 'BLOB_ERROR',
        cause: blobErr,
      })
    }

    try {
      objectUrl = window.URL.createObjectURL(blob)

      anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = safeFilename
      anchor.style.display = 'none'

      document.body.appendChild(anchor)
      anchor.click()
    } catch (clickErr) {
      throw new BrowserDownloadError('Failed to trigger download anchor click', {
        code: 'CLICK_FAILED',
        cause: clickErr,
      })
    }
  } finally {
    if (anchor && anchor.parentNode) {
      anchor.parentNode.removeChild(anchor)
    }
    if (objectUrl) {
      window.URL.revokeObjectURL(objectUrl)
    }
  }
}
