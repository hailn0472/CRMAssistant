import { graphqlRequest } from '@/lib/graphql-client'
import { assignContactOwner, assignContactOwnerBulk, searchUsers } from '@/services/owner.service'
import type { Contact } from '@/services/contact.service'

jest.mock('@/lib/graphql-client', () => ({
  graphqlRequest: jest.fn(),
}))

const mockGraphqlRequest = graphqlRequest as jest.Mock

afterEach(() => {
  mockGraphqlRequest.mockReset()
})

const MOCK_CONTACT: Contact = {
  id: 'c1',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  company: null,
  jobTitle: null,
  ownerId: 'u1',
  owner: { id: 'u1', firstName: 'Alice', lastName: 'Johnson', email: 'alice@x.com', avatar: null },
  teamId: null,
  sharedWithMe: false,
  tags: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

describe('assignContactOwner', () => {
  it('should return the updated contact', async () => {
    mockGraphqlRequest.mockResolvedValue({ assignContactOwner: MOCK_CONTACT })
    const result = await assignContactOwner('c1', 'u2')
    expect(result.id).toBe('c1')
    expect(result.ownerId).toBe('u1')
    expect(mockGraphqlRequest).toHaveBeenCalledTimes(1)
    expect(mockGraphqlRequest).toHaveBeenCalledWith(
      expect.stringContaining('mutation AssignContactOwner'),
      { contactId: 'c1', userId: 'u2' },
    )
  })

  it('should propagate errors from graphqlRequest', async () => {
    mockGraphqlRequest.mockRejectedValue(new Error('GraphQL error'))
    await expect(assignContactOwner('c1', 'u2')).rejects.toThrow('GraphQL error')
  })
})

describe('assignContactOwnerBulk', () => {
  const BULK_RESULT = { successCount: 2, failedCount: 0, errors: [] }

  it('should return the bulk assign result', async () => {
    mockGraphqlRequest.mockResolvedValue({ assignContactOwnerBulk: BULK_RESULT })
    const result = await assignContactOwnerBulk(['c1', 'c2'], 'u2')
    expect(result.successCount).toBe(2)
    expect(result.failedCount).toBe(0)
    expect(mockGraphqlRequest).toHaveBeenCalledWith(
      expect.stringContaining('mutation AssignContactOwnerBulk'),
      { contactIds: ['c1', 'c2'], userId: 'u2' },
    )
  })

  it('should propagate errors', async () => {
    mockGraphqlRequest.mockRejectedValue(new Error('Network error'))
    await expect(assignContactOwnerBulk(['c1'], 'u2')).rejects.toThrow('Network error')
  })
})

describe('searchUsers', () => {
  const USERS = [
    { id: 'u1', firstName: 'Alice', lastName: 'Johnson', email: 'alice@x.com', avatar: null },
  ]

  it('should return users matching the search term', async () => {
    mockGraphqlRequest.mockResolvedValue({ users: { items: USERS } })
    const result = await searchUsers('alice')
    expect(result).toHaveLength(1)
    expect(result[0]!.firstName).toBe('Alice')
    expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('query SearchUsers'), {
      search: 'alice',
      limit: 20,
    })
  })

  it('should pass undefined when searchTerm is empty', async () => {
    mockGraphqlRequest.mockResolvedValue({ users: { items: [] } })
    await searchUsers('')
    expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.any(String), {
      search: undefined,
      limit: 20,
    })
  })

  it('should return empty array when no users match', async () => {
    mockGraphqlRequest.mockResolvedValue({ users: { items: [] } })
    const result = await searchUsers('zzzz')
    expect(result).toHaveLength(0)
  })

  it('should propagate errors', async () => {
    mockGraphqlRequest.mockRejectedValue(new Error('API unavailable'))
    await expect(searchUsers('test')).rejects.toThrow('API unavailable')
  })
})
