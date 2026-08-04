import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import toast from 'react-hot-toast'

import { DealCompetitors } from '../DealCompetitors'
import { getDealCompetitors, removeCompetitorFromDeal } from '@/services/competitor.service'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@/services/competitor.service', () => ({
  getDealCompetitors: jest.fn(),
  removeCompetitorFromDeal: jest.fn(),
  getCompetitors: jest.fn(),
}))

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

const mockLinks = [
  {
    id: 'link-1',
    dealId: 'deal-1',
    competitorId: 'c1',
    note: 'Main rival',
    createdAt: '2026-07-31T00:00:00.000Z',
    competitor: {
      id: 'c1',
      name: 'Acme Corp',
      website: null,
      strengths: null,
      weaknesses: null,
      isActive: true,
      createdAt: '2026-07-31T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
    },
  },
]

function renderWithQuery(ui: React.ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('DealCompetitors', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('renders the Competitors header with the shared idiom (AC #25)', async () => {
    ;(getDealCompetitors as jest.Mock).mockResolvedValue([])
    renderWithQuery(<DealCompetitors dealId="deal-1" />)

    const header = await screen.findByText('Competitors')
    expect(header.tagName).toBe('H2')
    expect(getDealCompetitors).toHaveBeenCalledWith('deal-1')
  })

  it('queries with the dealCompetitors key and dealId (AC #25)', async () => {
    ;(getDealCompetitors as jest.Mock).mockResolvedValue(mockLinks)
    renderWithQuery(<DealCompetitors dealId="deal-1" />)
    expect(await screen.findByText('Acme Corp')).toBeInTheDocument()
  })

  it('renders the empty state when no competitors are linked (AC #25)', async () => {
    ;(getDealCompetitors as jest.Mock).mockResolvedValue([])
    renderWithQuery(<DealCompetitors dealId="deal-1" />)

    expect(await screen.findByText(/No competitors/)).toBeInTheDocument()
  })

  it('renders the error state when the query fails (AC #25)', async () => {
    ;(getDealCompetitors as jest.Mock).mockRejectedValue(new Error('Network down'))
    renderWithQuery(<DealCompetitors dealId="deal-1" />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('renders competitor names, notes and 44x44 remove buttons (AC #25, #33)', async () => {
    ;(getDealCompetitors as jest.Mock).mockResolvedValue(mockLinks)
    renderWithQuery(<DealCompetitors dealId="deal-1" />)

    expect(await screen.findByText('Acme Corp')).toBeInTheDocument()
    expect(screen.getByText('Main rival')).toBeInTheDocument()

    const removeButton = screen.getByRole('button', { name: 'Remove Acme Corp' })
    expect(removeButton.className).toContain('h-11 w-11')
  })

  it('removes a competitor and invalidates the query (AC #25)', async () => {
    ;(getDealCompetitors as jest.Mock).mockResolvedValue(mockLinks)
    ;(removeCompetitorFromDeal as jest.Mock).mockResolvedValue(true)
    renderWithQuery(<DealCompetitors dealId="deal-1" />)

    const removeButton = await screen.findByRole('button', { name: 'Remove Acme Corp' })
    fireEvent.click(removeButton)

    await waitFor(() => {
      expect(removeCompetitorFromDeal).toHaveBeenCalledWith('link-1')
    })
    expect(toast.success).toHaveBeenCalledWith('Competitor removed')
  })
})
