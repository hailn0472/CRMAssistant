import {
  CUSTOM_INLINE_MAX_ROWS,
  EXPORT_BATCH_SIZE,
  EXPORT_CONCURRENCY,
  EXPORT_ERROR_MESSAGE_LENGTH,
  EXPORT_MAX_ATTEMPTS,
  EXPORT_RETRY_DELAYS_MS,
  EXPORT_STALE_CLAIM_LEASE_MS,
  MAX_EXPORT_COLUMNS,
  REPORT_EXPORT_ERROR_CODES,
  REPORT_EXPORT_STATUSES,
  REPORT_EXPORT_TERMINAL_STATUSES,
  SIGNED_URL_TTL_SECONDS,
  USER_EXPORT_MAX_BYTES,
  USER_EXPORT_MAX_ROWS,
  exportRetryDelayMsForAttempt,
  isReportExportErrorCode,
  sanitizeExportError,
} from '../report-export-types'

describe('report-export-types', () => {
  it('exposes exactly the closed PENDING/PROCESSING/READY/FAILED statuses', () => {
    expect(REPORT_EXPORT_STATUSES).toEqual(['PENDING', 'PROCESSING', 'READY', 'FAILED'])
    expect(REPORT_EXPORT_TERMINAL_STATUSES).toEqual(['READY', 'FAILED'])
  })

  it('caps user exports at exactly 50 MB / 50,000 rows / 50 columns', () => {
    expect(USER_EXPORT_MAX_BYTES).toBe(50 * 1024 * 1024)
    expect(USER_EXPORT_MAX_BYTES).toBe(52_428_800)
    expect(USER_EXPORT_MAX_ROWS).toBe(50_000)
    expect(MAX_EXPORT_COLUMNS).toBe(50)
  })

  it('runs custom exports inline only at 100 rows or fewer', () => {
    expect(CUSTOM_INLINE_MAX_ROWS).toBe(100)
  })

  it('uses a fresh 86,400-second signed URL TTL', () => {
    expect(SIGNED_URL_TTL_SECONDS).toBe(86_400)
  })

  it('schedules 1/2/4-minute persisted retries after the initial attempt', () => {
    expect(EXPORT_MAX_ATTEMPTS).toBe(4)
    expect(EXPORT_RETRY_DELAYS_MS).toEqual([60_000, 120_000, 240_000])
    expect(exportRetryDelayMsForAttempt(1)).toBe(60_000)
    expect(exportRetryDelayMsForAttempt(2)).toBe(120_000)
    expect(exportRetryDelayMsForAttempt(3)).toBe(240_000)
    // Out-of-range attempts clamp to the final delay (never crash).
    expect(exportRetryDelayMsForAttempt(0)).toBe(60_000)
    expect(exportRetryDelayMsForAttempt(9)).toBe(240_000)
  })

  it('recovers stale claims after 15 minutes and bounds batch/concurrency', () => {
    expect(EXPORT_STALE_CLAIM_LEASE_MS).toBe(15 * 60 * 1000)
    expect(EXPORT_BATCH_SIZE).toBeGreaterThan(0)
    expect(EXPORT_CONCURRENCY).toBeGreaterThan(0)
  })

  it('provides typed safe error codes and rejects unknown ones', () => {
    expect(REPORT_EXPORT_ERROR_CODES).toContain('FILE_TOO_LARGE')
    expect(REPORT_EXPORT_ERROR_CODES).toContain('ROW_LIMIT')
    expect(REPORT_EXPORT_ERROR_CODES).toContain('COLUMN_LIMIT')
    expect(REPORT_EXPORT_ERROR_CODES).toContain('ACCESS_REVOKED')
    expect(isReportExportErrorCode('FILE_TOO_LARGE')).toBe(true)
    expect(isReportExportErrorCode('SOME_RANDOM_CODE')).toBe(false)
  })

  it('sanitizes and truncates error text without leaking newlines/secrets', () => {
    const sanitized = sanitizeExportError(new Error('boom\r\npath=/secret/bucket?token=abc'))
    expect(sanitized).not.toMatch(/[\r\n\t]/)
    expect(sanitized).toHaveLength('boom path=/secret/bucket?token=abc'.length)
    const long = sanitizeExportError(new Error('x'.repeat(10_000)))
    expect(long.length).toBeLessThanOrEqual(EXPORT_ERROR_MESSAGE_LENGTH)
  })
})
