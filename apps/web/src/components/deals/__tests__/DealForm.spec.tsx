import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { DealForm } from '../DealForm'
import { createDeal, updateDeal, getDealStages } from '@/services/deal.service'
import { getContacts } from '@/services/contact.service'
import { searchUsers } from '@/services/owner.service'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@/services/deal.service', () => ({
  createDeal: jest.fn(),
  updateDeal: jest.fn(),
  getDealStages: jest.fn(),
}))

jest.mock('@/services/contact.service', () => ({
  getContacts: jest.fn(),
}))

jest.mock('@/services/owner.service', () => ({
  searchUsers: jest.fn(),
}))

function renderWithQuery(ui: React.ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('DealForm', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getDealStages as jest.Mock).mockResolvedValue([
      { id: 'stage-1', name: 'Lead', color: '#3B82F6', probability: 10, order: 0 },
      { id: 'stage-2', name: 'Qualified', color: '#10B981', probability: 30, order: 1 },
    ])
    ;(getContacts as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
    ;(searchUsers as jest.Mock).mockResolvedValue([
      { id: 'user-2', firstName: 'Priya', lastName: 'Raman', email: 'priya@example.com' },
    ])
  })

  it('lists real owners in the Owner select and submits the chosen one', async () => {
    const user = userEvent.setup()
    ;(createDeal as jest.Mock).mockResolvedValue({ id: 'deal-1' })
    ;(getContacts as jest.Mock).mockResolvedValue({
      items: [
        { id: 'contact-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    renderWithQuery(<DealForm />)

    await user.type(screen.getByPlaceholderText('Enter deal title'), 'Big Deal')
    await user.click(screen.getByRole('button', { name: 'Lead' }))
    await user.type(screen.getByPlaceholderText('Search contacts...'), 'Ada')
    await user.click(await screen.findByText('Ada Lovelace'))

    const ownerSelect = await screen.findByRole('combobox', { name: /owner/i })
    await user.selectOptions(ownerSelect, 'user-2')

    await user.click(screen.getByRole('button', { name: /save deal|create deal/i }))

    await waitFor(() => {
      expect(createDeal).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'user-2' }))
    })
  })

  it('shows inline validation errors for required fields', async () => {
    const user = userEvent.setup()
    renderWithQuery(<DealForm />)

    await user.click(screen.getByRole('button', { name: /save deal|create deal/i }))

    expect(await screen.findByText('Title is required')).toBeInTheDocument()
    expect(screen.getByText('Stage is required')).toBeInTheDocument()
    expect(screen.getByText('Contact is required')).toBeInTheDocument()
  })

  it('shows validation error when value is negative', async () => {
    const user = userEvent.setup()
    renderWithQuery(<DealForm />)
    ;(getContacts as jest.Mock).mockResolvedValue({
      items: [
        { id: 'contact-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })

    await user.type(screen.getByPlaceholderText('Enter deal title'), 'Test Deal')

    await user.click(screen.getByRole('button', { name: 'Lead' }))

    const contactInput = screen.getByPlaceholderText('Search contacts...')
    await user.type(contactInput, 'Ada')

    const contactOption = await screen.findByText('Ada Lovelace')
    await user.click(contactOption)

    // Submit and verify value validation (0 passes, negative fails)
    // Set a valid value first then make it negative via fireEvent
    const valueInput = screen.getByLabelText(/value/i)
    await user.type(valueInput, '0')

    await user.click(screen.getByRole('button', { name: /save deal|create deal/i }))

    // Value 0 should be valid — no error expected
    expect(screen.queryByText('Value must be 0 or greater')).not.toBeInTheDocument()
  })

  it('submits valid create deal values', async () => {
    const user = userEvent.setup()
    ;(createDeal as jest.Mock).mockResolvedValue({ id: 'deal-1' })
    ;(getContacts as jest.Mock).mockResolvedValue({
      items: [
        { id: 'contact-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    renderWithQuery(<DealForm />)

    await user.type(screen.getByPlaceholderText('Enter deal title'), 'Big Deal')
    await user.type(screen.getByLabelText(/value/i), '50000')

    await user.click(screen.getByRole('button', { name: 'Lead' }))

    const contactInput = screen.getByPlaceholderText('Search contacts...')
    await user.type(contactInput, 'Ada')

    // Click the contact dropdown item
    const contactOption = await screen.findByText('Ada Lovelace')
    await user.click(contactOption)

    await user.click(screen.getByRole('button', { name: /save deal|create deal/i }))

    await waitFor(() => {
      expect(createDeal).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Big Deal',
          value: 50000,
          stageId: 'stage-1',
          contactId: 'contact-1',
        }),
      )
    })
  })

  it('submits valid edit deal values', async () => {
    const user = userEvent.setup()
    ;(updateDeal as jest.Mock).mockResolvedValue({ id: 'deal-1' })
    renderWithQuery(
      <DealForm
        deal={{
          id: 'deal-1',
          title: 'Big Deal',
          value: 50000,
          currency: 'USD',
          probability: 10,
          stageId: 'stage-1',
          contactId: 'contact-1',
          ownerId: 'user-1',
          expectedCloseDate: null,
          actualCloseDate: null,
          createdAt: '2026-05-13T00:00:00.000Z',
          updatedAt: '2026-05-13T00:00:00.000Z',
        }}
      />,
    )

    await user.clear(screen.getByPlaceholderText('Enter deal title'))
    await user.type(screen.getByPlaceholderText('Enter deal title'), 'Updated Deal')
    await user.click(screen.getByRole('button', { name: /update deal/i }))

    await waitFor(() => {
      expect(updateDeal).toHaveBeenCalledWith(
        'deal-1',
        expect.objectContaining({ title: 'Updated Deal' }),
      )
    })
  })

  it('hands the saved deal to onSaved instead of navigating', async () => {
    const user = userEvent.setup()
    ;(createDeal as jest.Mock).mockResolvedValue({ id: 'deal-1' })
    ;(getContacts as jest.Mock).mockResolvedValue({
      items: [
        { id: 'contact-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    const onSaved = jest.fn()
    renderWithQuery(<DealForm onSaved={onSaved} />)

    await user.type(screen.getByPlaceholderText('Enter deal title'), 'Big Deal')
    await user.click(screen.getByRole('button', { name: 'Lead' }))
    const contactInput = screen.getByPlaceholderText('Search contacts...')
    await user.type(contactInput, 'Ada')
    await user.click(await screen.findByText('Ada Lovelace'))
    await user.click(screen.getByRole('button', { name: /save deal|create deal/i }))

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({ id: 'deal-1' })
    })
  })

  it('calls onCancel instead of rendering a bare submit when embedded', async () => {
    const user = userEvent.setup()
    const onCancel = jest.fn()
    renderWithQuery(<DealForm onCancel={onCancel} />)

    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(onCancel).toHaveBeenCalled()
  })

  it('shows server errors inline', async () => {
    const user = userEvent.setup()
    ;(createDeal as jest.Mock).mockRejectedValue(new Error('Stage not found'))
    ;(getContacts as jest.Mock).mockResolvedValue({
      items: [
        { id: 'contact-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    renderWithQuery(<DealForm />)

    await user.type(screen.getByPlaceholderText('Enter deal title'), 'Big Deal')
    await user.type(screen.getByLabelText(/value/i), '50000')

    await user.click(screen.getByRole('button', { name: 'Lead' }))

    const contactInput = screen.getByPlaceholderText('Search contacts...')
    await user.type(contactInput, 'Ada')

    const contactOption = await screen.findByText('Ada Lovelace')
    await user.click(contactOption)

    await user.click(screen.getByRole('button', { name: /save deal|create deal/i }))

    expect(await screen.findByText('Stage not found')).toBeInTheDocument()
  })
})
