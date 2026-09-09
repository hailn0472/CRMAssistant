import {
  formatRelativeTime,
  notificationHref,
  notificationTypeIconName,
  notificationTypeLabel,
} from '../notification-format'
import type { Notification } from '@/services/notification.service'

const notification = (overrides: Partial<Notification> = {}): Notification => ({
  id: 'notification-1',
  type: 'OTHER',
  title: 'A notification',
  body: null,
  taskId: null,
  reportExportId: null,
  readAt: null,
  createdAt: '2026-08-10T00:00:00.000Z',
  ...overrides,
})

describe('notificationHref', () => {
  it('prefers a task target when both task and export targets exist', () => {
    expect(
      notificationHref(
        notification({ taskId: 'task-7', reportExportId: 'export-9', type: 'REPORT_EXPORT_READY' }),
      ),
    ).toBe('/tasks/task-7')
  })

  it('links ready exports to the download action', () => {
    expect(
      notificationHref(notification({ reportExportId: 'export-9', type: 'REPORT_EXPORT_READY' })),
    ).toBe('/reports/exports?download=export-9')
  })

  it('links non-ready exports to the export details view', () => {
    expect(
      notificationHref(notification({ reportExportId: 'export-9', type: 'REPORT_EXPORT_FAILED' })),
    ).toBe('/reports/exports?exportId=export-9')
  })

  it('links at-risk activity goals to the activity report', () => {
    expect(notificationHref(notification({ type: 'ACTIVITY_GOAL_AT_RISK' }))).toBe(
      '/reports/activity',
    )
  })

  it('returns null when a notification has no navigable target', () => {
    expect(notificationHref(notification())).toBeNull()
  })
})

describe('notificationTypeLabel', () => {
  it.each([
    ['TASK_ASSIGNED', 'Task assigned'],
    ['REPORT_EXPORT_READY', 'Report export ready'],
    ['REPORT_EXPORT_FAILED', 'Report export failed'],
    ['ACTIVITY_GOAL_AT_RISK', 'Activity goal at risk'],
  ])('formats %s', (type, label) => {
    expect(notificationTypeLabel(type)).toBe(label)
  })

  it('preserves an unknown notification type as its fallback label', () => {
    expect(notificationTypeLabel('NEW_NOTIFICATION_TYPE')).toBe('NEW_NOTIFICATION_TYPE')
  })
})

describe('notificationTypeIconName', () => {
  it('maps task, export, and activity notifications to their icons', () => {
    expect(notificationTypeIconName('TASK_ASSIGNED')).toBe('CheckSquare')
    expect(notificationTypeIconName('REPORT_EXPORT_READY')).toBe('Download')
    expect(notificationTypeIconName('REPORT_EXPORT_FAILED')).toBe('Download')
    expect(notificationTypeIconName('ACTIVITY_GOAL_AT_RISK')).toBe('Target')
  })

  it('uses the bell icon for unknown types', () => {
    expect(notificationTypeIconName('UNKNOWN')).toBe('Bell')
  })
})

describe('formatRelativeTime', () => {
  const now = new Date('2026-08-10T12:00:00.000Z').getTime()

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(now)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns an empty string for an invalid timestamp', () => {
    expect(formatRelativeTime('not-a-date')).toBe('')
  })

  it.each([
    ['30 seconds ago', '2026-08-10T11:59:30.000Z', 'Just now'],
    ['two minutes ago', '2026-08-10T11:58:00.000Z', '2m ago'],
    ['two hours ago', '2026-08-10T10:00:00.000Z', '2h ago'],
    ['two days ago', '2026-08-08T12:00:00.000Z', '2d ago'],
  ])('%s', (_description, timestamp, expected) => {
    expect(formatRelativeTime(timestamp)).toBe(expected)
  })

  it('uses a short calendar date for timestamps at least one week old', () => {
    expect(formatRelativeTime('2026-08-01T12:00:00.000Z')).toMatch(/^Aug 1$/)
  })
})
