import { graphqlRequest } from '@/lib/graphql-client'
import {
  fetchTimeline,
  addContactNote,
  fetchActivityFeed,
  fetchActivityFeedStats,
  ACTIVITY_FEED_FIELDS,
  ON_TASK_CHANGED_SUBSCRIPTION,
  ON_ACTIVITY_LOGGED_SUBSCRIPTION,
} from '@/services/activity.service'

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

// ─── Story 4.4: tenant-wide feed (AC 36) ──────────────────────────────────

const MOCK_FEED_PAGE = {
  items: [
    {
      id: 'act-1',
      contactId: 'c1',
      type: 'CALL_MADE',
      title: 'Called Alice',
      description: null,
      createdAt: '2026-08-05T10:00:00.000Z',
      createdBy: 'u1',
      source: 'TASK',
      sourceId: 'task-9',
      contact: { id: 'c1', firstName: 'Alice', lastName: 'One' },
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
}

describe('fetchActivityFeed (Story 4.4, AC 36)', () => {
  it('returns the feed page with default pagination', async () => {
    mockGraphqlRequest.mockResolvedValue({ activityFeed: MOCK_FEED_PAGE })
    const result = await fetchActivityFeed()

    expect(result.total).toBe(1)
    expect(result.items[0]!.sourceId).toBe('task-9')
    expect(result.items[0]!.contact).toMatchObject({ firstName: 'Alice' })
    expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('query ActivityFeed'), {
      filter: {},
      pagination: { page: 1, pageSize: 20 },
    })
  })

  it('passes the filter and pagination through', async () => {
    mockGraphqlRequest.mockResolvedValue({ activityFeed: MOCK_FEED_PAGE })
    await fetchActivityFeed({ type: 'CALL_MADE', search: 'alice' }, 3, 50)

    expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.any(String), {
      filter: { type: 'CALL_MADE', search: 'alice' },
      pagination: { page: 3, pageSize: 50 },
    })
  })

  it('propagates errors', async () => {
    mockGraphqlRequest.mockRejectedValue(new Error('Feed failed'))
    await expect(fetchActivityFeed()).rejects.toThrow('Feed failed')
  })
})

describe('fetchActivityFeedStats (Story 4.4, AC 11/36)', () => {
  it('returns the composed counters', async () => {
    mockGraphqlRequest.mockResolvedValue({
      activityFeedStats: { todayCount: 2, weekCount: 9, tasksDueToday: 3, overdueTasks: 4 },
    })
    const result = await fetchActivityFeedStats()

    expect(result).toEqual({ todayCount: 2, weekCount: 9, tasksDueToday: 3, overdueTasks: 4 })
    expect(mockGraphqlRequest).toHaveBeenCalledWith(
      expect.stringContaining('query ActivityFeedStats'),
      {},
    )
  })

  it('propagates errors', async () => {
    mockGraphqlRequest.mockRejectedValue(new Error('Stats failed'))
    await expect(fetchActivityFeedStats()).rejects.toThrow('Stats failed')
  })
})

describe('Story 4.4 document constants (AC 36)', () => {
  it('ACTIVITY_FEED_FIELDS covers every field the feed views render', () => {
    for (const field of [
      'id',
      'contactId',
      'type',
      'title',
      'description',
      'createdAt',
      'createdBy',
      'source',
      'sourceId',
      'contact { id firstName lastName }',
    ]) {
      expect(ACTIVITY_FEED_FIELDS).toContain(field)
    }
  })

  it('exports both subscription documents', () => {
    expect(ON_TASK_CHANGED_SUBSCRIPTION).toContain('subscription OnTaskChanged')
    expect(ON_TASK_CHANGED_SUBSCRIPTION).toContain('onTaskChanged')
    expect(ON_ACTIVITY_LOGGED_SUBSCRIPTION).toContain('subscription OnActivityLogged')
    expect(ON_ACTIVITY_LOGGED_SUBSCRIPTION).toContain('onActivityLogged')
    expect(ON_ACTIVITY_LOGGED_SUBSCRIPTION).toContain(ACTIVITY_FEED_FIELDS)
  })
})
