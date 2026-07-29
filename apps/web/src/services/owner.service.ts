import { graphqlRequest } from '@/lib/graphql-client'
import type { Contact } from '@/services/contact.service'

export type BulkAssignResult = {
  successCount: number
  failedCount: number
  errors: Array<{ contactId: string; error: string }>
}

const OWNER_FIELDS = `
  id
  ownerId
  owner { id firstName lastName email avatar }
  teamId
`

/**
 * Assign a new owner to a single contact.
 */
export async function assignContactOwner(contactId: string, userId: string): Promise<Contact> {
  const data = await graphqlRequest<{ assignContactOwner: Contact }>(
    `mutation AssignContactOwner($contactId: ID!, $userId: ID!) {
      assignContactOwner(contactId: $contactId, userId: $userId) {
        ${OWNER_FIELDS}
      }
    }`,
    { contactId, userId },
  )
  return data.assignContactOwner
}

/**
 * Assign a new owner to multiple contacts in bulk.
 */
export async function assignContactOwnerBulk(
  contactIds: string[],
  userId: string,
): Promise<BulkAssignResult> {
  const data = await graphqlRequest<{ assignContactOwnerBulk: BulkAssignResult }>(
    `mutation AssignContactOwnerBulk($contactIds: [ID!]!, $userId: ID!) {
      assignContactOwnerBulk(contactIds: $contactIds, userId: $userId) {
        successCount
        failedCount
        errors { contactId error }
      }
    }`,
    { contactIds, userId },
  )
  return data.assignContactOwnerBulk
}

export type UserSearchResult = {
  id: string
  firstName: string
  lastName: string
  email: string
  avatar?: string | null
}

/**
 * Search for users within the current tenant (for owner picker).
 */
export async function searchUsers(searchTerm: string): Promise<UserSearchResult[]> {
  const data = await graphqlRequest<{ users: { items: UserSearchResult[] } }>(
    `query SearchUsers($search: String, $limit: Int) {
      users(filter: { search: $search }, pagination: { pageSize: $limit }) {
        items {
          id
          firstName
          lastName
          email
          avatar
        }
      }
    }`,
    { search: searchTerm || undefined, limit: 20 },
  )
  return data.users.items
}
