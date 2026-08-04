import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { ContactDetailClient } from '../ContactDetailClient'
import { getConversations } from '@/services/inbox.service'
import type { Contact } from '@/services/contact.service'

const mockPush = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

jest.mock('@/services/contact.service', () => ({
  updateContact: jest.fn().mockResolvedValue({}),
}))

jest.mock('@/services/tag.service', () => ({
  addTagToContact: jest.fn().mockResolvedValue({}),
  removeTagFromContact: jest.fn().mockResolvedValue({}),
}))

jest.mock('@/services/owner.service', () => ({
  assignContactOwner: jest.fn().mockResolvedValue({}),
}))

jest.mock('@/services/inbox.service', () => ({
  getConversations: jest.fn(),
}))

// The real ContactTimeline is fully tested in its own spec; here we only need
// to prove ContactDetailClient mounts it in the Activity tab with the right
// contactId (AC 49).
jest.mock('@/components/contacts/ContactTimeline', () => ({
  ContactTimeline: ({ contactId }: { contactId: string }) => (
    <div data-testid="contact-timeline">{contactId}</div>
  ),
}))

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'contact-1',
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: '555-0100',
    company: 'Analytical Engines',
    jobTitle: 'Mathematician',
    linkedin: null,
    twitter: null,
    addressStreet: null,
    addressCity: null,
    addressCountry: null,
    department: null,
    timezone: null,
    language: null,
    source: null,
    notes: null,
    ownerId: 'user-1',
    owner: { id: 'user-1', firstName: 'Test', lastName: 'User', email: 'user@example.com' },
    teamId: null,
    tags: [],
    createdAt: '2026-01-15T00:00:00.000Z',
    updatedAt: '2026-01-15T00:00:00.000Z',
    ...overrides,
  }
}

describe('ContactDetailClient', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getConversations as jest.Mock).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })
  })

  function renderClient(contact: Contact = makeContact()): ReturnType<typeof render> {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={queryClient}>
        <ContactDetailClient contact={contact} />
      </QueryClientProvider>,
    )
  }

  it('renders ContactTimeline in the Activity tab with the contact id (AC 49 / W12)', () => {
    renderClient()

    expect(screen.queryByTestId('contact-timeline')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /activity/i }))

    const timeline = screen.getByTestId('contact-timeline')
    expect(timeline).toBeInTheDocument()
    expect(timeline.textContent).toBe('contact-1')
  })

  it('no longer renders the hardcoded mock activities or the read-only footer (AC 49 / W13, W14)', () => {
    renderClient()

    fireEvent.click(screen.getByRole('tab', { name: /activity/i }))

    expect(screen.queryByText('New conversation via Facebook')).not.toBeInTheDocument()
    expect(screen.queryByText('Activity log is read-only in this view')).not.toBeInTheDocument()
  })

  it('removed the hardcoded badge 6 from the Activity tab (AC 49 / W15)', () => {
    renderClient()

    fireEvent.click(screen.getByRole('tab', { name: /activity/i }))

    expect(screen.queryByText('6')).not.toBeInTheDocument()
  })

  it('leaves the Overview tab intact and fetches real conversations for the Conversations tab', async () => {
    ;(getConversations as jest.Mock).mockResolvedValue({
      items: [
        {
          id: 'conv-1',
          channel: 'FACEBOOK',
          status: 'OPEN',
          lastMessageAt: '2026-01-20T10:00:00.000Z',
          lastMessagePreview: 'Hi there',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    renderClient()

    // Overview tab: contact info renders.
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ada@example.com' })).toBeInTheDocument()

    // Conversations tab: real data from getConversations({contactId}), not
    // the old hardcoded mock array.
    fireEvent.click(screen.getByRole('tab', { name: /conversations/i }))

    await waitFor(() => {
      expect(getConversations).toHaveBeenCalledWith(
        { page: 1, pageSize: 20 },
        { contactId: 'contact-1' },
      )
    })
    expect(await screen.findByText('Facebook conversation')).toBeInTheDocument()
  })

  it('shows the real conversation count as the Conversations tab badge instead of a hardcoded 3', async () => {
    ;(getConversations as jest.Mock).mockResolvedValue({
      items: [
        { id: 'c1', channel: 'FACEBOOK', status: 'OPEN', lastMessageAt: null },
        { id: 'c2', channel: 'FACEBOOK', status: 'RESOLVED', lastMessageAt: null },
      ],
      total: 2,
      page: 1,
      pageSize: 20,
    })
    renderClient()

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /conversations/i })).toHaveTextContent('2')
    })
  })

  it('navigates to the real inbox when opening a conversation row', async () => {
    ;(getConversations as jest.Mock).mockResolvedValue({
      items: [{ id: 'conv-1', channel: 'FACEBOOK', status: 'OPEN', lastMessageAt: null }],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    renderClient()

    fireEvent.click(screen.getByRole('tab', { name: /conversations/i }))
    fireEvent.click(await screen.findByText('Facebook conversation'))

    expect(mockPush).toHaveBeenCalledWith('/inbox')
  })

  it('shows the Activity tab for a non-ADMIN user — tab visibility is not permission-gated (AC 61 / W17)', () => {
    // The component has no role gate: any authenticated user sees the tab.
    renderClient()

    fireEvent.click(screen.getByRole('tab', { name: /activity/i }))

    expect(screen.getByTestId('contact-timeline')).toBeInTheDocument()
  })
})
