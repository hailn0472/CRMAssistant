import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { ContactDetailClient } from '../ContactDetailClient'
import type { Contact } from '@/services/contact.service'

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

  it('leaves the Overview and Conversations tabs intact (W16)', () => {
    renderClient()

    // Overview tab: contact info renders.
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ada@example.com' })).toBeInTheDocument()

    // Conversations tab: the ConversationList mock data is untouched.
    fireEvent.click(screen.getByRole('tab', { name: /conversations/i }))
    expect(screen.getByText('Báo giá CRM Enterprise')).toBeInTheDocument()
  })

  it('shows the Activity tab for a non-ADMIN user — tab visibility is not permission-gated (AC 61 / W17)', () => {
    // The component has no role gate: any authenticated user sees the tab.
    renderClient()

    fireEvent.click(screen.getByRole('tab', { name: /activity/i }))

    expect(screen.getByTestId('contact-timeline')).toBeInTheDocument()
  })
})
