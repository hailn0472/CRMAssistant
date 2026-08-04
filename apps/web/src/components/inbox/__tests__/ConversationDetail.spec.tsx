import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { ConversationDetail } from '../ConversationDetail'
import {
  archiveConversation,
  assignConversation,
  getInternalAgents,
  getMessages,
  resolveConversation,
} from '@/services/inbox.service'

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

jest.mock('@/services/inbox.service', () => ({
  getMessages: jest.fn(),
  sendMessage: jest.fn(),
  markAsRead: jest.fn(),
  getInternalAgents: jest.fn(),
  assignConversation: jest.fn(),
  resolveConversation: jest.fn(),
  archiveConversation: jest.fn(),
}))

const mockAuthState = {
  user: { userId: 'agent-1', tenantId: 'tenant-1', firstName: 'A', lastName: 'B' },
}

jest.mock('@/stores/auth.store', () => ({
  useAuthStore: Object.assign(
    jest.fn((selector?: (state: unknown) => unknown) =>
      selector ? selector(mockAuthState) : mockAuthState,
    ),
    { getState: () => mockAuthState },
  ),
}))

function renderDetail(ui: React.ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('ConversationDetail — thread actions (Assign / Resolve / Archive)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getMessages as jest.Mock).mockResolvedValue({ items: [], hasMore: false, nextCursor: null })
    ;(getInternalAgents as jest.Mock).mockResolvedValue([
      { id: 'agent-2', firstName: 'Casey', lastName: 'Nguyen', email: 'casey@example.com' },
    ])
  })

  it('enables Resolve and Archive for an open conversation and calls the real mutations', async () => {
    const user = userEvent.setup()
    const onConversationUpdated = jest.fn()
    ;(resolveConversation as jest.Mock).mockResolvedValue({})
    ;(archiveConversation as jest.Mock).mockResolvedValue({})

    renderDetail(
      <ConversationDetail
        conversationId="conv-1"
        contactName="Dana Whitfield"
        status="OPEN"
        onConversationUpdated={onConversationUpdated}
      />,
    )

    const resolveBtn = await screen.findByRole('button', { name: 'Resolve' })
    const archiveBtn = screen.getByRole('button', { name: /Archive/ })
    expect(resolveBtn).toBeEnabled()
    expect(archiveBtn).toBeEnabled()

    await user.click(resolveBtn)

    await waitFor(() => {
      expect(resolveConversation).toHaveBeenCalledWith('conv-1')
      expect(toast.success).toHaveBeenCalledWith('Conversation resolved')
      expect(onConversationUpdated).toHaveBeenCalled()
    })
  })

  it('disables Resolve and Archive once the conversation is already resolved', async () => {
    renderDetail(
      <ConversationDetail conversationId="conv-1" contactName="Dana Whitfield" status="RESOLVED" />,
    )

    expect(await screen.findByRole('button', { name: 'Resolve' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Archive/ })).toBeDisabled()
  })

  it('archives the conversation and surfaces a failure via toast', async () => {
    const user = userEvent.setup()
    ;(archiveConversation as jest.Mock).mockRejectedValue(new Error('Cannot archive'))

    renderDetail(
      <ConversationDetail conversationId="conv-1" contactName="Dana Whitfield" status="PENDING" />,
    )

    await user.click(await screen.findByRole('button', { name: /Archive/ }))

    await waitFor(() => {
      expect(archiveConversation).toHaveBeenCalledWith('conv-1')
      expect(toast.error).toHaveBeenCalledWith('Cannot archive')
    })
  })

  it('assigns the conversation to a selected agent from the Assign popover', async () => {
    const user = userEvent.setup()
    const onConversationUpdated = jest.fn()
    ;(assignConversation as jest.Mock).mockResolvedValue({})

    renderDetail(
      <ConversationDetail
        conversationId="conv-1"
        contactName="Dana Whitfield"
        status="OPEN"
        onConversationUpdated={onConversationUpdated}
      />,
    )

    await user.click(await screen.findByRole('button', { name: 'Assign' }))
    await user.click(await screen.findByRole('button', { name: 'Casey Nguyen' }))

    await waitFor(() => {
      expect(assignConversation).toHaveBeenCalledWith('conv-1', 'agent-2')
      expect(toast.success).toHaveBeenCalledWith('Assigned to Casey Nguyen')
      expect(onConversationUpdated).toHaveBeenCalled()
    })
  })

  it('shows the current assignee name on the trigger when already assigned', async () => {
    renderDetail(
      <ConversationDetail
        conversationId="conv-1"
        contactName="Dana Whitfield"
        status="OPEN"
        assignedToUser={{ id: 'agent-2', firstName: 'Casey', lastName: 'Nguyen' }}
      />,
    )

    expect(await screen.findByRole('button', { name: /Assigned: Casey/ })).toBeInTheDocument()
  })
})
