import type { Prisma } from '@prisma/client'

// Story 4.4 (AC 15): pure visibility helper for the `onTaskChanged`
// subscription. TasksService.findOne treats `assignedTo` as the task
// visibility column, so the subscribe filter compares against it.
// Kept out of tasks.graphql.ts (excluded from unit coverage) so AC 15 is
// exercised by real tests.

export type VisibilityOwnerFilter = Prisma.ContactWhereInput['ownerId']

/**
 * True when the subscriber may see this task event:
 * - undefined (ADMIN / ALL / DATA:VIEW_ALL) → everything;
 * - string (OWN) → the task is assigned to the subscriber;
 * - `{ in: [...] }` (TEAM) → the task is assigned to a team member.
 */
export function filterTaskByVisibility(
  payload: { assignedTo: string },
  visibilityFilter: VisibilityOwnerFilter | undefined,
): boolean {
  if (visibilityFilter === undefined) return true
  if (typeof visibilityFilter === 'string') return payload.assignedTo === visibilityFilter
  return (visibilityFilter as { in: string[] }).in.includes(payload.assignedTo)
}

/**
 * Wraps a raw channel iterator with the in-memory visibility comparison.
 * `visibilityFilter` is resolved ONCE at subscribe time by the caller — this
 * iterator makes ZERO database reads per event (AC 15).
 */
export async function* filterTaskChangedEvents<T extends { assignedTo: string }>(
  source: AsyncIterable<T>,
  visibilityFilter: VisibilityOwnerFilter | undefined,
): AsyncIterable<T> {
  for await (const event of source) {
    if (filterTaskByVisibility(event, visibilityFilter)) {
      yield event
    }
  }
}
