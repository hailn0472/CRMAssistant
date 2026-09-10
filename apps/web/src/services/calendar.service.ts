import { graphqlRequest } from '@/lib/graphql-client'

// Story 4.3 calendar service. There is no GraphQL codegen and no Apollo
// Client in this workspace — every document is a hand-written template
// literal, response types are hand-declared, and a field you forget to add
// to CALENDAR_CONNECTION_FIELDS is silently `undefined` at runtime (AC 44).

export type CalendarProvider = 'GOOGLE' | 'OUTLOOK'

export type CalendarConnection = {
  id: string
  provider: CalendarProvider
  externalAccountEmail: string | null
  calendarId: string
  status: string
  lastSyncedAt: string | null
  lastSyncError: string | null
  createdAt: string
}

export type CalendarAuthUrl = {
  url: string
  state: string
}

export type TaskCalendarSync = {
  taskId: string
  syncStatus: 'PENDING' | 'SYNCED' | 'FAILED'
  lastError: string | null
  externalEventId: string | null
  lastSyncedAt: string | null
  nextAttemptAt: string | null
  provider: CalendarProvider | null
  conflictSummary: string | null
}

export const CALENDAR_PROVIDERS: CalendarProvider[] = ['GOOGLE', 'OUTLOOK']

// The ref exposes exactly these fields (AC 33) — never tokens or syncToken.
const CALENDAR_CONNECTION_FIELDS = `
  id
  provider
  externalAccountEmail
  calendarId
  status
  lastSyncedAt
  lastSyncError
  createdAt
`

const TASK_CALENDAR_SYNC_FIELDS = `
  taskId
  syncStatus
  lastError
  externalEventId
  lastSyncedAt
  nextAttemptAt
  provider
  conflictSummary
`

function assertData<T>(data: T | null | undefined, name: string): T {
  if (data == null) throw new Error(`CalendarService: ${name} returned null`)
  return data
}

export async function getCalendarConnections(): Promise<CalendarConnection[]> {
  const data = await graphqlRequest<{ calendarConnections: CalendarConnection[] }>(
    `query CalendarConnections {
      calendarConnections { ${CALENDAR_CONNECTION_FIELDS} }
    }`,
    {},
  )
  return assertData(data.calendarConnections, 'calendarConnections')
}

export async function getCalendarAuthUrl(provider: CalendarProvider): Promise<CalendarAuthUrl> {
  const data = await graphqlRequest<{ calendarAuthUrl: CalendarAuthUrl }>(
    `query CalendarAuthUrl($provider: CalendarProvider!) {
      calendarAuthUrl(provider: $provider) { url state }
    }`,
    { provider },
  )
  return assertData(data.calendarAuthUrl, 'calendarAuthUrl')
}

export async function connectCalendar(input: {
  provider: CalendarProvider
  authCode: string
  state: string
}): Promise<CalendarConnection> {
  const data = await graphqlRequest<{ connectCalendar: CalendarConnection }>(
    `mutation ConnectCalendar($input: ConnectCalendarInput!) {
      connectCalendar(input: $input) { ${CALENDAR_CONNECTION_FIELDS} }
    }`,
    { input },
  )
  return assertData(data.connectCalendar, 'connectCalendar')
}

export async function disconnectCalendar(provider: CalendarProvider): Promise<boolean> {
  const data = await graphqlRequest<{ disconnectCalendar: boolean }>(
    `mutation DisconnectCalendar($provider: CalendarProvider!) {
      disconnectCalendar(provider: $provider)
    }`,
    { provider },
  )
  if (data.disconnectCalendar == null) {
    throw new Error('CalendarService: disconnectCalendar returned null')
  }
  return data.disconnectCalendar
}

export async function syncCalendar(provider: CalendarProvider): Promise<boolean> {
  const data = await graphqlRequest<{ syncCalendar: boolean }>(
    `mutation SyncCalendar($provider: CalendarProvider!) {
      syncCalendar(provider: $provider)
    }`,
    { provider },
  )
  if (data.syncCalendar == null) {
    throw new Error('CalendarService: syncCalendar returned null')
  }
  return data.syncCalendar
}

export async function getTaskCalendarSync(taskId: string): Promise<TaskCalendarSync | null> {
  const data = await graphqlRequest<{ taskCalendarSync: TaskCalendarSync | null }>(
    `query TaskCalendarSync($taskId: ID!) {
      taskCalendarSync(taskId: $taskId) { ${TASK_CALENDAR_SYNC_FIELDS} }
    }`,
    { taskId },
  )
  return data.taskCalendarSync ?? null
}

export async function syncTaskToCalendar(taskId: string): Promise<TaskCalendarSync> {
  const data = await graphqlRequest<{ syncTaskToCalendar: TaskCalendarSync }>(
    `mutation SyncTaskToCalendar($taskId: ID!) {
      syncTaskToCalendar(taskId: $taskId) { ${TASK_CALENDAR_SYNC_FIELDS} }
    }`,
    { taskId },
  )
  return assertData(data.syncTaskToCalendar, 'syncTaskToCalendar')
}
