import { graphqlRequest } from '@/lib/graphql-client'
import { fetchTimeline, addContactNote } from '@/services/activity.service'

jest.mock('@/lib/graphql-client', () => ({
  graphqlRequest: jest.fn(),
}))

const mockGraphqlRequest = graphqlRequest as jest.Mock

afterEach(() => {
  mockGraphqlRequest.mockReset()
})

describe('fetchTimeline', () => {
  const MOCK_TIMELINE = {
    edges: [
      {
        cursor: 'cursor-1',
        node: {
          id: 'a1',
          contactId: 'c1',
          type: 'NOTE_ADDED',
          title: 'Note',
          description: 'Test note',
          createdAt: '2026-01-01T00:00:00Z',
          createdBy: 'u1',
        },
      },
    ],
    pageInfo: { hasNextPage: false, endCursor: 'cursor-1' },
    totalCount: 1,
  }

  it('should return timeline with default pagination', async () => {
    mockGraphqlRequest.mockResolvedValue({ contactTimeline: MOCK_TIMELINE })
    const result = await fetchTimeline('c1')
    expect(result.totalCount).toBe(1)
    expect(result.edges).toHaveLength(1)
    expect(mockGraphqlRequest).toHaveBeenCalledWith(
      expect.stringContaining('query ContactTimeline'),
      { contactId: 'c1', first: 20, after: undefined },
    )
  })

  it('should pass cursor when provided', async () => {
    mockGraphqlRequest.mockResolvedValue({ contactTimeline: MOCK_TIMELINE })
    await fetchTimeline('c1', 10, 'cursor-0')
    expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.any(String), {
      contactId: 'c1',
      first: 10,
      after: 'cursor-0',
    })
  })

  it('should propagate errors', async () => {
    mockGraphqlRequest.mockRejectedValue(new Error('Query failed'))
    await expect(fetchTimeline('c1')).rejects.toThrow('Query failed')
  })
})

describe('addContactNote', () => {
  const MOCK_NOTE = {
    id: 'n1',
    contactId: 'c1',
    type: 'NOTE_ADDED',
    title: 'Test',
    description: 'Desc',
    createdAt: '2026-01-01T00:00:00Z',
    createdBy: 'u1',
  }

  it('should return the created note', async () => {
    mockGraphqlRequest.mockResolvedValue({ addContactNote: MOCK_NOTE })
    const result = await addContactNote('c1', 'Test', 'Desc')
    expect(result.id).toBe('n1')
    expect(result.title).toBe('Test')
    expect(mockGraphqlRequest).toHaveBeenCalledWith(
      expect.stringContaining('mutation AddContactNote'),
      { contactId: 'c1', title: 'Test', description: 'Desc' },
    )
  })

  it('should work without description', async () => {
    mockGraphqlRequest.mockResolvedValue({ addContactNote: MOCK_NOTE })
    await addContactNote('c1', 'Test')
    expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.any(String), {
      contactId: 'c1',
      title: 'Test',
      description: undefined,
    })
  })

  it('should propagate errors', async () => {
    mockGraphqlRequest.mockRejectedValue(new Error('Mutation failed'))
    await expect(addContactNote('c1', 'Test')).rejects.toThrow('Mutation failed')
  })
})
