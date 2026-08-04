import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { DealFormDrawer } from '../DealFormDrawer'
import { createDeal, updateDeal, getDealStages } from '@/services/deal.service'
import { getContacts } from '@/services/contact.service'
import type { Deal } from '@/services/deal.service'

const push = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: jest.fn() }),
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
  searchUsers: jest.fn().mockResolvedValue([]),
}))

function renderDrawer(props: Partial<React.ComponentProps<typeof DealFormDrawer>> = {}): {
  onOpenChange: jest.Mock
} {
  const onOpenChange = jest.fn()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <DealFormDrawer open onOpenChange={onOpenChange} {...props} />
    </QueryClientProvider>,
  )
  return { onOpenChange }
}

describe('DealFormDrawer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getDealStages as jest.Mock).mockResolvedValue([
      { id: 'stage-1', name: 'Lead', color: '#3B82F6', probability: 10, order: 0 },
    ])
    ;(getContacts as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
  })

  it('renders nothing when closed', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <DealFormDrawer open={false} onOpenChange={jest.fn()} />
      </QueryClientProvider>,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the panel with the form when open', () => {
    renderDrawer()

    expect(screen.getByRole('dialog', { name: 'New deal' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter deal title')).toBeInTheDocument()
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

  it('navigates to the saved deal and closes after a successful save', async () => {
    const user = userEvent.setup()
    ;(createDeal as jest.Mock).mockResolvedValue({ id: 'deal-9' })
    ;(getContacts as jest.Mock).mockResolvedValue({
      items: [
        { id: 'contact-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    const { onOpenChange } = renderDrawer()

    await user.type(screen.getByPlaceholderText('Enter deal title'), 'Big Deal')
    await user.click(screen.getByRole('button', { name: 'Lead' }))
    await user.type(screen.getByPlaceholderText('Search contacts...'), 'Ada')
    await user.click(await screen.findByText('Ada Lovelace'))
    await user.click(screen.getByRole('button', { name: /save deal/i }))

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/deals/deal-9')
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('hands the saved deal to onSaved instead of navigating', async () => {
    const user = userEvent.setup()
    ;(createDeal as jest.Mock).mockResolvedValue({ id: 'deal-9' })
    ;(getContacts as jest.Mock).mockResolvedValue({
      items: [
        { id: 'contact-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    const onSaved = jest.fn()
    renderDrawer({ onSaved })

    await user.type(screen.getByPlaceholderText('Enter deal title'), 'Big Deal')
    await user.click(screen.getByRole('button', { name: 'Lead' }))
    await user.type(screen.getByPlaceholderText('Search contacts...'), 'Ada')
    await user.click(await screen.findByText('Ada Lovelace'))
    await user.click(screen.getByRole('button', { name: /save deal/i }))

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({ id: 'deal-9' })
    })
    expect(push).not.toHaveBeenCalled()
  })

  const existingDeal: Deal = {
    id: 'deal-1',
    title: 'E2E Lost — Budget Cut',
    value: 8000,
    currency: 'USD',
    probability: 10,
    stageId: 'stage-1',
    contactId: 'contact-1',
    ownerId: 'user-1',
    expectedCloseDate: null,
    actualCloseDate: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
  }

  it('shows an Edit deal title with the deal title and formatted value when given a deal', () => {
    renderDrawer({ deal: existingDeal })

    expect(screen.getByRole('dialog', { name: 'Edit deal' })).toBeInTheDocument()
    expect(screen.getByText('E2E Lost — Budget Cut · $8,000')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter deal title')).toHaveValue('E2E Lost — Budget Cut')
  })

  it('updates the existing deal instead of creating a new one', async () => {
    const user = userEvent.setup()
    ;(updateDeal as jest.Mock).mockResolvedValue({ ...existingDeal, title: 'Renamed deal' })
    const onSaved = jest.fn()
    renderDrawer({ deal: existingDeal, onSaved })

    await user.clear(screen.getByPlaceholderText('Enter deal title'))
    await user.type(screen.getByPlaceholderText('Enter deal title'), 'Renamed deal')
    await user.click(screen.getByRole('button', { name: /update deal/i }))

    await waitFor(() => {
      expect(updateDeal).toHaveBeenCalledWith(
        'deal-1',
        expect.objectContaining({ title: 'Renamed deal' }),
      )
      expect(createDeal).not.toHaveBeenCalled()
      expect(onSaved).toHaveBeenCalled()
    })
  })
})
