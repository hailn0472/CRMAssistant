import type { Prisma } from '@prisma/client'

// Story 4.4 (AC 5, 15): pure visibility helpers for the tenant-wide activity
// feed and the `onActivityLogged` subscription. Kept out of the *.graphql.ts
// files (which are excluded from unit coverage) so AC 15's rules are
// exercised by real tests, and out of the service so the subscribe-time
// resolution is separated from the per-event comparison.
//
// `Activity` has no ownerId — access derives from the parent Contact, so the
// predicate resolves against `contact.ownerId`, exactly like
// ActivityService.checkContactAccess.

export type VisibilityOwnerFilter = Prisma.ContactWhereInput['ownerId']

/**
 * True when the subscriber may see this activity event (AC 15):
 * - undefined (ADMIN / ALL / DATA:VIEW_ALL) → everything;
 * - string (OWN) → the contact's owner matches;
 * - `{ in: [...] }` (TEAM) → the contact's owner is in the team list.
 * In every non-undefined case a contact reachable through a sharing rule is
 * also visible — matching the read rule of findFeed (AC 5) exactly.
 */
export function filterActivityByVisibility(
  payload: { contactOwnerId: string | null; contactId: string },
  visibilityFilter: VisibilityOwnerFilter | undefined,
  sharedContactIds: string[],
): boolean {
  if (visibilityFilter === undefined) return true

  const ownerMatches =
    typeof visibilityFilter === 'string'
      ? payload.contactOwnerId === visibilityFilter
      : (visibilityFilter as { in: string[] }).in.includes(payload.contactOwnerId ?? '')

  return ownerMatches || sharedContactIds.includes(payload.contactId)
}

/**
 * Wraps a raw channel iterator with the in-memory visibility comparison.
 * `visibilityFilter` and `sharedContactIds` are resolved ONCE at subscribe
 * time by the caller — this iterator makes ZERO database reads per event
 * (AC 15).
 */
export async function* filterActivityFeedEvents<
  T extends { contactOwnerId: string | null; contactId: string },
>(
  source: AsyncIterable<T>,
  visibilityFilter: VisibilityOwnerFilter | undefined,
  sharedContactIds: string[],
): AsyncIterable<T> {
  for await (const event of source) {
    if (filterActivityByVisibility(event, visibilityFilter, sharedContactIds)) {
      yield event
    }
  }
}
