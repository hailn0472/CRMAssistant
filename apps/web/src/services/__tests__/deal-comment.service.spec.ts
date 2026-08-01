import {
  getDealComments,
  addDealComment,
  deleteDealComment,
  getDealMentionCandidates,
  ON_DEAL_COMMENT_ADDED_SUBSCRIPTION,
} from '../deal-comment.service'

const mockFetch = jest.fn()

global.fetch = mockFetch

const mockComment = {
  id: 'comment-1',
  dealId: 'deal-1',
  userId: 'user-1',
  comment: 'cc @[Grace Hopper](user-2)',
  createdAt: '2026-07-31T00:00:00.000Z',
  author: { id: 'user-1', firstName: 'Ada', lastName: 'Lovelace', email: 'a@b.c', avatar: null },
  mentionedUsers: [
    { id: 'user-2', firstName: 'Grace', lastName: 'Hopper', email: 'g@b.c', avatar: null },
  ],
}

describe('deal-comment.service', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('fetches the comment connection for a deal', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: { dealComments: { items: [mockComment], total: 1, page: 1, pageSize: 50 } },
      }),
    })

    const result = await getDealComments('deal-1')

    expect(result.total).toBe(1)
    expect(result.items[0]!.mentionedUsers[0]!.id).toBe('user-2')
    const callBody = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)
    expect(callBody.variables).toEqual({
      dealId: 'deal-1',
      pagination: { page: undefined, pageSize: undefined },
    })
  })

  it('passes pagination through to the query', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: { dealComments: { items: [], total: 0, page: 2, pageSize: 25 } },
      }),
    })

    await getDealComments('deal-1', { page: 2, pageSize: 25 })

    const callBody = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)
    expect(callBody.variables.pagination).toEqual({ page: 2, pageSize: 25 })
  })

  it('adds a comment with the input mutation', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ data: { addDealComment: mockComment } }),
    })

    const result = await addDealComment('deal-1', 'cc @[Grace Hopper](user-2)')

    expect(result.id).toBe('comment-1')
    const callBody = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)
    expect(callBody.query).toContain('mutation AddDealComment')
    expect(callBody.variables).toEqual({
      input: { dealId: 'deal-1', comment: 'cc @[Grace Hopper](user-2)' },
    })
  })

  it('deletes a comment', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ data: { deleteDealComment: true } }),
    })

    const result = await deleteDealComment('comment-1')

    expect(result).toBe(true)
    const callBody = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)
    expect(callBody.query).toContain('mutation DeleteDealComment')
    expect(callBody.variables).toEqual({ id: 'comment-1' })
  })

  it('fetches mention candidates with an optional search term', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: { dealMentionCandidates: [mockComment.author] },
      }),
    })

    const result = await getDealMentionCandidates('deal-1', 'Gra')

    expect(result).toHaveLength(1)
    const callBody = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)
    expect(callBody.query).toContain('dealMentionCandidates')
    expect(callBody.variables).toEqual({ dealId: 'deal-1', search: 'Gra' })
  })

  it('omits the search variable when no search term is given', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ data: { dealMentionCandidates: [] } }),
    })

    await getDealMentionCandidates('deal-1')

    const callBody = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)
    expect(callBody.variables).toEqual({ dealId: 'deal-1', search: undefined })
  })

  it('defines the subscription document with the comment fields', () => {
    expect(ON_DEAL_COMMENT_ADDED_SUBSCRIPTION).toContain('subscription OnDealCommentAdded')
    expect(ON_DEAL_COMMENT_ADDED_SUBSCRIPTION).toContain('onDealCommentAdded(dealId: $dealId)')
    expect(ON_DEAL_COMMENT_ADDED_SUBSCRIPTION).toContain(
      'mentionedUsers { id firstName lastName email avatar }',
    )
  })
})
