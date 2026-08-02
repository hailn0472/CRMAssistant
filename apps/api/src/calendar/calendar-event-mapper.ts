import type { CalendarEventPayload } from './calendar-provider.types'

/**
 * Pure task ↔ calendar-event mapping (Story 4.3, AC 22).
 *
 * - Event window: starts at `dueDate`, duration 30 minutes (`Task` has no
 *   duration/end column — adding one belongs to Story 4.1's model).
 * - All times cross as UTC ISO-8601 (`dateTime` + `timeZone: 'UTC'`) — there
 *   is no `User.timezone` column in this schema (AC 22 arbitration).
 * - Payload: `summary` = task title; `description` = task description.
 *   No `location` (arbitration table — `Task` has no location column).
 */

export const CALENDAR_EVENT_DURATION_MINUTES = 30

export type CalendarTaskLike = {
  title: string
  description: string | null
  dueDate: Date | null
}

export function mapTaskToCalendarEvent(task: CalendarTaskLike): CalendarEventPayload {
  if (!task.dueDate) {
    throw new Error('Cannot map a task without a dueDate to a calendar event')
  }
  return {
    summary: task.title,
    description: task.description ?? null,
    start: task.dueDate,
    end: new Date(task.dueDate.getTime() + CALENDAR_EVENT_DURATION_MINUTES * 60 * 1000),
  }
}
