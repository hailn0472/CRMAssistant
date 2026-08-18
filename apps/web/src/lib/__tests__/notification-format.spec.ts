/**
 * Story 4.8 (AC 66, 81): unit tests for notification-format utilities.
 */

import {
  notificationHref,
  notificationTypeLabel,
  notificationTypeIconName,
  formatRelativeTime,
} from '../notification-format'

import type { Notification } from '@/services/notification.service'

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'notif-1',
    type: 'TASK_ASSIGNED',
    title: 'Test',
    body: null,
    dealId: null,
    taskId: null,
    readAt: null,
    createdAt: '2026-08-10T12:00:00.000Z',
    ...overrides,
  }
}

describe('notificationHref', () => {
  it('returns deal link when dealId is present', () => {
    expect(notificationHref(makeNotification({ dealId: 'deal-1' }))).toBe('/deals/deal-1')
  })

  it('returns task link when taskId is present', () => {
    expect(notificationHref(makeNotification({ taskId: 'task-1' }))).toBe('/tasks/task-1')
  })

  it('returns null when neither dealId nor taskId', () => {
    expect(notificationHref(makeNotification({ dealId: null, taskId: null }))).toBeNull()
  })

  it('prioritizes dealId over taskId when both are present', () => {
    expect(notificationHref(makeNotification({ dealId: 'deal-1', taskId: 'task-1' }))).toBe(
      '/deals/deal-1',
    )
  })

  it('returns download link when reportExportId is present and type is REPORT_EXPORT_READY', () => {
    expect(
      notificationHref(
        makeNotification({ reportExportId: 'export-123', type: 'REPORT_EXPORT_READY' }),
      ),
    ).toBe('/reports/exports?download=export-123')
  })

  it('returns export details link when reportExportId is present and type is REPORT_EXPORT_FAILED', () => {
    expect(
      notificationHref(
        makeNotification({ reportExportId: 'export-123', type: 'REPORT_EXPORT_FAILED' }),
      ),
    ).toBe('/reports/exports?exportId=export-123')
  })
})

describe('notificationTypeLabel', () => {
  it('maps TASK_ASSIGNED to "Task assigned"', () => {
    expect(notificationTypeLabel('TASK_ASSIGNED')).toBe('Task assigned')
  })

  it('maps DEAL_REMINDER to "Deal reminder"', () => {
    expect(notificationTypeLabel('DEAL_REMINDER')).toBe('Deal reminder')
  })

  it('maps DEAL_MENTION to "Mention"', () => {
    expect(notificationTypeLabel('DEAL_MENTION')).toBe('Mention')
  })

  it('maps REPORT_EXPORT_READY to "Report export ready"', () => {
    expect(notificationTypeLabel('REPORT_EXPORT_READY')).toBe('Report export ready')
  })

  it('maps REPORT_EXPORT_FAILED to "Report export failed"', () => {
    expect(notificationTypeLabel('REPORT_EXPORT_FAILED')).toBe('Report export failed')
  })

  it('falls back to the raw type for unknown values', () => {
    expect(notificationTypeLabel('UNKNOWN_TYPE')).toBe('UNKNOWN_TYPE')
  })
})

describe('notificationTypeIconName', () => {
  it('returns DollarSign for DEAL_REMINDER', () => {
    expect(notificationTypeIconName('DEAL_REMINDER')).toBe('DollarSign')
  })

  it('returns DollarSign for DEAL_MENTION', () => {
    expect(notificationTypeIconName('DEAL_MENTION')).toBe('DollarSign')
  })

  it('returns CheckSquare for TASK_ASSIGNED', () => {
    expect(notificationTypeIconName('TASK_ASSIGNED')).toBe('CheckSquare')
  })

  it('returns Download for REPORT_EXPORT_READY and REPORT_EXPORT_FAILED', () => {
    expect(notificationTypeIconName('REPORT_EXPORT_READY')).toBe('Download')
    expect(notificationTypeIconName('REPORT_EXPORT_FAILED')).toBe('Download')
  })

  it('returns Bell for unknown types', () => {
    expect(notificationTypeIconName('UNKNOWN_TYPE')).toBe('Bell')
  })
})

describe('formatRelativeTime', () => {
  it('returns empty string for invalid date', () => {
    expect(formatRelativeTime('not-a-date')).toBe('')
  })

  it('returns "Just now" for timestamps within 60 seconds', () => {
    const now = Date.now()
    const iso = new Date(now - 30 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('Just now')
  })

  it('returns minutes for timestamps within the hour', () => {
    const now = Date.now()
    const iso = new Date(now - 5 * 60 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('5m ago')
  })

  it('returns hours for timestamps within 24 hours', () => {
    const now = Date.now()
    const iso = new Date(now - 3 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('3h ago')
  })

  it('returns days for timestamps within a week', () => {
    const now = Date.now()
    const iso = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('2d ago')
  })

  it('returns locale date for timestamps older than a week', () => {
    const result = formatRelativeTime('2026-01-01T12:00:00.000Z')
    expect(result).toMatch(/Jan 1/)
  })
})
