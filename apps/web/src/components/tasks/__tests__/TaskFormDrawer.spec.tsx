import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { TaskFormDrawer } from '../TaskFormDrawer'
import { createTask, getTaskTemplates } from '@/services/task.service'

const push = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@/services/task.service', () => ({
  createTask: jest.fn(),
  updateTask: jest.fn(),
  getTaskTemplates: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 }),
  createTaskFromTemplate: jest.fn(),
}))

jest.mock('@/services/contact.service', () => ({
  getContacts: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
}))

jest.mock('@/services/deal.service', () => ({
  getDeals: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
}))

jest.mock('@/services/owner.service', () => ({
  searchUsers: jest.fn().mockResolvedValue([]),
}))

function renderDrawer(props: Partial<React.ComponentProps<typeof TaskFormDrawer>> = {}): {
  onOpenChange: jest.Mock
} {
  const onOpenChange = jest.fn()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <TaskFormDrawer open onOpenChange={onOpenChange} {...props} />
    </QueryClientProvider>,
  )
  return { onOpenChange }
}

describe('TaskFormDrawer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getTaskTemplates as jest.Mock).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
    })
  })

  it('renders nothing when closed', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <TaskFormDrawer open={false} onOpenChange={jest.fn()} />
      </QueryClientProvider>,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the panel with the form when open', () => {
    renderDrawer()

    expect(screen.getByRole('dialog', { name: 'New task' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter task title')).toBeInTheDocument()
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

  it('shows the template selector when opened from "New from template"', () => {
    renderDrawer({ fromTemplate: true })

    expect(screen.getByLabelText('Task template')).toBeInTheDocument()
  })

  it('navigates to the saved task and closes after a successful save', async () => {
    const user = userEvent.setup()
    ;(createTask as jest.Mock).mockResolvedValue({ id: 'task-9' })
    const { onOpenChange } = renderDrawer()

    await user.type(screen.getByPlaceholderText('Enter task title'), 'Follow up')
    await user.click(screen.getByRole('button', { name: /create task/i }))

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/tasks/task-9')
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('hands the saved task to onSaved instead of navigating', async () => {
    const user = userEvent.setup()
    ;(createTask as jest.Mock).mockResolvedValue({ id: 'task-9' })
    const onSaved = jest.fn()
    renderDrawer({ onSaved })

    await user.type(screen.getByPlaceholderText('Enter task title'), 'Follow up')
    await user.click(screen.getByRole('button', { name: /create task/i }))

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({ id: 'task-9' })
    })
    expect(push).not.toHaveBeenCalled()
  })
})
