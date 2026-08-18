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
  'DEAL_REMINDER',
  'DEAL_MENTION',
  // Story 6.5 (AC 15): terminal schedule delivery failure — emitted once per
  // execution with dedupe key `report-schedule-failed:<executionId>`.
  'REPORT_SCHEDULE_FAILED',
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
  dealId?: string | null
  taskId?: string | null
}): { target: 'DEAL' | 'TASK' | 'NONE'; id: string | null } {
  if (input.dealId && input.taskId) {
    throw new Error('A notification may reference at most one of dealId or taskId')
  }
  if (input.dealId) {
    return { target: 'DEAL', id: input.dealId }
  }
  if (input.taskId) {
    return { target: 'TASK', id: input.taskId }
  }
  return { target: 'NONE', id: null }
}

/**
 * Deals service REASON_LABELS mirror for producer P2 (AC 28).
 * Maps DealReminder.reason to a human-readable notification title.
 */
export const DEAL_REMINDER_REASON_LABELS: Record<string, string> = {
  NO_ACTIVITY_7D: 'No activity for 7 days',
  CLOSING_SOON_3D: 'Closing soon',
  AT_RISK: 'Deal at risk',
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
