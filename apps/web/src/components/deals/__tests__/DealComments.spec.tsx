// @ts-nocheck
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { DealComments } from '../DealComments'
import { getDealComments, addDealComment, deleteDealComment } from '@/services/deal-comment.service'
import { GraphqlSubscriptionClient } from '@/lib/graphql-subscription'
import { usePermission } from '@/hooks/usePermission'
import { useAuthStore } from '@/stores/auth.store'

jest.mock('@/services/deal-comment.service', () => ({
  getDealComments: jest.fn(),
  addDealComment: jest.fn(),
  deleteDealComment: jest.fn(),
  getDealMentionCandidates: jest.fn(),
  ON_DEAL_COMMENT_ADDED_SUBSCRIPTION:
    'subscription OnDealCommentAdded($dealId: ID!) { onDealCommentAdded(dealId: $dealId) { id } }',
}))

jest.mock('@/lib/graphql-subscription', () => ({
  GraphqlSubscriptionClient: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    subscribe: jest.fn(),
    disconnect: jest.fn(),
  })),
}))

jest.mock('@/hooks/usePermission', () => ({
  usePermission: jest.fn(() => true),
}))

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

const currentUser = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  roles: ['SALES_REP'],
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  avatar: null,
}

const mockComments = [
  {
    id: 'comment-1',
    dealId: 'deal-1',
    userId: 'user-1',
    comment: 'first comment',
    createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    author: {
      id: 'user-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      avatar: null,
    },
    mentionedUsers: [],
  },
  {
    id: 'comment-2',
    dealId: 'deal-1',
    userId: 'user-2',
    comment: 'cc @[Grace Hopper](user-2) please review',
    createdAt: new Date().toISOString(),
    author: {
      id: 'user-2',
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      avatar: null,
    },
    mentionedUsers: [
      {
        id: 'user-2',
        firstName: 'Grace',
        lastName: 'Hopper',
        email: 'grace@example.com',
        avatar: null,
      },
    ],
  },
]

function renderComments() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <DealComments dealId="deal-1" />
    </QueryClientProvider>,
  )
}

describe('DealComments', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(usePermission as jest.Mock).mockReturnValue(true)
    useAuthStore.setState({ user: currentUser })
    getDealComments.mockResolvedValue({ items: mockComments, total: 2, page: 1, pageSize: 50 })
  })

  afterEach(() => {
    act(() => {
      useAuthStore.setState({ user: null })
    })
  })

  it('renders the thread oldest-first with author names and relative timestamps', async () => {
    renderComments()

    await waitFor(() => {
      expect(screen.getByText('first comment')).toBeInTheDocument()
    })
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
    expect(screen.getByText('5 minutes ago')).toBeInTheDocument()
    expect(screen.getByText('just now')).toBeInTheDocument()
  })

  it('renders hour and day relative timestamps', async () => {
    getDealComments.mockResolvedValue({
      items: [
        {
          ...mockComments[0],
          id: 'comment-hours',
          createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        },
        {
          ...mockComments[0],
          id: 'comment-days',
          createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
      total: 2,
      page: 1,
      pageSize: 50,
    })
    renderComments()

    await waitFor(() => {
      expect(screen.getByText('3 hours ago')).toBeInTheDocument()
    })
    expect(screen.getByText('2 days ago')).toBeInTheDocument()
  })

  it('renders mention tokens as styled spans, not raw tokens', async () => {
    renderComments()

    await waitFor(() => {
      const mention = screen.getByText('@Grace Hopper')
      expect(mention.className).toMatch(/bg-\[#f0f0f3\]|bg-indigo-50/)
    })
    expect(screen.queryByText('@[Grace Hopper](user-2)')).not.toBeInTheDocument()
  })

  it('shows the delete affordance only for the callers own comments', async () => {
    renderComments()

    await waitFor(() => {
      expect(screen.getByLabelText('Delete your comment')).toBeInTheDocument()
    })
    // comment-2 belongs to user-2, so exactly one delete button exists.
    expect(screen.getAllByLabelText('Delete your comment')).toHaveLength(1)
  })

  it('deletes a comment after confirmation', async () => {
    deleteDealComment.mockResolvedValue(true)
    jest.spyOn(window, 'confirm').mockReturnValue(true)
    renderComments()

    await waitFor(() => {
      expect(screen.getByLabelText('Delete your comment')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByLabelText('Delete your comment'))

    await waitFor(() => {
      expect(deleteDealComment).toHaveBeenCalledWith('comment-1')
      expect(toast.success).toHaveBeenCalledWith('Comment deleted')
    })
  })

  it('posts a new comment from the composer and clears the draft', async () => {
    addDealComment.mockResolvedValue(mockComments[0])
    renderComments()

    await waitFor(() => {
      expect(screen.getByLabelText('Comment')).toBeInTheDocument()
    })
    const textarea = screen.getByLabelText('Comment')
    fireEvent.change(textarea, { target: { value: 'looks good to me' } })
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))

    await waitFor(() => {
      expect(addDealComment).toHaveBeenCalledWith('deal-1', 'looks good to me')
      expect(toast.success).toHaveBeenCalledWith('Comment added')
    })
    expect((screen.getByLabelText('Comment') as HTMLTextAreaElement).value).toBe('')
  })

  it('shows an error toast when posting fails', async () => {
    addDealComment.mockRejectedValue(new Error('boom'))
    renderComments()

    await waitFor(() => {
      expect(screen.getByLabelText('Comment')).toBeInTheDocument()
    })
    const textarea = screen.getByLabelText('Comment')
    fireEvent.change(textarea, { target: { value: 'will fail' } })
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to post comment')
    })
  })

  it('shows an error toast when deletion fails', async () => {
    deleteDealComment.mockRejectedValue(new Error('boom'))
    jest.spyOn(window, 'confirm').mockReturnValue(true)
    renderComments()

    await waitFor(() => {
      expect(screen.getByLabelText('Delete your comment')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByLabelText('Delete your comment'))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to delete comment')
    })
  })

  it('renders ErrorState when the thread fails to load', async () => {
    getDealComments.mockRejectedValue(new Error('Network error'))
    renderComments()

    await waitFor(() => {
      expect(screen.getByText('Failed to load comments')).toBeInTheDocument()
    })
  })

  it('does not render the composer without DEAL:UPDATE', async () => {
    ;(usePermission as jest.Mock).mockReturnValue(false)
    renderComments()

    await waitFor(() => {
      expect(screen.getByText('first comment')).toBeInTheDocument()
    })
    expect(screen.queryByLabelText('Comment')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Comment' })).not.toBeInTheDocument()
  })

  it('renders composer when there are no comments', async () => {
    getDealComments.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 })
    renderComments()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Comment' })).toBeInTheDocument()
    })
  })

  it('connects the subscription for the deal and disconnects on unmount', async () => {
    const { unmount } = renderComments()

    await waitFor(() => {
      expect(GraphqlSubscriptionClient).toHaveBeenCalledTimes(1)
    })
    const instance = (GraphqlSubscriptionClient as unknown as jest.Mock).mock.results[0]!.value
    expect(instance.connect).toHaveBeenCalled()
    expect(instance.subscribe).toHaveBeenCalledWith(
      'onDealCommentAdded',
      expect.objectContaining({
        variables: { dealId: 'deal-1' },
        query: expect.stringContaining('subscription OnDealCommentAdded'),
      }),
    )

    unmount()
    expect(instance.disconnect).toHaveBeenCalled()
  })

  it('refetches the thread when the subscription pushes a new comment', async () => {
    renderComments()

    await waitFor(() => {
      expect(getDealComments).toHaveBeenCalledTimes(1)
    })
    const instance = (GraphqlSubscriptionClient as unknown as jest.Mock).mock.results[0]!.value
    const onData = instance.subscribe.mock.calls[0]![1].onData

    onData({ id: 'comment-3' })

    await waitFor(() => {
      expect(getDealComments).toHaveBeenCalledTimes(2)
    })
  })
})
