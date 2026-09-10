import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { ContactForm } from '../ContactForm'
import { createContact, updateContact } from '@/services/contact.service'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
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
  searchUsers: jest
    .fn()
    .mockResolvedValue([
      { id: 'user-2', firstName: 'Priya', lastName: 'Raman', email: 'priya@example.com' },
    ]),
}))

function renderWithQuery(ui: React.ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('ContactForm', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('shows inline validation errors for required fields', async () => {
    const user = userEvent.setup()
    renderWithQuery(<ContactForm />)

    await user.click(screen.getByRole('button', { name: /save contact/i }))

    expect(await screen.findByText('Enter a valid email')).toBeInTheDocument()
    expect(screen.getByText('First name is required')).toBeInTheDocument()
    expect(screen.getByText('Last name is required')).toBeInTheDocument()
  })

  it('submits valid create contact values', async () => {
    const user = userEvent.setup()
    ;(createContact as jest.Mock).mockResolvedValue({ id: 'contact-1' })
    renderWithQuery(<ContactForm />)

    await user.type(screen.getByLabelText(/email/i), 'ada@example.com')
    await user.type(screen.getByLabelText(/first name/i), 'Ada')
    await user.type(screen.getByLabelText(/last name/i), 'Lovelace')
    await user.click(screen.getByRole('button', { name: /save contact/i }))

    await waitFor(() => {
      expect(createContact).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'ada@example.com' }),
      )
    })
  })

  it('submits valid edit contact values', async () => {
    const user = userEvent.setup()
    ;(updateContact as jest.Mock).mockResolvedValue({ id: 'contact-1' })
    renderWithQuery(
      <ContactForm
        contact={{
          id: 'contact-1',
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          ownerId: 'user-1',
          createdAt: '2026-05-13T00:00:00.000Z',
          updatedAt: '2026-05-13T00:00:00.000Z',
        }}
      />,
    )

    await user.clear(screen.getByLabelText(/company/i))
    await user.type(screen.getByLabelText(/company/i), 'Acme')
    await user.click(screen.getByRole('button', { name: /save contact/i }))

    await waitFor(() => {
      expect(updateContact).toHaveBeenCalledWith(
        'contact-1',
        expect.objectContaining({ company: 'Acme' }),
      )
    })
  })

  it('submits the note alongside the core fields', async () => {
    const user = userEvent.setup()
    ;(createContact as jest.Mock).mockResolvedValue({ id: 'contact-1' })
    renderWithQuery(<ContactForm />)

    await user.type(screen.getByLabelText(/email/i), 'ada@example.com')
    await user.type(screen.getByLabelText(/first name/i), 'Ada')
    await user.type(screen.getByLabelText(/last name/i), 'Lovelace')
    await user.type(screen.getByLabelText(/note/i), 'Met at the summit')
    await user.click(screen.getByRole('button', { name: /save contact/i }))

    await waitFor(() => {
      expect(createContact).toHaveBeenCalledWith(
        expect.objectContaining({ notes: 'Met at the summit' }),
      )
    })
  })

  it('creates the contact under the selected owner', async () => {
    const user = userEvent.setup()
    ;(createContact as jest.Mock).mockResolvedValue({ id: 'contact-1' })
    renderWithQuery(<ContactForm />)

    await user.type(screen.getByLabelText(/email/i), 'ada@example.com')
    await user.type(screen.getByLabelText(/first name/i), 'Ada')
    await user.type(screen.getByLabelText(/last name/i), 'Lovelace')
    await user.selectOptions(await screen.findByLabelText(/owner/i), 'user-2')
    await user.click(screen.getByRole('button', { name: /save contact/i }))

    await waitFor(() => {
      expect(createContact).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'user-2' }))
    })
  })

  it('omits ownerId on update — reassignment goes through the owner picker', async () => {
    const user = userEvent.setup()
    ;(updateContact as jest.Mock).mockResolvedValue({ id: 'contact-1' })
    renderWithQuery(
      <ContactForm
        contact={{
          id: 'contact-1',
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          ownerId: 'user-1',
          createdAt: '2026-05-13T00:00:00.000Z',
          updatedAt: '2026-05-13T00:00:00.000Z',
        }}
      />,
    )

    expect(screen.queryByLabelText(/owner/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /save contact/i }))

    await waitFor(() => {
      expect(updateContact).toHaveBeenCalled()
    })
    expect((updateContact as jest.Mock).mock.calls[0][1]).not.toHaveProperty('ownerId')
  })

  it('calls onCancel instead of rendering a bare submit when embedded', async () => {
    const user = userEvent.setup()
    const onCancel = jest.fn()
    renderWithQuery(<ContactForm onCancel={onCancel} />)

    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(onCancel).toHaveBeenCalled()
  })

  it('shows server errors inline', async () => {
    const user = userEvent.setup()
    ;(createContact as jest.Mock).mockRejectedValue(new Error('Duplicate email'))
    renderWithQuery(<ContactForm />)

    await user.type(screen.getByLabelText(/email/i), 'ada@example.com')
    await user.type(screen.getByLabelText(/first name/i), 'Ada')
    await user.type(screen.getByLabelText(/last name/i), 'Lovelace')
    await user.click(screen.getByRole('button', { name: /save contact/i }))

    expect(await screen.findByText('Duplicate email')).toBeInTheDocument()
  })
})
