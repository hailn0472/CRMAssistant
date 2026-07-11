import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { TagManagementDialog } from '../TagManagementDialog'
import { getTags, createTag, deleteTag } from '@/services/tag.service'

jest.mock('@/services/tag.service', () => ({
  getTags: jest.fn(),
  createTag: jest.fn(),
  deleteTag: jest.fn(),
  updateTag: jest.fn(),
}))

function renderWithQueryClient(ui: React.ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('TagManagementDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getTags as jest.Mock).mockResolvedValue([{ id: 'tag-1', name: 'VIP', color: '#EF4444' }])
  })

  it('renders trigger button', () => {
    renderWithQueryClient(<TagManagementDialog />)

    expect(screen.getByText('Manage tags')).toBeInTheDocument()
  })

  it('opens dialog when trigger is clicked', async () => {
    const user = userEvent.setup()
    renderWithQueryClient(<TagManagementDialog />)

    await user.click(screen.getByText('Manage tags'))

    expect(await screen.findByText('New tag')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Tag name')).toBeInTheDocument()
  })

  it('renders loading skeleton while tags are loading', async () => {
    ;(getTags as jest.Mock).mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    const { container } = renderWithQueryClient(<TagManagementDialog />)

    await user.click(screen.getByText('Manage tags'))

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
  })

  it('renders tag list after loading', async () => {
    const user = userEvent.setup()
    renderWithQueryClient(<TagManagementDialog />)

    await user.click(screen.getByText('Manage tags'))

    expect(await screen.findByText('VIP')).toBeInTheDocument()
  })

  it('renders empty state when no tags exist', async () => {
    ;(getTags as jest.Mock).mockResolvedValue([])
    const user = userEvent.setup()
    renderWithQueryClient(<TagManagementDialog />)

    await user.click(screen.getByText('Manage tags'))

    expect(await screen.findByText('No tags yet. Create your first tag above.')).toBeInTheDocument()
  })

  it('renders color preset buttons', async () => {
    const user = userEvent.setup()
    renderWithQueryClient(<TagManagementDialog />)

    await user.click(screen.getByText('Manage tags'))

    expect(await screen.findByLabelText('Select color #3B82F6')).toBeInTheDocument()
  })

  it('calls createTag when create button is clicked', async () => {
    ;(createTag as jest.Mock).mockResolvedValue({
      id: 'tag-3',
      name: 'New Tag',
      color: '#10B981',
    })
    const user = userEvent.setup()
    renderWithQueryClient(<TagManagementDialog />)

    await user.click(screen.getByText('Manage tags'))
    await user.type(await screen.findByPlaceholderText('Tag name'), 'New Tag')
    await user.click(screen.getByText('Create'))

    expect(createTag).toHaveBeenCalledWith('New Tag', '#3B82F6')
  })

  it('calls deleteTag after confirm', async () => {
    ;(deleteTag as jest.Mock).mockResolvedValue({ success: true, affectedContacts: 0 })
    const user = userEvent.setup()
    renderWithQueryClient(<TagManagementDialog />)

    await user.click(screen.getByText('Manage tags'))
    await screen.findByText('VIP')

    await user.click(screen.getByText('Delete'))
    await user.click(screen.getByText('Confirm'))

    expect(deleteTag).toHaveBeenCalledWith('tag-1')
  })

  it('cancels delete when cancel button is clicked', async () => {
    const user = userEvent.setup()
    renderWithQueryClient(<TagManagementDialog />)

    await user.click(screen.getByText('Manage tags'))
    await screen.findByText('VIP')

    await user.click(screen.getByText('Delete'))
    await user.click(screen.getByText('Cancel'))

    // Confirm button should be gone
    expect(screen.queryByText('Confirm')).not.toBeInTheDocument()
  })
})
