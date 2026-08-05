import { graphqlRequest } from '@/lib/graphql-client'
import type { ContactTimelineResult } from '@/types/activity.types'
import type {
  ActivityFeedFilter,
  ActivityFeedPage,
  ActivityFeedStats,
} from '@/types/activity.types'
import { TASK_FIELDS } from '@/services/task.service'

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

// ─── Story 4.4: tenant-wide feed (AC 7, 10, 11, 36) ───────────────────────

// 🚨 No GraphQL codegen — every field used by the views MUST be listed here;
// a field missing from this fragment is silently undefined at runtime (the
// exact trap documented at the top of this file for `source`).
export const ACTIVITY_FEED_FIELDS = `
  id
  contactId
  type
  title
  description
  createdAt
  createdBy
  source
  sourceId
  contact { id firstName lastName }
`

export async function fetchActivityFeed(
  filter: ActivityFeedFilter = {},
  page = 1,
  pageSize = 20,
): Promise<ActivityFeedPage> {
  const data = await graphqlRequest<{ activityFeed: ActivityFeedPage }>(
    `query ActivityFeed($filter: ActivityFeedFilterInput, $pagination: ActivityFeedPaginationInput) {
      activityFeed(filter: $filter, pagination: $pagination) {
        total
        page
        pageSize
        items { ${ACTIVITY_FEED_FIELDS} }
      }
    }`,
    { filter: filter ?? undefined, pagination: { page, pageSize } },
  )
  return data.activityFeed
}

export async function fetchActivityFeedStats(): Promise<ActivityFeedStats> {
  const data = await graphqlRequest<{ activityFeedStats: ActivityFeedStats }>(
    `query ActivityFeedStats {
      activityFeedStats { todayCount weekCount tasksDueToday overdueTasks }
    }`,
    {},
  )
  return data.activityFeedStats
}

// Story 4.4 (AC 14/36): tenant-wide subscriptions, both visibility-filtered
// server-side inside `subscribe`. onTaskChanged reuses the exported task
// field list so the two subscription documents cannot drift.
export const ON_TASK_CHANGED_SUBSCRIPTION = `subscription OnTaskChanged {
  onTaskChanged {
    ${TASK_FIELDS}
  }
}`

export const ON_ACTIVITY_LOGGED_SUBSCRIPTION = `subscription OnActivityLogged {
  onActivityLogged {
    ${ACTIVITY_FEED_FIELDS}
  }
}`
