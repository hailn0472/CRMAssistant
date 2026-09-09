/**
 * Pure notification-types module (Story 4.8).
 *
 * This module must stay free of `@nestjs/*` imports and Prisma imports so it
 * can be unit-tested in isolation. The const tuple below is the single source
 * of truth for the notification type vocabulary: the Pothos enum in
 * notifications.graphql.ts mirrors it.
 *
 * Every future producer adds a member; a Prisma enum would make each one a
 * migration, so the `Notification.type` column is a String validated here
 * before every insert.
 */

export const NOTIFICATION_TYPES = [
  'TASK_ASSIGNED',
  // Story 6.5 (AC 15): terminal schedule delivery failure — emitted once per
  // execution with dedupe key `report-schedule-failed:<executionId>`.
  'REPORT_SCHEDULE_FAILED',
  // Story 6.6 (AC 9): user-triggered export ready/failed — emitted once per
  // export with dedupe keys `report-export-ready:<exportId>` /
  // `report-export-failed:<exportId>`. The notification carries only the
  // export row id (never a signed URL/object path); the frontend mints a
  // fresh signed URL on owner download.
  'REPORT_EXPORT_READY',
  'REPORT_EXPORT_FAILED',
  // Story 6.8 (AC 15): activity-goal alert — emitted at most once per
  // goal/period by ActivityGoalProcessor with dedupe key
  // `activity-goal-at-risk:<goalId>:<periodStart YYYY-MM-DD>`. target NONE:
  // the goalId only appears in title/body text, never as a Notification FK.
  'ACTIVITY_GOAL_AT_RISK',
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export const MAX_NOTIFICATION_TITLE_LENGTH = 200
export const MAX_NOTIFICATION_BODY_LENGTH = 1000

export function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value)
}

export function assertValidNotificationType(value: string): void {
  if (!isNotificationType(value)) {
    throw new Error(
      `Invalid notification type: ${value}. Expected one of: ${NOTIFICATION_TYPES.join(', ')}`,
    )
  }
}

export function resolveNotificationTarget(input: {
  taskId?: string | null
  reportExportId?: string | null
}): { target: 'TASK' | 'REPORT_EXPORT' | 'NONE'; id: string | null } {
  const targets = [input.taskId, input.reportExportId].filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  )
  if (targets.length > 1) {
    throw new Error('A notification may reference at most one of taskId or reportExportId')
  }
  if (input.taskId) {
    return { target: 'TASK', id: input.taskId }
  }
  if (input.reportExportId) {
    return { target: 'REPORT_EXPORT', id: input.reportExportId }
  }
  return { target: 'NONE', id: null }
}

/**
 * Normalise helpers — trim and truncate, never throw (AC 12).
 */
export function normalizeNotificationTitle(title: string): string {
  return title.trim().substring(0, MAX_NOTIFICATION_TITLE_LENGTH)
}

export function normalizeNotificationBody(body: string | null | undefined): string | null {
  if (!body) return null
  const trimmed = body.trim()
  if (!trimmed) return null
  return trimmed.substring(0, MAX_NOTIFICATION_BODY_LENGTH)
}
