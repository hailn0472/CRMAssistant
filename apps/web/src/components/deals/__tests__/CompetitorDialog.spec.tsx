import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import toast from 'react-hot-toast'

import { CompetitorDialog } from '../CompetitorDialog'
import { getCompetitors, addCompetitorToDeal } from '@/services/competitor.service'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@/services/competitor.service', () => ({
  getCompetitors: jest.fn(),
  addCompetitorToDeal: jest.fn(),
}))

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

const mockCompetitors = {
  items: [
    {
      id: 'c1',
      name: 'Acme Corp',
      website: null,
      strengths: null,
      weaknesses: null,
      isActive: true,
      createdAt: '2026-07-31T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
    },
    {
      id: 'c2',
      name: 'Globex',
      website: null,
      strengths: null,
      weaknesses: null,
      isActive: true,
      createdAt: '2026-07-31T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
    },
  ],
  total: 2,
  page: 1,
  pageSize: 20,
}

function renderWithQuery(ui: React.ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('CompetitorDialog', () => {
  const onOpenChange = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    ;(getCompetitors as jest.Mock).mockResolvedValue(mockCompetitors)
  })

  it('renders as a Dialog with sm:max-w-md (AC #26)', () => {
    renderWithQuery(<CompetitorDialog dealId="deal-1" open onOpenChange={onOpenChange} />)

    expect(screen.getByText('Add competitor')).toBeInTheDocument()
    expect(screen.getByRole('dialog').className).toContain('sm:max-w-md')
  })

  it('shows the search input and dropdown from getCompetitors (AC #26)', async () => {
    ;(getCompetitors as jest.Mock).mockResolvedValue(mockCompetitors)
    renderWithQuery(<CompetitorDialog dealId="deal-1" open onOpenChange={onOpenChange} />)

    const search = screen.getByPlaceholderText('Search competitors...')
    fireEvent.change(search, { target: { value: 'acme' } })

    expect(await screen.findByText('Acme Corp')).toBeInTheDocument()
    expect(getCompetitors).toHaveBeenCalledWith(1, 20, expect.objectContaining({ search: 'acme' }))
  })

  it('selecting a competitor and submitting calls addCompetitorToDeal (AC #26)', async () => {
    ;(getCompetitors as jest.Mock).mockResolvedValue(mockCompetitors)
    ;(addCompetitorToDeal as jest.Mock).mockResolvedValue({
      id: 'link-1',
      dealId: 'deal-1',
      competitorId: 'c1',
      note: null,
      createdAt: '',
      competitor: mockCompetitors.items[0],
    })
    renderWithQuery(<CompetitorDialog dealId="deal-1" open onOpenChange={onOpenChange} />)

    const search = screen.getByPlaceholderText('Search competitors...')
    fireEvent.change(search, { target: { value: 'acme' } })
    const option = await screen.findByText('Acme Corp')
    fireEvent.click(option)

    fireEvent.click(screen.getByRole('button', { name: 'Add to deal' }))

    await waitFor(() => {
      expect(addCompetitorToDeal).toHaveBeenCalledWith({
        dealId: 'deal-1',
        competitorId: 'c1',
        note: null,
      })
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(toast.success).toHaveBeenCalledWith('Competitor added to deal')
  })

  it('renders server errors in a role="alert" panel (AC #26)', async () => {
    ;(getCompetitors as jest.Mock).mockResolvedValue(mockCompetitors)
    ;(addCompetitorToDeal as jest.Mock).mockRejectedValue(
      new Error('Competitor already linked to this deal'),
    )
    renderWithQuery(<CompetitorDialog dealId="deal-1" open onOpenChange={onOpenChange} />)

    const search = screen.getByPlaceholderText('Search competitors...')
    fireEvent.change(search, { target: { value: 'acme' } })
    fireEvent.click(await screen.findByText('Acme Corp'))
    fireEvent.click(screen.getByRole('button', { name: 'Add to deal' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Competitor already linked to this deal',
    )
  })

  it('cancel closes the dialog without a mutation (AC #26)', () => {
    renderWithQuery(<CompetitorDialog dealId="deal-1" open onOpenChange={onOpenChange} />)

    fireEvent.click(screen.getByText('Cancel'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(addCompetitorToDeal).not.toHaveBeenCalled()
  })
})
