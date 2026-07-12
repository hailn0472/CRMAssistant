import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { TagSelector } from '../TagSelector'
import { getTags } from '@/services/tag.service'

jest.mock('@/services/tag.service', () => ({
  getTags: jest.fn(),
  addTagToContact: jest.fn(),
  removeTagFromContact: jest.fn(),
}))

function renderWithQueryClient(ui: React.ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('TagSelector', () => {
  const selectedTags = [{ id: 'tag-1', name: 'VIP', color: '#EF4444' }]

  beforeEach(() => {
    jest.clearAllMocks()
    ;(getTags as jest.Mock).mockResolvedValue([
      { id: 'tag-1', name: 'VIP', color: '#EF4444' },
      { id: 'tag-2', name: 'Hot Lead', color: '#F59E0B' },
    ])
  })

  it('renders selected tags', async () => {
    renderWithQueryClient(<TagSelector selectedTags={selectedTags} onTagsChange={jest.fn()} />)

    expect(await screen.findByText('VIP')).toBeInTheDocument()
  })

  it('renders loading skeleton initially', () => {
    // Don't resolve the promise yet to keep loading state
    ;(getTags as jest.Mock).mockReturnValue(new Promise(() => {}))

    const { container } = renderWithQueryClient(
      <TagSelector selectedTags={selectedTags} onTagsChange={jest.fn()} />,
    )

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
  })

  it('renders "Add tag..." button', async () => {
    renderWithQueryClient(<TagSelector selectedTags={selectedTags} onTagsChange={jest.fn()} />)

    expect(await screen.findByText('Add tag...')).toBeInTheDocument()
  })

  it('does not render selected tags when list is empty', async () => {
    renderWithQueryClient(<TagSelector selectedTags={[]} onTagsChange={jest.fn()} />)

    await screen.findByText('Add tag...')
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
  })
})
