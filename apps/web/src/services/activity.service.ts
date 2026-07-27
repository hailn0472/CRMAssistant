import { graphqlRequest } from '@/lib/graphql-client'
import type { ContactTimelineResult } from '@/types/activity.types'

const TIMELINE_FIELDS = `
  edges {
    cursor
    node {
      id
      contactId
      type
      title
      description
      createdAt
      createdBy
    }
  }
  pageInfo {
    hasNextPage
    endCursor
  }
  totalCount
`

export async function fetchTimeline(
  contactId: string,
  first: number = 20,
  after?: string,
): Promise<ContactTimelineResult> {
  const data = await graphqlRequest<{ contactTimeline: ContactTimelineResult }>(
    `query ContactTimeline($contactId: ID!, $first: Int, $after: String) {
      contactTimeline(contactId: $contactId, first: $first, after: $after) {
        ${TIMELINE_FIELDS}
      }
    }`,
    { contactId, first, after },
  )

  return data.contactTimeline
}

export async function addContactNote(
  contactId: string,
  title: string,
  description?: string,
): Promise<{
  id: string
  contactId: string
  type: string
  title: string
  description: string | null
  createdAt: string
  createdBy: string
}> {
  const data = await graphqlRequest<{
    addContactNote: {
      id: string
      contactId: string
      type: string
      title: string
      description: string | null
      createdAt: string
      createdBy: string
    }
  }>(
    `mutation AddContactNote($contactId: ID!, $title: String!, $description: String) {
      addContactNote(contactId: $contactId, title: $title, description: $description) {
        id
        contactId
        type
        title
        description
        createdAt
        createdBy
      }
    }`,
    { contactId, title, description },
  )

  return data.addContactNote
}
