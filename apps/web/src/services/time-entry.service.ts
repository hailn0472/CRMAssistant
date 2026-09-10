import { graphqlRequest } from '@/lib/graphql-client'

// ─── Types ───────────────────────────────────────────────────────────────────

export type TimeEntry = {
  id: string
  taskId: string
  userId: string
  startTime: string
  endTime: string | null
  durationSeconds: number
  description: string | null
  createdAt: string
  updatedAt: string
  task: { id: string; title: string }
}

export type TimeEntryConnection = {
  items: TimeEntry[]
  total: number
  page: number
  pageSize: number
}

export type TimeEntryFilter = {
  taskId?: string
  userId?: string
  startFrom?: string
  startTo?: string
  runningOnly?: boolean
}

export type TimeEntryPagination = {
  page?: number
  pageSize?: number
}

export type CreateTimeEntryInput = {
  taskId: string
  durationSeconds: number
  description?: string | null
  startTime?: string
}

export type UpdateTimeEntryInput = {
  durationSeconds?: number
  description?: string | null
  startTime?: string
}

// ─── GraphQL documents ────────────────────────────────────────────────────────

// There is no GraphQL codegen and no Apollo Client — a field you forget to
// add to this fragment is silently undefined at runtime
// (docs/project-context.md:64-67). Keep in sync with the TimeEntry ref in
// apps/api/src/time-tracking/time-tracking.graphql.ts.
const TIME_ENTRY_FIELDS = `
  id
  taskId
  userId
  startTime
  endTime
  durationSeconds
  description
  createdAt
  updatedAt
  task { id title }
`

export async function getTimeEntries(
  filter: TimeEntryFilter = {},
  pagination?: TimeEntryPagination,
): Promise<TimeEntryConnection> {
  const data = await graphqlRequest<{ timeEntries: TimeEntryConnection }>(
    `query TimeEntries($filter: TimeEntryFilterInput, $pagination: TimeEntryPaginationInput) {
      timeEntries(filter: $filter, pagination: $pagination) {
        items { ${TIME_ENTRY_FIELDS} }
        total
        page
        pageSize
      }
    }`,
    {
      filter: {
        taskId: filter.taskId ?? null,
        userId: filter.userId ?? null,
        startFrom: filter.startFrom ?? null,
        startTo: filter.startTo ?? null,
        runningOnly: filter.runningOnly ?? null,
      },
      pagination: pagination ?? null,
    },
  )
  return data.timeEntries
}

export async function getActiveTimeEntry(): Promise<TimeEntry | null> {
  const data = await graphqlRequest<{ activeTimeEntry: TimeEntry | null }>(
    `query ActiveTimeEntry {
      activeTimeEntry {
        ${TIME_ENTRY_FIELDS}
      }
    }`,
    {},
  )
  return data.activeTimeEntry
}

export async function startTimer(taskId: string): Promise<TimeEntry> {
  const data = await graphqlRequest<{ startTimer: TimeEntry }>(
    `mutation StartTimer($taskId: ID!) {
      startTimer(taskId: $taskId) {
        ${TIME_ENTRY_FIELDS}
      }
    }`,
    { taskId },
  )
  return data.startTimer
}

export async function stopTimer(timeEntryId: string): Promise<TimeEntry> {
  const data = await graphqlRequest<{ stopTimer: TimeEntry }>(
    `mutation StopTimer($timeEntryId: ID!) {
      stopTimer(timeEntryId: $timeEntryId) {
        ${TIME_ENTRY_FIELDS}
      }
    }`,
    { timeEntryId },
  )
  return data.stopTimer
}

export async function createTimeEntry(input: CreateTimeEntryInput): Promise<TimeEntry> {
  const data = await graphqlRequest<{ createTimeEntry: TimeEntry }>(
    `mutation CreateTimeEntry($input: CreateTimeEntryInput!) {
      createTimeEntry(input: $input) {
        ${TIME_ENTRY_FIELDS}
      }
    }`,
    {
      input: {
        taskId: input.taskId,
        durationSeconds: input.durationSeconds,
        description: input.description ?? null,
        startTime: input.startTime ?? null,
      },
    },
  )
  return data.createTimeEntry
}

export async function updateTimeEntry(id: string, input: UpdateTimeEntryInput): Promise<TimeEntry> {
  const data = await graphqlRequest<{ updateTimeEntry: TimeEntry }>(
    `mutation UpdateTimeEntry($id: ID!, $input: UpdateTimeEntryInput!) {
      updateTimeEntry(id: $id, input: $input) {
        ${TIME_ENTRY_FIELDS}
      }
    }`,
    {
      id,
      input: {
        durationSeconds: input.durationSeconds ?? null,
        description: input.description ?? null,
        startTime: input.startTime ?? null,
      },
    },
  )
  return data.updateTimeEntry
}

export async function deleteTimeEntry(id: string): Promise<boolean> {
  const data = await graphqlRequest<{ deleteTimeEntry: boolean }>(
    `mutation DeleteTimeEntry($id: ID!) {
      deleteTimeEntry(id: $id)
    }`,
    { id },
  )
  return data.deleteTimeEntry
}
