import type { CalendarBusySlot } from './calendar-provider.types'

/**
 * Pure, framework-free conflict detection (Story 4.3, AC 27). Extracted so it
 * is trivially unit-testable without mocks (the 4.1 pure-logic pattern).
 *
 * Before creating or moving a remote event the sync engine calls the
 * provider's `listBusy(window)` and feeds the slots here. If any existing
 * event overlaps the window and is not our own `externalEventId`, a conflict
 * is recorded — the sync STILL proceeds (a conflict is information, not a
 * block).
 */

export type ConflictResult = {
  conflict: boolean
  /** Human-readable, e.g. `Overlaps "Standup" (09:00–09:30)` (AC 27). */
  summary: string | null
}

/** Half-open interval overlap: touching boundaries do NOT count (adjacency is
 * not a conflict). */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime()
}

export function findCalendarConflict(
  busySlots: CalendarBusySlot[],
  windowStart: Date,
  windowEnd: Date,
  ownExternalEventId?: string | null,
): ConflictResult {
  for (const slot of busySlots) {
    // Our own event in the window is not a conflict (self-exclusion, AC 27).
    if (ownExternalEventId && slot.externalEventId === ownExternalEventId) continue
    if (overlaps(windowStart, windowEnd, slot.start, slot.end)) {
      const label = slot.title?.trim() ? `"${slot.title.trim()}"` : 'an existing event'
      return {
        conflict: true,
        summary: `Overlaps ${label} (${formatTime(slot.start)}–${formatTime(slot.end)})`,
      }
    }
  }
  return { conflict: false, summary: null }
}

function formatTime(date: Date): string {
  return date.toISOString().slice(11, 16)
}
