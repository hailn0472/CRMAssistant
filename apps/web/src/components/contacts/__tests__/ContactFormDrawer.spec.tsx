import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { ContactFormDrawer } from '../ContactFormDrawer'
import { createContact, updateContact } from '@/services/contact.service'
import type { Contact } from '@/services/contact.service'

const push = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: jest.fn() }),
}))

jest.mock('@/services/contact.service', () => ({
  createContact: jest.fn(),
  updateContact: jest.fn(),
}))

jest.mock('@/services/tag.service', () => ({
  getTags: jest.fn().mockResolvedValue([]),
  addTagToContact: jest.fn(),
  removeTagFromContact: jest.fn(),
}))

jest.mock('@/services/owner.service', () => ({
  searchUsers: jest.fn().mockResolvedValue([]),
}))

function renderDrawer(props: Partial<React.ComponentProps<typeof ContactFormDrawer>> = {}): {
  onOpenChange: jest.Mock
} {
  const onOpenChange = jest.fn()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ContactFormDrawer open onOpenChange={onOpenChange} {...props} />
    </QueryClientProvider>,
  )
  return { onOpenChange }
}

describe('ContactFormDrawer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders nothing when closed', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <ContactFormDrawer open={false} onOpenChange={jest.fn()} />
      </QueryClientProvider>,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the panel with the form when open', () => {
    renderDrawer()

    expect(screen.getByRole('dialog', { name: 'New contact' })).toBeInTheDocument()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
  })

  it('closes on the close button', async () => {
    const user = userEvent.setup()
    const { onOpenChange } = renderDrawer()

    await user.click(screen.getByRole('button', { name: 'Close panel' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('closes on the backdrop', async () => {
    const user = userEvent.setup()
    const { onOpenChange } = renderDrawer()

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    const { onOpenChange } = renderDrawer()

    await user.keyboard('{Escape}')

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('navigates to the saved contact and closes after a successful save', async () => {
    const user = userEvent.setup()
    ;(createContact as jest.Mock).mockResolvedValue({ id: 'contact-9' })
    const { onOpenChange } = renderDrawer()

    await user.type(screen.getByLabelText(/email/i), 'ada@example.com')
    await user.type(screen.getByLabelText(/first name/i), 'Ada')
    await user.type(screen.getByLabelText(/last name/i), 'Lovelace')
    await user.click(screen.getByRole('button', { name: /save contact/i }))

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/contacts/contact-9')
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('hands the saved contact to onSaved instead of navigating', async () => {
    const user = userEvent.setup()
    ;(createContact as jest.Mock).mockResolvedValue({ id: 'contact-9' })
    const onSaved = jest.fn()
    renderDrawer({ onSaved })

    await user.type(screen.getByLabelText(/email/i), 'ada@example.com')
    await user.type(screen.getByLabelText(/first name/i), 'Ada')
    await user.type(screen.getByLabelText(/last name/i), 'Lovelace')
    await user.click(screen.getByRole('button', { name: /save contact/i }))

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({ id: 'contact-9' })
    })
    expect(push).not.toHaveBeenCalled()
  })

  const existingContact: Contact = {
    id: 'contact-1',
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: null,
    company: null,
    jobTitle: null,
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
    owner: null,
    teamId: null,
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  }

  it('shows an Edit contact title with the contact name and email when given a contact', () => {
    renderDrawer({ contact: existingContact })

    expect(screen.getByRole('dialog', { name: 'Edit contact' })).toBeInTheDocument()
    expect(screen.getByText('Ada Lovelace · ada@example.com')).toBeInTheDocument()
    expect(screen.getByLabelText(/first name/i)).toHaveValue('Ada')
  })

  it('updates the existing contact instead of creating a new one', async () => {
    const user = userEvent.setup()
    ;(updateContact as jest.Mock).mockResolvedValue({ ...existingContact, phone: '555-0100' })
    const onSaved = jest.fn()
    renderDrawer({ contact: existingContact, onSaved })

    await user.type(screen.getByLabelText(/phone/i), '555-0100')
    await user.click(screen.getByRole('button', { name: /save contact/i }))

    await waitFor(() => {
      expect(updateContact).toHaveBeenCalledWith(
        'contact-1',
        expect.objectContaining({ phone: '555-0100' }),
      )
      expect(createContact).not.toHaveBeenCalled()
      expect(onSaved).toHaveBeenCalled()
    })
  })
})
