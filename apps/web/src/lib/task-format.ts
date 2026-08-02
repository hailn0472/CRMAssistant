/**
 * Pure task formatting + due-status module (Story 4.1).
 * No React, no component imports — every derived string lives here so the
 * page-level components stay thin and the coverage gates are met by pure,
 * testable code.
 *
 * This is the FRONTEND TWIN of apps/api/src/tasks/task-due-status.ts: it
 * re-declares the same tuples, the same toUtcMidnight and the same
 * resolveDueStatus. The two implementations MUST agree exactly — Story 3.7
 * finding F4 was a client/server day-math divergence at the day boundary.
 * Keep both files in sync (docs/project-context.md › "Consequence of the
 * empty packages": hand-duplication with a cross-reference comment).
 *
 * day-boundary parity is enforced by tests: lib/__tests__/task-format.spec.ts
 * and apps/api/src/tasks/__tests__/task-due-status.spec.ts assert the same
 * cases with the same expected outputs.
 */

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

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

/**
 * Resolve the due-status badge for one task (AC 5).
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

/** Format an ISO date as a locale date string (or an em-dash for null). */
export function formatDueDate(iso: string | null): string {
  if (!iso) return '\u2014'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '\u2014'
  return date.toLocaleDateString()
}

/**
 * Maps a due-status to a badge class string. Every badge pairs colour with a
 * text label — ux-design-specification.md:1990 and NFR16 forbid colour-only
 * status (the label is rendered separately by the caller).
 */
export function taskDueBadgeClass(dueStatus: TaskDueStatus): string {
  switch (dueStatus) {
    case 'OVERDUE':
      return 'bg-red-50 text-red-700 border-red-200'
    case 'DUE_TODAY':
      return 'bg-amber-50 text-amber-700 border-amber-200'
    case 'UPCOMING':
      return 'bg-blue-50 text-blue-700 border-blue-200'
    case 'DONE':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200'
    default:
      return 'bg-slate-50 text-slate-600 border-slate-200'
  }
}

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
}

export const TASK_DUE_STATUS_LABELS: Record<TaskDueStatus, string> = {
  NO_DUE_DATE: 'No due date',
  OVERDUE: 'Overdue',
  DUE_TODAY: 'Due today',
  UPCOMING: 'Upcoming',
  DONE: 'Completed',
}

/** Maps a task status to a badge class string (colour + text label). */
export function taskStatusBadgeClass(status: TaskStatus): string {
  switch (status) {
    case 'TODO':
      return 'bg-slate-50 text-slate-600 border-slate-200'
    case 'IN_PROGRESS':
      return 'bg-blue-50 text-blue-700 border-blue-200'
    case 'COMPLETED':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200'
    default:
      return 'bg-red-50 text-red-700 border-red-200'
  }
}

/** Maps a task priority to a badge class string (colour + text label). */
export function taskPriorityBadgeClass(priority: TaskPriority): string {
  switch (priority) {
    case 'LOW':
      return 'bg-slate-50 text-slate-600 border-slate-200'
    case 'MEDIUM':
      return 'bg-blue-50 text-blue-700 border-blue-200'
    case 'HIGH':
      return 'bg-amber-50 text-amber-700 border-amber-200'
    default:
      return 'bg-red-50 text-red-700 border-red-200'
  }
}
