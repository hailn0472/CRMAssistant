import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { ActivityTimelineView } from '../ActivityTimelineView'
import { emptyActivityFilters } from '../ActivityFilterBar'
import { utcDayKey } from '@/lib/calendar-grid'
import type { ActivityFeedItem } from '@/types/activity.types'

const mockUsePermission = jest.fn()
jest.mock('@/hooks/usePermission', () => ({
  usePermission: (resource: string, action: string) => mockUsePermission(resource, action),
}))

jest.mock('@/services/activity.service', () => ({
  fetchActivityFeed: jest.fn(),
}))

import { fetchActivityFeed } from '@/services/activity.service'

function makeActivity(overrides: Partial<ActivityFeedItem> = {}): ActivityFeedItem {
  return {
    id: 'act-1',
    contactId: 'contact-1',
    type: 'NOTE_ADDED',
    title: 'A note',
    description: null,
    createdAt: new Date().toISOString(),
    createdBy: 'user-1',
    source: null,
    sourceId: null,
    contact: { id: 'contact-1', firstName: 'Alice', lastName: 'One' },
    ...overrides,
  }
}

// Days relative to today so the default expansion (today + yesterday) holds
// regardless of the wall-clock date the suite runs on.
function dayKey(offsetDays: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - offsetDays)
  return utcDayKey(d)
}

function page(
  items: ActivityFeedItem[],
  total: number,
): { items: ActivityFeedItem[]; total: number; page: number; pageSize: number } {
  return { items, total, page: 1, pageSize: 20 }
}

function renderTimeline(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ActivityTimelineView filters={emptyActivityFilters} />
    </QueryClientProvider>,
  )
}

describe('ActivityTimelineView (Story 4.4, AC 34)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUsePermission.mockImplementation(() => true)
    ;(fetchActivityFeed as jest.Mock).mockResolvedValue(page([], 0))
  })

  it('groups activities by day and expands today + yesterday by default, collapsing older days (AC 34)', async () => {
    const todayItem = makeActivity({ id: 'a-today', title: 'Today note' })
    const yesterdayItem = makeActivity({
      id: 'a-yesterday',
      title: 'Yesterday note',
      createdAt: `${dayKey(1)}T12:00:00.000Z`,
    })
    const olderItem = makeActivity({
      id: 'a-older',
      title: 'Older note',
      createdAt: `${dayKey(3)}T12:00:00.000Z`,
    })
    ;(fetchActivityFeed as jest.Mock).mockResolvedValue(
      page([todayItem, yesterdayItem, olderItem], 3),
    )
    renderTimeline()

    // Today + yesterday expanded: their rows are visible.
    expect(await screen.findByText('Today note')).toBeInTheDocument()
    expect(screen.getByText('Yesterday note')).toBeInTheDocument()
    // Older day collapsed: its row is hidden until expanded.
    expect(screen.queryByText('Older note')).not.toBeInTheDocument()

    const dayButtons = screen.getAllByRole('button')
    // The older-day section is collapsed (aria-expanded false).
    expect(dayButtons[2]).toHaveAttribute('aria-expanded', 'false')
  })

  it('expands and collapses day sections via the keyboard-operable button (AC 34)', async () => {
    const olderItem = makeActivity({
      id: 'a-older',
      title: 'Older note',
      createdAt: `${dayKey(3)}T12:00:00.000Z`,
    })
    ;(fetchActivityFeed as jest.Mock).mockResolvedValue(page([olderItem], 1))
    renderTimeline()

    const olderButton = await screen.findAllByRole('button')
    const collapsed = olderButton.find((b) => b.getAttribute('aria-expanded') === 'false')!
    fireEvent.click(collapsed)

    expect(await screen.findByText('Older note')).toBeInTheDocument()
    expect(collapsed).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(collapsed)
    expect(screen.queryByText('Older note')).not.toBeInTheDocument()
    expect(collapsed).toHaveAttribute('aria-expanded', 'false')
  })

  it('appends the next page on infinite scroll (AC 34)', async () => {
    const firstPage = Array.from({ length: 20 }, (_, i) =>
      makeActivity({
        id: `a-${i}`,
        title: `Activity ${i}`,
        createdAt: `${dayKey(1)}T10:00:00.000Z`,
      }),
    )
    const secondPage = [
      makeActivity({
        id: 'a-20',
        title: 'Older activity',
        // Yesterday is expanded by default — a 2-day-old row would land in a
        // collapsed section and stay invisible.
        createdAt: `${dayKey(1)}T18:00:00.000Z`,
      }),
    ]
    ;(fetchActivityFeed as jest.Mock)
      .mockResolvedValueOnce(page(firstPage, 21))
      .mockResolvedValueOnce(page(secondPage, 21))

    // Drive the IntersectionObserver: fire the callback on EVERY observe.
    // Next.js's own <Link> prefetch hooks also construct observers, so a
    // "fire once" flag would be consumed by them before the component's
    // observer ever observes. The page loop terminates naturally — page 2's
    // result has total 21 → page * pageSize ≥ total → hasMore=false.
    let observerCallback: IntersectionObserverCallback | null = null
    class MockIO implements IntersectionObserver {
      readonly root = null
      readonly rootMargin = ''
      readonly thresholds = [0.1]
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback
      }
      observe(): void {
        observerCallback?.(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        )
      }
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return []
      }
    }
    const originalIO = global.IntersectionObserver
    global.IntersectionObserver = MockIO as unknown as typeof IntersectionObserver

    try {
      renderTimeline()

      await screen.findByText('Activity 0')
      await waitFor(() => {
        expect(fetchActivityFeed).toHaveBeenCalledWith(expect.anything(), 2, 20)
      })
      expect(await screen.findByText('Older activity')).toBeInTheDocument()
    } finally {
      global.IntersectionObserver = originalIO
    }
  })

  it('links TASK-sourced cards to /tasks/:sourceId and DEAL-sourced to /deals/:sourceId (AC 34)', async () => {
    const taskItem = makeActivity({
      id: 'a-task',
      title: 'Task completed',
      source: 'TASK',
      sourceId: 'task-42',
      createdAt: new Date().toISOString(),
    })
    const dealItem = makeActivity({
      id: 'a-deal',
      title: 'Deal stage changed',
      source: 'DEAL',
      sourceId: 'deal-7',
      createdAt: `${dayKey(1)}T10:00:00.000Z`,
    })
    const contactItem = makeActivity({
      id: 'a-contact',
      title: 'Manual note',
      source: null,
      sourceId: null,
      // Today — the older-day section is collapsed by default, and the
      // assertion targets the rendered link, so keep the row visible.
      createdAt: new Date().toISOString(),
    })
    ;(fetchActivityFeed as jest.Mock).mockResolvedValue(page([taskItem, dealItem, contactItem], 3))
    const { container } = render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ActivityTimelineView filters={emptyActivityFilters} />
      </QueryClientProvider>,
    )

    await screen.findByText('Task completed')
    expect(container.querySelector('a[href="/tasks/task-42"]')).not.toBeNull()
    expect(container.querySelector('a[href="/deals/deal-7"]')).not.toBeNull()
    expect(container.querySelector('a[href="/contacts/contact-1"]')).not.toBeNull()
  })

  it('shows PermissionLimitedState without CONTACT:READ (AC 13/34)', () => {
    mockUsePermission.mockImplementation((resource: string) => resource !== 'CONTACT')
    renderTimeline()

    expect(
      screen.getByText('You do not have permission to view the activity feed.'),
    ).toBeInTheDocument()
  })
})
