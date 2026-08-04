import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { UserFormDrawer } from '../UserFormDrawer'
import { createUser } from '@/services/user.service'

const push = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: jest.fn() }),
}))

jest.mock('@/services/user.service', () => ({
  createUser: jest.fn(),
  updateUser: jest.fn(),
}))

function renderDrawer(props: Partial<React.ComponentProps<typeof UserFormDrawer>> = {}): {
  onOpenChange: jest.Mock
} {
  const onOpenChange = jest.fn()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <UserFormDrawer open onOpenChange={onOpenChange} {...props} />
    </QueryClientProvider>,
  )
  return { onOpenChange }
}

describe('UserFormDrawer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders nothing when closed', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <UserFormDrawer open={false} onOpenChange={jest.fn()} />
      </QueryClientProvider>,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the panel with the form when open', () => {
    renderDrawer()

    expect(screen.getByRole('dialog', { name: 'New user' })).toBeInTheDocument()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
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

  it('navigates to the saved user and closes after a successful save', async () => {
    const user = userEvent.setup()
    ;(createUser as jest.Mock).mockResolvedValue({ id: 'user-9' })
    const { onOpenChange } = renderDrawer()

    await user.type(screen.getByLabelText(/email/i), 'ada@example.com')
    await user.type(screen.getByLabelText(/first name/i), 'Ada')
    await user.type(screen.getByLabelText(/last name/i), 'Lovelace')
    await user.click(screen.getByRole('button', { name: /create user/i }))

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/users/user-9')
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('hands the saved user to onSaved instead of navigating', async () => {
    const user = userEvent.setup()
    ;(createUser as jest.Mock).mockResolvedValue({ id: 'user-9' })
    const onSaved = jest.fn()
    renderDrawer({ onSaved })

    await user.type(screen.getByLabelText(/email/i), 'ada@example.com')
    await user.type(screen.getByLabelText(/first name/i), 'Ada')
    await user.type(screen.getByLabelText(/last name/i), 'Lovelace')
    await user.click(screen.getByRole('button', { name: /create user/i }))

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({ id: 'user-9' })
    })
    expect(push).not.toHaveBeenCalled()
  })
})
