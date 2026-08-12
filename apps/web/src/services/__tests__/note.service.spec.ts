import { graphqlRequest } from '@/lib/graphql-client'

import { getNotes, createNote, updateNote, deleteNote, NOTE_FIELDS } from '../note.service'

jest.mock('@/lib/graphql-client', () => ({
  graphqlRequest: jest.fn(),
}))

const mockGraphqlRequest = graphqlRequest as jest.MockedFunction<typeof graphqlRequest>

describe('note.service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('NOTE_FIELDS', () => {
    it('includes author with id, firstName, lastName', () => {
      expect(NOTE_FIELDS).toContain('author')
      expect(NOTE_FIELDS).toContain('firstName')
      expect(NOTE_FIELDS).toContain('lastName')
    })

    it('includes id, body, createdAt, updatedAt, contactId, dealId, userId', () => {
      expect(NOTE_FIELDS).toContain('id')
      expect(NOTE_FIELDS).toContain('body')
      expect(NOTE_FIELDS).toContain('createdAt')
      expect(NOTE_FIELDS).toContain('updatedAt')
      expect(NOTE_FIELDS).toContain('contactId')
      expect(NOTE_FIELDS).toContain('dealId')
      expect(NOTE_FIELDS).toContain('userId')
    })
  })

  describe('getNotes', () => {
    it('calls graphqlRequest with correct operation name and unwraps response', async () => {
      const mockConnection = {
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      }
      mockGraphqlRequest.mockResolvedValue({ notes: mockConnection })

      const result = await getNotes({ contactId: 'c1' })

      expect(result).toEqual(mockConnection)
      expect(mockGraphqlRequest).toHaveBeenCalledWith(
        expect.stringContaining('query Notes'),
        expect.objectContaining({
          filter: { contactId: 'c1', dealId: undefined },
          pagination: expect.any(Object),
        }),
      )
    })

    it('passes dealId filter', async () => {
      mockGraphqlRequest.mockResolvedValue({
        notes: { items: [], total: 0, page: 1, pageSize: 20 },
      })

      await getNotes({ dealId: 'd1' })

      expect(mockGraphqlRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          filter: { contactId: undefined, dealId: 'd1' },
        }),
      )
    })

    it('passes pagination', async () => {
      mockGraphqlRequest.mockResolvedValue({
        notes: { items: [], total: 0, page: 1, pageSize: 20 },
      })

      await getNotes({ contactId: 'c1' }, { page: 2, pageSize: 10 })

      expect(mockGraphqlRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          pagination: { page: 2, pageSize: 10 },
        }),
      )
    })
  })

  describe('createNote', () => {
    it('calls graphqlRequest with correct operation name', async () => {
      const mockNote = {
        id: 'n1',
        contactId: 'c1',
        dealId: null,
        userId: 'u1',
        body: 'Hello',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        author: { id: 'u1', firstName: 'Test', lastName: 'User' },
      }
      mockGraphqlRequest.mockResolvedValue({ createNote: mockNote })

      const result = await createNote({ contactId: 'c1', body: 'Hello' })

      expect(result).toEqual(mockNote)
      expect(mockGraphqlRequest).toHaveBeenCalledWith(
        expect.stringContaining('mutation CreateNote'),
        expect.objectContaining({
          input: { contactId: 'c1', dealId: undefined, body: 'Hello' },
        }),
      )
    })
  })

  describe('updateNote', () => {
    it('calls graphqlRequest with correct operation name', async () => {
      const mockNote = {
        id: 'n1',
        contactId: 'c1',
        dealId: null,
        userId: 'u1',
        body: 'Updated',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
        author: { id: 'u1', firstName: 'Test', lastName: 'User' },
      }
      mockGraphqlRequest.mockResolvedValue({ updateNote: mockNote })

      const result = await updateNote('n1', 'Updated')

      expect(result).toEqual(mockNote)
      expect(mockGraphqlRequest).toHaveBeenCalledWith(
        expect.stringContaining('mutation UpdateNote'),
        { id: 'n1', input: { body: 'Updated' } },
      )
    })
  })

  describe('deleteNote', () => {
    it('calls graphqlRequest with correct operation name', async () => {
      mockGraphqlRequest.mockResolvedValue({ deleteNote: true })

      const result = await deleteNote('n1')

      expect(result).toBe(true)
      expect(mockGraphqlRequest).toHaveBeenCalledWith(
        expect.stringContaining('mutation DeleteNote'),
        { id: 'n1' },
      )
    })
  })
})
