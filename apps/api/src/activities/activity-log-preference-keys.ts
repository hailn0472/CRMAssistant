/**
 * Fixed vocabulary for UserActivityLogPreference boolean columns (Story 4.2,
 * extended in Story 4.3 with `logMeetingScheduled` — AC 8).
 * The single source of truth for the Prisma columns, the Pothos input fields
 * and the tests — the 4.1 const-tuple pattern (task-due-status.ts).
 */
export const ACTIVITY_LOG_PREFERENCE_KEYS = [
  'logTaskCompleted',
  'logMessageSent',
  'logMessageReceived',
  'logMeetingScheduled',
] as const

export type ActivityLogPreferenceKey = (typeof ACTIVITY_LOG_PREFERENCE_KEYS)[number]

export const DEFAULT_ACTIVITY_LOG_PREFERENCES: Record<ActivityLogPreferenceKey, boolean> = {
  logTaskCompleted: true,
  logMessageSent: true,
  logMessageReceived: true,
  logMeetingScheduled: true,
}
