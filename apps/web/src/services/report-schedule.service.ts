/**
 * Story 6.5 — Scheduled Report Delivery frontend service.
 * Hand-written GraphQL service over graphqlRequest (no Apollo, no codegen).
 * Query keys rooted at ['reportSchedules'].
 */
import { graphqlRequest } from '@/lib/graphql-client'

// ─── Enums & Vocabularies ──────────────────────────────────────

export type ReportScheduleFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'CUSTOM_CRON'

export type ReportDeliveryFormat = 'PDF' | 'EXCEL' | 'CSV'

export type ReportScheduleExecutionStatus = 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'SKIPPED'

// ─── Data Types ───────────────────────────────────────────────

export type ReportScheduleReport = {
  id: string
  name: string
  type: string
}

export type ReportScheduleExecution = {
  id: string
  status: ReportScheduleExecutionStatus
  scheduledFor: string
  attemptCount: number
  nextRetryAt: string | null
  completedAt: string | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
}

export type ReportSchedule = {
  id: string
  reportId: string
  report: ReportScheduleReport
  frequency: ReportScheduleFrequency
  recipients: string[]
  format: ReportDeliveryFormat
  timezone: string
  scheduledTime: string
  dayOfWeek: number | null
  dayOfMonth: number | null
  startMonth: number | null
  cronExpression: string | null
  nextRunAt: string
  lastRunAt: string | null
  isActive: boolean
  lastExecution: ReportScheduleExecution | null
  createdAt: string
  updatedAt: string
}

export type ReportScheduleConnection = {
  items: ReportSchedule[]
  total: number
  page: number
  pageSize: number
}

// ─── Input Types ──────────────────────────────────────────────

export type ScheduleReportInput = {
  reportId: string
  frequency: ReportScheduleFrequency
  recipients: string[]
  format: ReportDeliveryFormat
  timezone: string
  scheduledTime: string
  dayOfWeek?: number | null
  dayOfMonth?: number | null
  startMonth?: number | null
  cronExpression?: string | null
}

export type UpdateReportScheduleInput = {
  frequency?: ReportScheduleFrequency
  recipients?: string[]
  format?: ReportDeliveryFormat
  timezone?: string
  scheduledTime?: string
  dayOfWeek?: number | null
  dayOfMonth?: number | null
  startMonth?: number | null
  cronExpression?: string | null
}

export type ReportSchedulesPaginationInput = {
  page?: number
  pageSize?: number
}

// ─── TanStack Query Key Factories ─────────────────────────────

export const reportScheduleKeys = {
  all: ['reportSchedules'] as const,
  lists: () => [...reportScheduleKeys.all, 'list'] as const,
  list: (params?: { page?: number; pageSize?: number; includeInactive?: boolean }) =>
    [...reportScheduleKeys.lists(), params] as const,
}

// ─── GraphQL Fragments & Documents ────────────────────────────

const REPORT_SCHEDULE_FIELDS = `
  id
  reportId
  report {
    id
    name
    type
  }
  frequency
  recipients
  format
  timezone
  scheduledTime
  dayOfWeek
  dayOfMonth
  startMonth
  cronExpression
  nextRunAt
  lastRunAt
  isActive
  lastExecution {
    id
    status
    scheduledFor
    attemptCount
    nextRetryAt
    completedAt
    errorCode
    errorMessage
    createdAt
  }
  createdAt
  updatedAt
`

const REPORT_SCHEDULES_QUERY = `
  query ReportSchedules($pagination: ReportSchedulesPaginationInput, $includeInactive: Boolean) {
    reportSchedules(pagination: $pagination, includeInactive: $includeInactive) {
      items {
        ${REPORT_SCHEDULE_FIELDS}
      }
      total
      page
      pageSize
    }
  }
`

const SCHEDULE_REPORT_MUTATION = `
  mutation ScheduleReport($input: ScheduleReportInput!) {
    scheduleReport(input: $input) {
      ${REPORT_SCHEDULE_FIELDS}
    }
  }
`

const UPDATE_SCHEDULE_MUTATION = `
  mutation UpdateSchedule($id: ID!, $input: UpdateReportScheduleInput!) {
    updateSchedule(id: $id, input: $input) {
      ${REPORT_SCHEDULE_FIELDS}
    }
  }
`

const DELETE_SCHEDULE_MUTATION = `
  mutation DeleteSchedule($id: ID!) {
    deleteSchedule(id: $id)
  }
`

const PAUSE_SCHEDULE_MUTATION = `
  mutation PauseSchedule($id: ID!) {
    pauseSchedule(id: $id) {
      ${REPORT_SCHEDULE_FIELDS}
    }
  }
`

const RESUME_SCHEDULE_MUTATION = `
  mutation ResumeSchedule($id: ID!) {
    resumeSchedule(id: $id) {
      ${REPORT_SCHEDULE_FIELDS}
    }
  }
`

// ─── Service Functions ────────────────────────────────────────

export async function getReportSchedules(
  pagination?: ReportSchedulesPaginationInput,
  includeInactive?: boolean,
): Promise<ReportScheduleConnection> {
  const data = await graphqlRequest<{ reportSchedules: ReportScheduleConnection }>(
    REPORT_SCHEDULES_QUERY,
    { pagination, includeInactive },
  )
  return data.reportSchedules
}

export async function scheduleReport(input: ScheduleReportInput): Promise<ReportSchedule> {
  const data = await graphqlRequest<{ scheduleReport: ReportSchedule }>(SCHEDULE_REPORT_MUTATION, {
    input,
  })
  return data.scheduleReport
}

export async function updateSchedule(
  id: string,
  input: UpdateReportScheduleInput,
): Promise<ReportSchedule> {
  const data = await graphqlRequest<{ updateSchedule: ReportSchedule }>(UPDATE_SCHEDULE_MUTATION, {
    id,
    input,
  })
  return data.updateSchedule
}

export async function deleteSchedule(id: string): Promise<boolean> {
  const data = await graphqlRequest<{ deleteSchedule: boolean }>(DELETE_SCHEDULE_MUTATION, { id })
  return data.deleteSchedule
}

export async function pauseSchedule(id: string): Promise<ReportSchedule> {
  const data = await graphqlRequest<{ pauseSchedule: ReportSchedule }>(PAUSE_SCHEDULE_MUTATION, {
    id,
  })
  return data.pauseSchedule
}

export async function resumeSchedule(id: string): Promise<ReportSchedule> {
  const data = await graphqlRequest<{ resumeSchedule: ReportSchedule }>(RESUME_SCHEDULE_MUTATION, {
    id,
  })
  return data.resumeSchedule
}
