import { filterActivityByVisibility, filterActivityFeedEvents } from '../activity-feed-visibility'
import {
  filterTaskByVisibility,
  filterTaskChangedEvents,
} from '../../tasks/task-subscription-visibility'

// Story 4.4, AC 15 / AC 43 — subscription visibility filters. The filter
// logic lives in pure modules (the *.graphql.ts subscribe wrappers are
// excluded from unit coverage), so the OWN/TEAM/ALL rules and the
// zero-database-reads-per-event property are exercised here directly.
describe('subscription visibility (Story 4.4, AC 15)', () => {
  describe('filterActivityByVisibility() — onActivityLogged', () => {
    const payload = { contactOwnerId: 'owner-1', contactId: 'contact-1' }

    it('OWN subscriber receives only payloads whose contact owner matches', () => {
      expect(filterActivityByVisibility(payload, 'owner-1', [])).toBe(true)
      expect(
        filterActivityByVisibility({ ...payload, contactOwnerId: 'owner-2' }, 'owner-1', []),
      ).toBe(false)
    })

    it('a shared-contact activity reaches a user with no ownership (sharing-rule positive)', () => {
      expect(
        filterActivityByVisibility(
          { contactOwnerId: 'owner-2', contactId: 'contact-shared' },
          'owner-1',
          ['contact-shared'],
        ),
      ).toBe(true)
    })

    it('TEAM subscriber receives the team list and shared contacts', () => {
      expect(filterActivityByVisibility(payload, { in: ['owner-1', 'owner-3'] }, [])).toBe(true)
      expect(filterActivityByVisibility(payload, { in: ['owner-3'] }, [])).toBe(false)
      expect(
        filterActivityByVisibility(
          { contactOwnerId: 'owner-9', contactId: 'contact-x' },
          { in: ['owner-1'] },
          ['contact-x'],
        ),
      ).toBe(true)
    })

    it('ALL/ADMIN subscriber receives everything', () => {
      expect(filterActivityByVisibility(payload, undefined, [])).toBe(true)
      expect(
        filterActivityByVisibility({ contactOwnerId: 'anyone', contactId: 'any' }, undefined, []),
      ).toBe(true)
    })
  })

  describe('filterTaskByVisibility() — onTaskChanged', () => {
    it('OWN subscriber receives only payloads whose assignedTo matches', () => {
      expect(filterTaskByVisibility({ assignedTo: 'user-1' }, 'user-1')).toBe(true)
      expect(filterTaskByVisibility({ assignedTo: 'user-2' }, 'user-1')).toBe(false)
    })

    it('TEAM subscriber receives the team list', () => {
      expect(filterTaskByVisibility({ assignedTo: 'user-2' }, { in: ['user-1', 'user-2'] })).toBe(
        true,
      )
      expect(filterTaskByVisibility({ assignedTo: 'user-3' }, { in: ['user-1', 'user-2'] })).toBe(
        false,
      )
    })

    it('ALL/ADMIN subscriber receives everything', () => {
      expect(filterTaskByVisibility({ assignedTo: 'anyone' }, undefined)).toBe(true)
    })
  })

  describe('event iterators — zero database reads per event', () => {
    async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
      const out: T[] = []
      for await (const item of source) out.push(item)
      return out
    }

    async function* sourceOf<T>(items: T[]): AsyncIterable<T> {
      for (const item of items) yield item
    }

    it('filterActivityFeedEvents yields only visible events without any DB access', async () => {
      const events = [
        { contactOwnerId: 'owner-1', contactId: 'c1' },
        { contactOwnerId: 'owner-2', contactId: 'c2' },
        { contactOwnerId: 'owner-2', contactId: 'c3-shared' },
      ]

      const visible = await collect(
        filterActivityFeedEvents(sourceOf(events), 'owner-1', ['c3-shared']),
      )

      expect(visible).toEqual([
        { contactOwnerId: 'owner-1', contactId: 'c1' },
        { contactOwnerId: 'owner-2', contactId: 'c3-shared' },
      ])
      // No prisma / DB mock is even involved — the iterator is pure in-memory
      // filtering, which is the AC 15 "zero database reads per event" property.
    })

    it('filterTaskChangedEvents yields only visible task events', async () => {
      const events = [{ assignedTo: 'user-1' }, { assignedTo: 'user-2' }]

      const visible = await collect(filterTaskChangedEvents(sourceOf(events), 'user-1'))

      expect(visible).toEqual([{ assignedTo: 'user-1' }])
    })

    it('an ADMIN/ALL iterator yields every event unchanged', async () => {
      const events = [{ assignedTo: 'user-1' }, { assignedTo: 'user-2' }]

      const visible = await collect(filterTaskChangedEvents(sourceOf(events), undefined))

      expect(visible).toEqual(events)
    })
  })
})
