/**
 * Story 6.5 — report-schedule.service unit tests (TDD RED phase).
 * Tests all 6 operations, exact GraphQL query/mutations, variables, and unwrap logic.
 */
jest.mock('@/lib/graphql-client', () => ({
  graphqlRequest: jest.fn(),
}))

import { graphqlRequest } from '@/lib/graphql-client'
import {
  reportScheduleKeys,
  getReportSchedules,
  scheduleReport,
  updateSchedule,
  deleteSchedule,
  pauseSchedule,
  resumeSchedule,
} from '../report-schedule.service'
import type {
  ReportSchedule,
  ReportScheduleConnection,
  ScheduleReportInput,
  UpdateReportScheduleInput,
} from '../report-schedule.service'

const mockGraphqlRequest = graphqlRequest as jest.Mock

const SAMPLE_SCHEDULE: ReportSchedule = {
  id: 'sched-1',
  reportId: 'rep-1',
  report: {
    id: 'rep-1',
    name: 'Executive Sales Overview',
    type: 'SALES_OVERVIEW',
  },
  frequency: 'WEEKLY',
  recipients: ['alice@acme.corp', 'bob@acme.corp'],
  format: 'PDF',
  timezone: 'Asia/Ho_Chi_Minh',
  scheduledTime: '08:00',
  dayOfWeek: 1,
  dayOfMonth: null,
  startMonth: null,
  cronExpression: null,
  nextRunAt: '2026-08-24T01:00:00.000Z',
  lastRunAt: '2026-08-17T01:00:00.000Z',
  isActive: true,
  lastExecution: {
    id: 'exec-1',
    status: 'SUCCESS',
    scheduledFor: '2026-08-17T01:00:00.000Z',
    attemptCount: 1,
    nextRetryAt: null,
    completedAt: '2026-08-17T01:00:02.000Z',
    errorCode: null,
    errorMessage: null,
    createdAt: '2026-08-17T01:00:00.000Z',
  },
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z',
}

const SAMPLE_CONNECTION: ReportScheduleConnection = {
  items: [SAMPLE_SCHEDULE],
  total: 1,
  page: 1,
  pageSize: 20,
}

describe('report-schedule.service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('reportScheduleKeys', () => {
    it('provides query key factories rooted at reportSchedules', () => {
      expect(reportScheduleKeys.all).toEqual(['reportSchedules'])
      expect(reportScheduleKeys.lists()).toEqual(['reportSchedules', 'list'])
      expect(reportScheduleKeys.list({ page: 1, pageSize: 10, includeInactive: true })).toEqual([
        'reportSchedules',
        'list',
        { page: 1, pageSize: 10, includeInactive: true },
      ])
    })
  })

  describe('getReportSchedules', () => {
    it('executes reportSchedules query with pagination and includeInactive variables', async () => {
      mockGraphqlRequest.mockResolvedValue({
        reportSchedules: SAMPLE_CONNECTION,
      })

      const res = await getReportSchedules({ page: 1, pageSize: 10 }, true)

      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1)
      const [query, variables] = mockGraphqlRequest.mock.calls[0]
      expect(query).toContain('query ReportSchedules(')
      expect(query).toContain('reportSchedules(')
      expect(variables).toEqual({
        pagination: { page: 1, pageSize: 10 },
        includeInactive: true,
      })
      expect(res).toEqual(SAMPLE_CONNECTION)
    })

    it('works with undefined options defaulting variables safely', async () => {
      mockGraphqlRequest.mockResolvedValue({
        reportSchedules: SAMPLE_CONNECTION,
      })

      const res = await getReportSchedules()
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.any(String), {
        pagination: undefined,
        includeInactive: undefined,
      })
      expect(res).toEqual(SAMPLE_CONNECTION)
    })
  })

  describe('scheduleReport', () => {
    it('executes scheduleReport mutation with ScheduleReportInput and returns ReportSchedule', async () => {
      mockGraphqlRequest.mockResolvedValue({
        scheduleReport: SAMPLE_SCHEDULE,
      })

      const input: ScheduleReportInput = {
        reportId: 'rep-1',
        frequency: 'WEEKLY',
        recipients: ['alice@acme.corp'],
        format: 'PDF',
        timezone: 'Asia/Ho_Chi_Minh',
        scheduledTime: '08:00',
        dayOfWeek: 1,
      }

      const res = await scheduleReport(input)

      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1)
      const [query, variables] = mockGraphqlRequest.mock.calls[0]
      expect(query).toContain('mutation ScheduleReport(')
      expect(query).toContain('scheduleReport(input: $input)')
      expect(variables).toEqual({ input })
      expect(res).toEqual(SAMPLE_SCHEDULE)
    })
  })

  describe('updateSchedule', () => {
    it('executes updateSchedule mutation with id and UpdateReportScheduleInput', async () => {
      const updated = { ...SAMPLE_SCHEDULE, scheduledTime: '09:00' }
      mockGraphqlRequest.mockResolvedValue({
        updateSchedule: updated,
      })

      const input: UpdateReportScheduleInput = {
        scheduledTime: '09:00',
      }

      const res = await updateSchedule('sched-1', input)

      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1)
      const [query, variables] = mockGraphqlRequest.mock.calls[0]
      expect(query).toContain('mutation UpdateSchedule(')
      expect(query).toContain('updateSchedule(id: $id, input: $input)')
      expect(variables).toEqual({ id: 'sched-1', input })
      expect(res).toEqual(updated)
    })
  })

  describe('deleteSchedule', () => {
    it('executes deleteSchedule mutation and returns boolean', async () => {
      mockGraphqlRequest.mockResolvedValue({
        deleteSchedule: true,
      })

      const res = await deleteSchedule('sched-1')

      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1)
      const [query, variables] = mockGraphqlRequest.mock.calls[0]
      expect(query).toContain('mutation DeleteSchedule(')
      expect(query).toContain('deleteSchedule(id: $id)')
      expect(variables).toEqual({ id: 'sched-1' })
      expect(res).toBe(true)
    })
  })

  describe('pauseSchedule', () => {
    it('executes pauseSchedule mutation and returns updated ReportSchedule', async () => {
      const paused = { ...SAMPLE_SCHEDULE, isActive: false }
      mockGraphqlRequest.mockResolvedValue({
        pauseSchedule: paused,
      })

      const res = await pauseSchedule('sched-1')

      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1)
      const [query, variables] = mockGraphqlRequest.mock.calls[0]
      expect(query).toContain('mutation PauseSchedule(')
      expect(query).toContain('pauseSchedule(id: $id)')
      expect(variables).toEqual({ id: 'sched-1' })
      expect(res).toEqual(paused)
    })
  })

  describe('resumeSchedule', () => {
    it('executes resumeSchedule mutation and returns updated ReportSchedule', async () => {
      mockGraphqlRequest.mockResolvedValue({
        resumeSchedule: SAMPLE_SCHEDULE,
      })

      const res = await resumeSchedule('sched-1')

      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1)
      const [query, variables] = mockGraphqlRequest.mock.calls[0]
      expect(query).toContain('mutation ResumeSchedule(')
      expect(query).toContain('resumeSchedule(id: $id)')
      expect(variables).toEqual({ id: 'sched-1' })
      expect(res).toEqual(SAMPLE_SCHEDULE)
    })
  })
})
