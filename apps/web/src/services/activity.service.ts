import { graphqlRequest } from '@/lib/graphql-client'
import type { ContactTimelineResult } from '@/types/activity.types'

// Story 4.2: `source` must be listed here — there is no GraphQL codegen in
// this workspace; every document is a hand-written template literal, and a
// field missing from TIMELINE_FIELDS is silently undefined at runtime (AC 47).
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
      source
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
  source: string | null
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
      source: string | null
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
        source
      }
    }`,
    { contactId, title, description },
  )

  return data.addContactNote
}

// ─── Activity log preferences (Story 4.2, AC 37) ──────────────────────────

export type ActivityLogPreference = {
  logTaskCompleted: boolean
  logDealCreated: boolean
  logDealStageChanged: boolean
  logMessageSent: boolean
  logMessageReceived: boolean
  logMeetingScheduled: boolean
}

export type UpdateActivityLogPreferenceInput = Partial<ActivityLogPreference>

const ACTIVITY_LOG_PREFERENCE_FIELDS = `
  logTaskCompleted
  logDealCreated
  logDealStageChanged
  logMessageSent
  logMessageReceived
  logMeetingScheduled
`

export async function getMyActivityLogPreferences(): Promise<ActivityLogPreference> {
  const data = await graphqlRequest<{ myActivityLogPreferences: ActivityLogPreference }>(
    `query MyActivityLogPreferences {
      myActivityLogPreferences { ${ACTIVITY_LOG_PREFERENCE_FIELDS} }
    }`,
    {},
  )
  return data.myActivityLogPreferences
}

export async function updateActivityLogPreferences(
  input: UpdateActivityLogPreferenceInput,
): Promise<ActivityLogPreference> {
  const data = await graphqlRequest<{
    updateActivityLogPreferences: ActivityLogPreference
  }>(
    `mutation UpdateActivityLogPreferences($input: UpdateActivityLogPreferenceInput!) {
      updateActivityLogPreferences(input: $input) { ${ACTIVITY_LOG_PREFERENCE_FIELDS} }
    }`,
    { input },
  )
  return data.updateActivityLogPreferences
}
