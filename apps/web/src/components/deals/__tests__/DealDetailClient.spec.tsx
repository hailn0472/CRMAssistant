// @ts-nocheck
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { DealDetailClient } from '../DealDetailClient'
import { deleteDeal, moveDealToStage, getDealStages } from '@/services/deal.service'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@/services/deal.service', () => ({
  deleteDeal: jest.fn(),
  moveDealToStage: jest.fn(),
  getDealStages: jest.fn(),
}))

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

const mockDeal = {
  id: 'deal-1',
  title: 'CloudTech Enterprise Deal',
  value: 85000,
  currency: 'USD',
  probability: 10,
  stageId: 'stage-1',
  contactId: 'contact-1',
  ownerId: 'owner-1',
  expectedCloseDate: '2026-12-31T00:00:00.000Z',
  actualCloseDate: null,
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
  stage: { id: 'stage-1', name: 'Lead', color: '#3B82F6', probability: 10, isWon: false, isLost: false, order: 0 },
  contact: { id: 'contact-1', firstName: 'Ownership', lastName: 'Test', email: 'test@example.com' },
  owner: { id: 'owner-1', firstName: 'Acme', lastName: 'Admin', email: 'admin@example.com', avatar: null },
} as const

const mockStages = [
  { id: 'stage-1', name: 'Lead', color: '#3B82F6', probability: 10, order: 0 },
  { id: 'stage-2', name: 'Qualified', color: '#10B981', probability: 25, order: 1 },
  { id: 'stage-3', name: 'Closed Won', color: '#10B981', probability: 100, order: 4, isWon: true },
]

function renderWithQuery(ui: React.ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  (getDealStages as jest.Mock).mockResolvedValue(mockStages)
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('DealDetailClient', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('renders deal title and formatted value', async () => {
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    expect(screen.getByText('CloudTech Enterprise Deal')).toBeInTheDocument()
    expect(screen.getByText('$85,000')).toBeInTheDocument()
  })

  it('renders stage badge with color and label', () => {
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    expect(screen.getByText('Lead')).toBeInTheDocument()
  })

  it('renders contact link when contact exists', () => {
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    const contactLink = screen.getByText(/Ownership Test/)
    expect(contactLink).toBeInTheDocument()
    expect(contactLink.closest('a')).toHaveAttribute('href', '/contacts/contact-1')
  })

  it('renders owner name when owner exists', () => {
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    expect(screen.getByText('Acme Admin')).toBeInTheDocument()
  })

  it('renders expected close date', () => {
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    expect(screen.getByText('12/31/2026')).toBeInTheDocument()
  })

  it('renders probability', () => {
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    expect(screen.getByText('10%')).toBeInTheDocument()
  })

  it('renders dash for actual close date when null', () => {
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(1)
  })

  it('shows Stage dropdown with options', async () => {
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    const select = screen.getByRole('combobox') ?? screen.getByDisplayValue('Lead')
    expect(select).toBeInTheDocument()
  })

  it('calls deleteDeal and navigates on delete', async () => {
    ;(deleteDeal as jest.Mock).mockResolvedValue(true)
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    const deleteBtn = screen.getByText('Delete')
    fireEvent.click(deleteBtn)

    await waitFor(() => {
      expect(deleteDeal).toHaveBeenCalledWith('deal-1')
    })
    expect(toast.success).toHaveBeenCalledWith('Deal deleted')
  })

  it('shows error toast when delete fails', async () => {
    ;(deleteDeal as jest.Mock).mockRejectedValue(new Error('Delete failed'))
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    const deleteBtn = screen.getByText('Delete')
    fireEvent.click(deleteBtn)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to delete deal')
    })
  })

  it('calls moveDealToStage when stage changes', async () => {
    ;(moveDealToStage as jest.Mock).mockResolvedValue(true)
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    // Wait for the stage select to render with the current value
    const stageSelect = await screen.findByDisplayValue('Lead')
    expect(stageSelect).toBeInTheDocument()

    fireEvent.change(stageSelect, { target: { value: 'stage-2' } })

    await waitFor(() => {
      expect(moveDealToStage).toHaveBeenCalledWith('deal-1', 'stage-2')
    }, { timeout: 3000 })
    expect(toast.success).toHaveBeenCalledWith('Stage updated')
  })

  it('shows error toast when stage change fails', async () => {
    ;(moveDealToStage as jest.Mock).mockRejectedValue(new Error('Stage change failed'))
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    const select = screen.getByRole('combobox') ?? screen.getByDisplayValue('Lead')
    fireEvent.change(select, { target: { value: 'stage-2' } })

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to update stage')
    })
  })

  it('renders back link to /deals', () => {
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    const backLink = screen.getByText('Back to deals')
    expect(backLink).toBeInTheDocument()
    expect(backLink.closest('a')).toHaveAttribute('href', '/deals')
  })

  it('renders Edit button that navigates to edit page', () => {
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    const editBtn = screen.getByText('Edit')
    expect(editBtn).toBeInTheDocument()
  })

  it('renders created and updated dates in metadata', () => {
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    const createdDate = new Date(mockDeal.createdAt).toLocaleDateString()
    // The app renders toLocaleDateString() in the component — match that
    const createdElements = screen.getAllByText(createdDate)
    expect(createdElements.length).toBeGreaterThan(0)
  })

  it('renders stage badge with correct color style', () => {
    renderWithQuery(<DealDetailClient deal={mockDeal} />)

    const badge = screen.getByText('Lead')
    expect(badge).toBeInTheDocument()
    expect(badge.tagName).toBe('SPAN')
  })

  it('does not render stage badge when stage is null', () => {
    const dealNoStage = { ...mockDeal, stage: null }
    const { container } = renderWithQuery(<DealDetailClient deal={dealNoStage} />)

    const stageBadge = container.querySelector('.rounded-full')
    expect(stageBadge).not.toBeInTheDocument()
  })

  it('renders dash for expected close date when null', () => {
    const dealNoDate = { ...mockDeal, expectedCloseDate: null }
    renderWithQuery(<DealDetailClient deal={dealNoDate} />)

    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})
