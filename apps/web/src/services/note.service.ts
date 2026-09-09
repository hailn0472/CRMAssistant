import { graphqlRequest } from '@/lib/graphql-client'

export type NoteAuthor = {
  id: string
  firstName: string
  lastName: string
}

export type Note = {
  id: string
  contactId: string
  userId: string
  body: string
  createdAt: string
  updatedAt: string
  author: NoteAuthor
}

export type NoteConnection = {
  items: Note[]
  total: number
  page: number
  pageSize: number
}

export type NoteFormData = {
  body: string
}

/**
 * Keep NOTE_FIELDS in lockstep with NoteRef / NOTE_SELECT.
 * A field missing from this fragment is silently undefined at runtime —
 * there is no GraphQL codegen (activity.service.ts:10-12).
 */
export const NOTE_FIELDS = `
  id
  contactId
  userId
  body
  createdAt
  updatedAt
  author { id firstName lastName }
`

export async function getNotes(
  contactId: string,
  pagination: { page?: number; pageSize?: number } = {},
): Promise<NoteConnection> {
  const data = await graphqlRequest<{ notes: NoteConnection }>(
    `query Notes($contactId: ID!, $pagination: NotePaginationInput) {
      notes(contactId: $contactId, pagination: $pagination) {
        total
        page
        pageSize
        items { ${NOTE_FIELDS} }
      }
    }`,
    {
      contactId,
      pagination: {
        page: pagination.page ?? undefined,
        pageSize: pagination.pageSize ?? undefined,
      },
    },
  )
  return data.notes
}

export async function createNote(input: { contactId: string; body: string }): Promise<Note> {
  const data = await graphqlRequest<{ createNote: Note }>(
    `mutation CreateNote($input: CreateNoteInput!) {
      createNote(input: $input) { ${NOTE_FIELDS} }
    }`,
    {
      input: {
        contactId: input.contactId,
        body: input.body,
      },
    },
  )
  return data.createNote
}

export async function updateNote(id: string, body: string): Promise<Note> {
  const data = await graphqlRequest<{ updateNote: Note }>(
    `mutation UpdateNote($id: String!, $input: UpdateNoteInput!) {
      updateNote(id: $id, input: $input) { ${NOTE_FIELDS} }
    }`,
    { id, input: { body } },
  )
  return data.updateNote
}

export async function deleteNote(id: string): Promise<boolean> {
  const data = await graphqlRequest<{ deleteNote: boolean }>(
    `mutation DeleteNote($id: String!) {
      deleteNote(id: $id)
    }`,
    { id },
  )
  return data.deleteNote
}
