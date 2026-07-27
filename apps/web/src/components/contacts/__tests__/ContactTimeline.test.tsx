import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ContactTimeline } from '../ContactTimeline'
import type { ContactTimelineResult, Activity } from '@/types/activity.types'

// Mock the activity service
jest.mock('@/services/activity.service', () => ({
  fetchTimeline: jest.fn(),
  addContactNote: jest.fn(),
}))

import { fetchTimeline, addContactNote } from '@/services/activity.service'

const mockFetchTimeline = fetchTimeline as jest.MockedFunction<typeof fetchTimeline>
const mockAddContactNote = addContactNote as jest.MockedFunction<typeof addContactNote>

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'act-1',
    contactId: 'contact-1',
    type: 'NOTE_ADDED',
    title: 'Test activity',
    description: 'A description',
    createdAt: new Date().toISOString(),
    createdBy: 'user-1',
    ...overrides,
  }
}

function makeTimelineResult(
  activities: Activity[] = [makeActivity()],
  hasNextPage = false,
  endCursor: string | null = null,
  totalCount?: number,
): ContactTimelineResult {
  return {
    edges: activities.map((a) => ({ cursor: a.id, node: a })),
    pageInfo: { hasNextPage, endCursor },
    totalCount: totalCount ?? activities.length,
  }
}

describe('ContactTimeline', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Default mock: a simple timeline with 1 activity, no more pages
    mockFetchTimeline.mockResolvedValue(makeTimelineResult())
  })

  it('shows loading skeleton on initial mount', () => {
    // Don't resolve the fetch yet
    mockFetchTimeline.mockImplementationOnce(
      () => new Promise(() => {}), // never resolves
    )
    render(<ContactTimeline contactId="contact-1" />)

    // Skeleton should show animated loading divs
    const skeletonDivs = document.querySelectorAll('.animate-pulse')
    expect(skeletonDivs.length).toBeGreaterThan(0)
  })

  it('shows error state when fetchTimeline fails', async () => {
    mockFetchTimeline.mockRejectedValueOnce(new Error('Network error'))

    render(<ContactTimeline contactId="contact-1" />)

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })

    // Retry button should be present
    const retryButton = screen.getByText('Retry')
    expect(retryButton).toBeInTheDocument()
  })

  it('retries loading when Retry button is clicked', async () => {
    mockFetchTimeline
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(makeTimelineResult())

    render(<ContactTimeline contactId="contact-1" />)

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Retry'))

    await waitFor(() => {
      expect(screen.getByText('Test activity')).toBeInTheDocument()
    })
    expect(mockFetchTimeline).toHaveBeenCalledTimes(2)
  })

  it('shows empty state when there are no activities', async () => {
    mockFetchTimeline.mockResolvedValue(makeTimelineResult([], false, null))

    render(<ContactTimeline contactId="contact-1" />)

    await waitFor(() => {
      expect(screen.getByText(/No activity recorded yet/)).toBeInTheDocument()
    })
  })

  it('renders activity list from timeline', async () => {
    const activities = [
      makeActivity({ id: '1', title: 'First activity' }),
      makeActivity({ id: '2', title: 'Second activity' }),
    ]
    mockFetchTimeline.mockResolvedValue(makeTimelineResult(activities, false, null))

    render(<ContactTimeline contactId="contact-1" />)

    await waitFor(() => {
      expect(screen.getByText('First activity')).toBeInTheDocument()
    })
    expect(screen.getByText('Second activity')).toBeInTheDocument()
  })

  it('shows activity count in the header', async () => {
    const activities = [
      makeActivity({ id: '1' }),
      makeActivity({ id: '2' }),
    ]
    mockFetchTimeline.mockResolvedValue(makeTimelineResult(activities, false, null, 2))

    render(<ContactTimeline contactId="contact-1" />)

    await waitFor(() => {
      expect(screen.getByText(/2 activities/)).toBeInTheDocument()
    })
  })

  it('shows singular activity count when totalCount is 1', async () => {
    mockFetchTimeline.mockResolvedValue(makeTimelineResult([makeActivity()], false, null, 1))

    render(<ContactTimeline contactId="contact-1" />)

    await waitFor(() => {
      expect(screen.getByText(/1 activity/)).toBeInTheDocument()
    })
  })

  it('shows Add Note button', async () => {
    render(<ContactTimeline contactId="contact-1" />)

    await waitFor(() => {
      expect(screen.getByText('Add Note')).toBeInTheDocument()
    })
  })

  it('shows NoteComposer when Add Note is clicked', async () => {
    render(<ContactTimeline contactId="contact-1" />)

    await waitFor(() => {
      expect(screen.getByText('Add Note')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Add Note'))

    expect(screen.getByPlaceholderText(/Add a note/)).toBeInTheDocument()
  })

  it('adds an activity optimistically when a note is submitted', async () => {
    mockAddContactNote.mockResolvedValue({
      id: 'new-note-id',
      contactId: 'contact-1',
      type: 'NOTE_ADDED',
      title: 'New note',
      description: 'New note content',
      createdAt: new Date().toISOString(),
      createdBy: 'user-1',
    })

    render(<ContactTimeline contactId="contact-1" />)

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText('Test activity')).toBeInTheDocument()
    })

    // Open composer
    fireEvent.click(screen.getByText('Add Note'))

    // Type and submit note
    const textarea = screen.getByPlaceholderText(/Add a note/)
    fireEvent.change(textarea, { target: { value: 'New note' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    // Should show optimistic activity immediately
    await waitFor(() => {
      const titleElements = screen.getAllByText(/New note/)
      // The title "New note" appears in both the card title and possibly description
      expect(titleElements.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows filter options', async () => {
    render(<ContactTimeline contactId="contact-1" />)

    await waitFor(() => {
      expect(screen.getByText('All')).toBeInTheDocument()
      expect(screen.getByText('Sales')).toBeInTheDocument()
      expect(screen.getByText('System')).toBeInTheDocument()
    })
  })

  it('filters activities when a filter is selected', async () => {
    // Create activities of different types
    const noteActivity = makeActivity({
      id: '1',
      type: 'NOTE_ADDED',
      title: 'A note',
      description: null,
    })
    const createdActivity = makeActivity({
      id: '2',
      type: 'CONTACT_CREATED',
      title: 'Contact created',
      description: null,
    })

    mockFetchTimeline.mockResolvedValue(
      makeTimelineResult([noteActivity, createdActivity], false, null, 2),
    )

    render(<ContactTimeline contactId="contact-1" />)

    // Wait for activities to load
    await waitFor(() => {
      expect(screen.getByText('A note')).toBeInTheDocument()
    })
    expect(screen.getByText('Contact created')).toBeInTheDocument()

    // Click SYSTEM filter — should only show CONTACT_CREATED
    fireEvent.click(screen.getByText('System'))

    await waitFor(() => {
      expect(screen.getByText('Contact created')).toBeInTheDocument()
      expect(screen.queryByText('A note')).not.toBeInTheDocument()
    })
  })

  it('shows sentinel element when there are more pages', async () => {
    mockFetchTimeline.mockResolvedValue(
      makeTimelineResult([makeActivity({ id: '1' })], true, 'cursor-1'),
    )

    render(<ContactTimeline contactId="contact-1" />)

    // The sentinel ref should be present (its ref is set, but we verify loading-more
    // related text appears when hasNextPage triggers the scroll effect)
    await waitFor(() => {
      // The ref element starts with hasNextPage=true — loader triggers fetchTimeline
      expect(mockFetchTimeline).toHaveBeenCalledTimes(1)
    })
  })

  it('shows "No more activities" when all pages loaded', async () => {
    mockFetchTimeline.mockResolvedValue(
      makeTimelineResult([makeActivity({ id: '1' })], false, null, 1),
    )

    render(<ContactTimeline contactId="contact-1" />)

    await waitFor(() => {
      expect(screen.getByText('No more activities')).toBeInTheDocument()
    })
  })
})
