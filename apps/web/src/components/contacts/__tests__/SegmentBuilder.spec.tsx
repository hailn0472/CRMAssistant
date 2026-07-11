import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { SegmentBuilder } from '../SegmentBuilder'
import { getSavedSegments, createSegment } from '@/services/segment.service'

jest.mock('@/services/segment.service', () => ({
  getSavedSegments: jest.fn(),
  createSegment: jest.fn(),
}))

function renderWithQueryClient(ui: React.ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const defaultFilters = {
  tags: [],
  company: '',
  jobTitle: '',
  createdAtFrom: '',
  createdAtTo: '',
}

describe('SegmentBuilder', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getSavedSegments as jest.Mock).mockResolvedValue([])
  })

  it('renders filter inputs', () => {
    renderWithQueryClient(<SegmentBuilder filters={defaultFilters} onFiltersChange={jest.fn()} />)

    expect(screen.getByPlaceholderText('Company...')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Job title...')).toBeInTheDocument()
  })

  it('does not render save button when no filters are active', () => {
    renderWithQueryClient(<SegmentBuilder filters={defaultFilters} onFiltersChange={jest.fn()} />)

    expect(screen.queryByText('Save as segment')).not.toBeInTheDocument()
  })

  it('renders save button when filters are active', () => {
    renderWithQueryClient(
      <SegmentBuilder
        filters={{ ...defaultFilters, company: 'Acme' }}
        onFiltersChange={jest.fn()}
      />,
    )

    expect(screen.getByText('Save as segment')).toBeInTheDocument()
  })

  it('renders TagFilterBar when tags are selected', () => {
    const tags = [{ id: 'tag-1', name: 'VIP', color: '#EF4444' }]
    renderWithQueryClient(
      <SegmentBuilder filters={{ ...defaultFilters, tags }} onFiltersChange={jest.fn()} />,
    )

    expect(screen.getByText('VIP')).toBeInTheDocument()
  })

  it('calls onFiltersChange when company input changes', async () => {
    const user = userEvent.setup()
    const onFiltersChange = jest.fn()
    renderWithQueryClient(
      <SegmentBuilder filters={defaultFilters} onFiltersChange={onFiltersChange} />,
    )

    await user.type(screen.getByPlaceholderText('Company...'), 'A')

    expect(onFiltersChange).toHaveBeenCalledWith({
      ...defaultFilters,
      company: 'A',
    })
  })

  it('opens save dialog and calls createSegment', async () => {
    ;(createSegment as jest.Mock).mockResolvedValue({
      id: 'segment-1',
      name: 'My Segment',
      filters: '{}',
    })
    const user = userEvent.setup()
    renderWithQueryClient(
      <SegmentBuilder
        filters={{ ...defaultFilters, company: 'Acme' }}
        onFiltersChange={jest.fn()}
      />,
    )

    await user.click(screen.getByText('Save as segment'))
    await user.type(await screen.findByPlaceholderText('Segment name'), 'My Segment')
    await user.click(screen.getByText('Save'))

    expect(createSegment).toHaveBeenCalled()
  })
})
