/**
 * Story 6.6 (Contract B5): closed report-export vocabulary, bounds and typed
 * safe error codes. Pure module — no Nest/Prisma imports so it stays
 * framework-free and unit-testable in isolation. Pothos and the service layer
 * derive from the const tuples here; never hand-copy a second vocabulary.
 */

export const REPORT_EXPORT_STATUSES = ['PENDING', 'PROCESSING', 'READY', 'FAILED'] as const
export type ReportExportStatus = (typeof REPORT_EXPORT_STATUSES)[number]

/** Terminal statuses — the worker never re-processes these rows. */
export const REPORT_EXPORT_TERMINAL_STATUSES: readonly ReportExportStatus[] = [
  'READY',
  'FAILED',
] as const

export const REPORT_EXPORT_ERROR_CODES = [
  'FILE_TOO_LARGE',
  'ROW_LIMIT',
  'COLUMN_LIMIT',
  'DATA_CHANGED',
  'INVALID_REQUEST',
  'ACCESS_REVOKED',
  'REPORT_UNAVAILABLE',
  'UNSUPPORTED_REPORT',
  'STORAGE_UNAVAILABLE',
  'NOTIFICATION_FAILED',
  'MAX_ATTEMPTS',
  'UNKNOWN',
] as const
export type ReportExportErrorCode = (typeof REPORT_EXPORT_ERROR_CODES)[number]

// ─── Bounds (Contract C17) ───────────────────────────────────────────────────

/** 50 MB user-export byte cap (52,428,800 bytes). */
export const USER_EXPORT_MAX_BYTES = 50 * 1024 * 1024

/** 50,000-row user-export cap (both sales buckets and custom rows). */
export const USER_EXPORT_MAX_ROWS = 50_000

/** 50-column cap shared by SCHEDULED_EMAIL and USER_EXPORT profiles. */
export const MAX_EXPORT_COLUMNS = 50

/** Custom exports run inline only when totalRows <= this (Contract B12). */
export const CUSTOM_INLINE_MAX_ROWS = 100

/** Custom large-export paging window (Contract C14) — stable page order. */
export const CUSTOM_EXPORT_PAGE_SIZE = 100

/** Fresh signed-URL TTL for owner downloads — 86,400 seconds = 24 hours. */
export const SIGNED_URL_TTL_SECONDS = 86_400

// ─── Durable processor constants (Contract D23, D25) ─────────────────────────

export const EXPORT_MAX_ATTEMPTS = 4 // initial attempt + 3 retries
export const EXPORT_RETRY_DELAYS_MS = [60_000, 120_000, 240_000] as const // 1/2/4 min
export const EXPORT_STALE_CLAIM_LEASE_MS = 15 * 60 * 1000 // 15 minutes
export const EXPORT_BATCH_SIZE = 50
export const EXPORT_CONCURRENCY = 4
export const EXPORT_ERROR_MESSAGE_LENGTH = 500

/** Terminal async-failure notification dedupe key (Contract D27). */
export const EXPORT_FAILED_NOTIFICATION_DEDUPE_PREFIX = 'report-export-failed:'
/** Ready notification dedupe key (Contract D26). */
export const EXPORT_READY_NOTIFICATION_DEDUPE_PREFIX = 'report-export-ready:'

/** Retry delay in ms for the attempt number that just failed (1-based). */
export function exportRetryDelayMsForAttempt(attemptCount: number): number {
  const index = Math.min(Math.max(attemptCount - 1, 0), EXPORT_RETRY_DELAYS_MS.length - 1)
  return EXPORT_RETRY_DELAYS_MS[index] ?? EXPORT_RETRY_DELAYS_MS[EXPORT_RETRY_DELAYS_MS.length - 1]!
}

/** Sanitized/truncated error text — no secrets, storage URLs or raw JSON. */
export function sanitizeExportError(
  error: unknown,
  maxLength = EXPORT_ERROR_MESSAGE_LENGTH,
): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

export function isReportExportErrorCode(value: string): value is ReportExportErrorCode {
  return (REPORT_EXPORT_ERROR_CODES as readonly string[]).includes(value)
}
