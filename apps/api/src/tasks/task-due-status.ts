/**
 * Pure task due-status module (Story 4.1).
 *
 * This module must stay free of `@nestjs/*` imports and Prisma imports so it
 * can be unit-tested in isolation. The tuples below are the single source of
 * truth for the task vocabulary: the Prisma enums (`enum TaskStatus`,
 * `enum TaskPriority` in schema.prisma), the Pothos enums in tasks.graphql.ts
 * and the frontend Zod schema in apps/web/src/lib/task-format.ts all mirror
 * them.
 *
 * All day arithmetic is UTC-midnight based so "Overdue" / "Due today" are
 * stable regardless of the server's local time and of the hour the page is
 * rendered.
 *
 * NOTE: toUtcMidnight duplicates the three-line UTC-midnight construction in
 * apps/api/src/deal-health/deal-health-score.ts (it is not exported from
 * there). Keep the two implementations in sync — hand-duplication with a
 * cross-reference comment is the established convention
 * (docs/project-context.md › "Consequence of the empty packages").
 *
 * Frontend twin: apps/web/src/lib/task-format.ts re-declares the same tuples,
 * toUtcMidnight and resolveDueStatus — the two implementations must agree
 * exactly (Story 3.7 finding F4 was a client/server day-math divergence).
 */

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

// Story 4.6 (AC 10): recurrence pattern vocabulary — mirrors the Prisma
// enum RecurrencePattern. CUSTOM is deferred (AC 89).
export const TASK_RECURRENCE_PATTERNS = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const
export type RecurrencePattern = (typeof TASK_RECURRENCE_PATTERNS)[number]

export function isRecurrencePattern(value: string): value is RecurrencePattern {
  return (TASK_RECURRENCE_PATTERNS as readonly string[]).includes(value)
}

export const TASK_DUE_STATUSES = [
  'NO_DUE_DATE',
  'OVERDUE',
  'DUE_TODAY',
  'UPCOMING',
  'DONE',
] as const
export type TaskDueStatus = (typeof TASK_DUE_STATUSES)[number]

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value)
}

export function isTaskPriority(value: string): value is TaskPriority {
  return (TASK_PRIORITIES as readonly string[]).includes(value)
}

/** Normalize any instant to the UTC midnight of its UTC calendar day. */
export function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

/** Whole UTC days from `from` to `to` (midnight-to-midnight, integer). */
export function daysBetweenUtc(from: Date, to: Date): number {
  const fromMidnight = toUtcMidnight(from).getTime()
  const toMidnight = toUtcMidnight(to).getTime()
  return Math.round((toMidnight - fromMidnight) / 86_400_000)
}

/**
 * Resolve the due-status badge for one task (AC 5).
 *
 * Precedence is exact: COMPLETED/CANCELLED → DONE (a cancelled task is never
 * "overdue"); null dueDate → NO_DUE_DATE; past → OVERDUE; same UTC day →
 * DUE_TODAY; otherwise UPCOMING.
 */
export function resolveDueStatus(
  input: { status: TaskStatus; dueDate: Date | null },
  now: Date,
): TaskDueStatus {
  if (input.status === 'COMPLETED' || input.status === 'CANCELLED') {
    return 'DONE'
  }
  if (input.dueDate === null) {
    return 'NO_DUE_DATE'
  }
  const dueDay = toUtcMidnight(input.dueDate).getTime()
  const today = toUtcMidnight(now).getTime()
  if (dueDay < today) {
    return 'OVERDUE'
  }
  if (dueDay === today) {
    return 'DUE_TODAY'
  }
  return 'UPCOMING'
}
