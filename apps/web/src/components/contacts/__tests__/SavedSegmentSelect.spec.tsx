import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { SavedSegmentSelect } from '../SavedSegmentSelect'
import { getSavedSegments } from '@/services/segment.service'

jest.mock('@/services/segment.service', () => ({
  getSavedSegments: jest.fn(),
}))

function renderWithQueryClient(ui: React.ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('SavedSegmentSelect', () => {
  const mockSegments = [
    {
      id: 'seg-1',
      name: 'VIP Customers',
      filters: '{}',
      createdBy: 'user-1',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    {
      id: 'seg-2',
      name: 'Enterprise',
      filters: '{}',
      createdBy: 'user-1',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  ]

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders nothing when no saved segments exist', async () => {
    ;(getSavedSegments as jest.Mock).mockResolvedValue([])

    const { container } = renderWithQueryClient(<SavedSegmentSelect onSelect={jest.fn()} />)

    // Component returns empty fragment when no segments
    expect(container.innerHTML).toBe('')
  })

  it('renders segment options when segments exist', async () => {
    ;(getSavedSegments as jest.Mock).mockResolvedValue(mockSegments)

    renderWithQueryClient(<SavedSegmentSelect onSelect={jest.fn()} />)

    expect(await screen.findByText('VIP Customers')).toBeInTheDocument()
    expect(screen.getByText('Enterprise')).toBeInTheDocument()
  })

  it('calls onSelect when a segment is chosen', async () => {
    ;(getSavedSegments as jest.Mock).mockResolvedValue(mockSegments)
    const onSelect = jest.fn()
    const user = userEvent.setup()

    renderWithQueryClient(<SavedSegmentSelect onSelect={onSelect} />)

    await screen.findByText('VIP Customers')
    await user.selectOptions(screen.getByRole('combobox'), 'seg-1')

    expect(onSelect).toHaveBeenCalledWith(mockSegments[0])
  })

  it('triggers onSelect when a segment is selected', async () => {
    ;(getSavedSegments as jest.Mock).mockResolvedValue(mockSegments)
    const onSelect = jest.fn()
    const user = userEvent.setup()

    renderWithQueryClient(<SavedSegmentSelect onSelect={onSelect} />)

    await screen.findByText('VIP Customers')
    await user.selectOptions(screen.getByRole('combobox'), 'seg-1')

    expect(onSelect).toHaveBeenCalledWith(mockSegments[0])
  })
})
