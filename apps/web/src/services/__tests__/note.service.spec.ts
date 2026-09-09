import { createNote, deleteNote, getNotes, updateNote, type Note } from '../note.service'
import { graphqlRequest } from '@/lib/graphql-client'

jest.mock('@/lib/graphql-client', () => ({
  graphqlRequest: jest.fn(),
}))

const mockGraphqlRequest = graphqlRequest as jest.Mock

const note: Note = {
  id: 'note-1',
  contactId: 'contact-1',
  userId: 'user-1',
  body: 'Discussed renewal timeline.',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  author: { id: 'user-1', firstName: 'Ada', lastName: 'Lovelace' },
}

const notes = {
  items: [note],
  total: 1,
  page: 1,
  pageSize: 20,
}

describe('note.service', () => {
  beforeEach(() => {
    mockGraphqlRequest.mockReset()
  })

  it('gets notes with undefined pagination defaults', async () => {
    mockGraphqlRequest.mockResolvedValue({ notes })

    await expect(getNotes('contact-1')).resolves.toEqual(notes)

    expect(mockGraphqlRequest).toHaveBeenCalledWith(
      expect.stringContaining('query Notes($contactId: ID!, $pagination: NotePaginationInput)'),
      {
        contactId: 'contact-1',
        pagination: { page: undefined, pageSize: undefined },
      },
    )
    expect(mockGraphqlRequest.mock.calls[0][0]).toContain('items {')
    expect(mockGraphqlRequest.mock.calls[0][0]).toContain('author { id firstName lastName }')
  })

  it('passes explicit note pagination values through unchanged', async () => {
    mockGraphqlRequest.mockResolvedValue({ notes })

    await getNotes('contact-1', { page: 3, pageSize: 10 })

    expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('notes('), {
      contactId: 'contact-1',
      pagination: { page: 3, pageSize: 10 },
    })
  })

  it('creates a note and returns the created note', async () => {
    mockGraphqlRequest.mockResolvedValue({ createNote: note })

    await expect(
      createNote({ contactId: 'contact-1', body: '  New note body  ' }),
    ).resolves.toEqual(note)

    expect(mockGraphqlRequest).toHaveBeenCalledWith(
      expect.stringContaining('mutation CreateNote($input: CreateNoteInput!)'),
      { input: { contactId: 'contact-1', body: '  New note body  ' } },
    )
  })

  it('updates a note by id and body', async () => {
    const updatedNote = { ...note, body: 'Updated note body.' }
    mockGraphqlRequest.mockResolvedValue({ updateNote: updatedNote })

    await expect(updateNote('note-1', 'Updated note body.')).resolves.toEqual(updatedNote)

    expect(mockGraphqlRequest).toHaveBeenCalledWith(
      expect.stringContaining('mutation UpdateNote($id: String!, $input: UpdateNoteInput!)'),
      { id: 'note-1', input: { body: 'Updated note body.' } },
    )
  })

  it('deletes a note and returns the GraphQL boolean result', async () => {
    mockGraphqlRequest.mockResolvedValue({ deleteNote: false })

    await expect(deleteNote('note-1')).resolves.toBe(false)

    expect(mockGraphqlRequest).toHaveBeenCalledWith(
      expect.stringContaining('mutation DeleteNote($id: String!)'),
      { id: 'note-1' },
    )
  })
})
