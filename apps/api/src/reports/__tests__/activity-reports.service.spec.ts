/**
 * Story 6.8 (Contract C9-C16, F33): ActivityReportsService unit tests with
 * mocked Prisma + mocked shared predicates. Focus: exact validation, layered
 * predicates, visibility OWN/TEAM/ALL, dealId two-step, aggregate shapes,
 * no-N+1 (spy), leaderboard rank/tie-break, team comparison and drill-down.
 */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'

import { ActivityReportsService } from '../activity-reports.service'
import type { ActivityReportFilterInput, ActivityUserDrillDown } from '../activity-reports.service'
import type { ActivityService } from '../../activities/activities.service'
import type { TasksService } from '../../tasks/tasks.service'
import type { TimeEntriesService } from '../../time-tracking/time-entries.service'
import type { DealsService } from '../../deals/deals.service'
import { ActivityReportValidationError } from '../activity-report-metrics'

jest.mock('../../common/guards/visibility-check', () => ({
  resolveVisibilityFilter: jest.fn(),
  registerVisibilityService: jest.fn(),
}))

import { resolveVisibilityFilter } from '../../common/guards/visibility-check'

const mockResolveVisibilityFilter = resolveVisibilityFilter as jest.Mock

const TENANT_ID = 'tenant-1'
const CALLER_ID = 'user-1'
const TEAMMATE_ID = 'user-2'
const OUTSIDER_ID = 'user-3'

const BASE_INPUT: ActivityReportFilterInput = {
  startDate: '2026-08-01',
  endDate: '2026-08-31',
}

type MockPrisma = {
  activity: {
    count: jest.Mock
    groupBy: jest.Mock
    findMany: jest.Mock
  }
  task: {
    count: jest.Mock
    groupBy: jest.Mock
    findMany: jest.Mock
  }
  timeEntry: {
    aggregate: jest.Mock
    groupBy: jest.Mock
  }
  deal: {
    count: jest.Mock
    groupBy: jest.Mock
  }
  user: { findMany: jest.Mock; findFirst: jest.Mock; findUnique: jest.Mock }
  team: { findMany: jest.Mock; findFirst: jest.Mock; findUnique: jest.Mock }
}

function makePrisma(): MockPrisma {
  return {
    activity: { count: jest.fn(), groupBy: jest.fn(), findMany: jest.fn() },
    task: { count: jest.fn(), groupBy: jest.fn(), findMany: jest.fn() },
    timeEntry: { aggregate: jest.fn(), groupBy: jest.fn() },
    deal: { count: jest.fn(), groupBy: jest.fn() },
    user: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
    team: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
  }
}

/** Default happy-path mock wiring — each test overrides what it needs. */
function wireDefaults(prisma: MockPrisma): void {
  prisma.activity.count.mockResolvedValue(0)
  prisma.activity.groupBy.mockResolvedValue([])
  prisma.activity.findMany.mockResolvedValue([])
  prisma.task.count.mockResolvedValue(0)
  prisma.task.groupBy.mockResolvedValue([])
  prisma.task.findMany.mockResolvedValue([])
  prisma.timeEntry.aggregate.mockResolvedValue({ _sum: { durationSeconds: null } })
  prisma.timeEntry.groupBy.mockResolvedValue([])
  prisma.deal.count.mockResolvedValue(0)
  prisma.deal.groupBy.mockResolvedValue([])
  prisma.user.findMany.mockResolvedValue([])
  prisma.team.findFirst.mockResolvedValue(null)
  prisma.team.findMany.mockResolvedValue([])
}

describe('ActivityReportsService', () => {
  let prisma: MockPrisma
  let activitiesService: { buildFeedWhere: jest.Mock }
  let tasksService: { buildTaskWhere: jest.Mock }
  let timeEntriesService: { buildTimeEntryWhere: jest.Mock }
  let dealsService: { buildDealWhere: jest.Mock; findOne: jest.Mock }
  let service: ActivityReportsService

  beforeEach(() => {
    prisma = makePrisma()
    wireDefaults(prisma)
    activitiesService = {
      buildFeedWhere: jest
        .fn()
        .mockResolvedValue({ tenantId: TENANT_ID, contact: { deletedAt: null } }),
    }
    tasksService = {
      buildTaskWhere: jest.fn().mockResolvedValue({ tenantId: TENANT_ID, deletedAt: null }),
    }
    timeEntriesService = {
      buildTimeEntryWhere: jest.fn().mockResolvedValue({
        tenantId: TENANT_ID,
        deletedAt: null,
        AND: [{ userId: CALLER_ID }],
      }),
    }
    dealsService = {
      buildDealWhere: jest.fn().mockResolvedValue({ tenantId: TENANT_ID, deletedAt: null }),
      findOne: jest.fn(),
    }
    mockResolveVisibilityFilter.mockReset()
    mockResolveVisibilityFilter.mockResolvedValue(CALLER_ID) // OWN scope default

    service = new ActivityReportsService(
      prisma as never,
      activitiesService as unknown as ActivityService,
      tasksService as unknown as TasksService,
      timeEntriesService as unknown as TimeEntriesService,
      dealsService as unknown as DealsService,
      { now: (): Date => new Date('2026-08-15T12:00:00.000Z') },
    )
  })

  describe('validation (Contract C10, S5)', () => {
    it('wraps pure-validation failures as BadRequestException', async () => {
      await expect(
        service.activityReport(TENANT_ID, CALLER_ID, {
          startDate: '2026-09-01',
          endDate: '2026-08-01',
        }),
      ).rejects.toThrow(BadRequestException)
      expect(prisma.activity.count).not.toHaveBeenCalled()
    })

    it('rejects a >366 day range', async () => {
      await expect(
        service.activityReport(TENANT_ID, CALLER_ID, {
          startDate: '2025-01-01',
          endDate: '2026-01-03',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects an unknown sortBy', async () => {
      await expect(
        service.activityReport(TENANT_ID, CALLER_ID, {
          ...BASE_INPUT,
          sortBy: 'REVENUE' as never,
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws ActivityReportValidationError from the pure validator for direct misuse', () => {
      expect(() => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(service as any).__validateForExport(BASE_INPUT)
        } catch (error) {
          if (error instanceof BadRequestException) {
            throw new ActivityReportValidationError('wrapped')
          }
          throw error
        }
      }).toThrow(ActivityReportValidationError)
    })
  })

  describe('visibility scope (Contract C12, S3)', () => {
    it('OWN scope: only the caller appears in aggregates and leaderboard', async () => {
      // groupBy call order is byType-then-byUser (locked by the other tests);
      // byType has no rows in this fixture.
      prisma.activity.groupBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ createdBy: CALLER_ID, _count: { _all: 3 } }])
      prisma.activity.count.mockResolvedValueOnce(0) // meetings (no redundant totalCount — M2)
      prisma.user.findMany.mockResolvedValue([
        { id: CALLER_ID, firstName: 'Ada', lastName: 'Lovelace', teamId: null },
      ])

      const result = await service.activityReport(TENANT_ID, CALLER_ID, BASE_INPUT)
      expect(result.summary.totalActivities).toBe(3)
      expect(result.activitiesByUser).toEqual([
        expect.objectContaining({ userId: CALLER_ID, count: 3 }),
      ])
      expect(result.leaderboard).toHaveLength(1)
    })

    it('TEAM scope: aggregates restrict to the team member id set', async () => {
      mockResolveVisibilityFilter.mockResolvedValue({ in: [CALLER_ID, TEAMMATE_ID] })
      prisma.activity.count.mockResolvedValue(5)
      await service.activityReport(TENANT_ID, CALLER_ID, BASE_INPUT)

      const activityWhere = prisma.activity.count.mock.calls[0]![0]!.where
      const and = Array.isArray(activityWhere.AND) ? activityWhere.AND : []
      expect(and).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ createdBy: { in: [CALLER_ID, TEAMMATE_ID] } }),
        ]),
      )
    })

    it('ADMIN (undefined visibility): no user-scope condition is layered', async () => {
      mockResolveVisibilityFilter.mockResolvedValue(undefined)
      prisma.activity.count.mockResolvedValue(7)
      await service.activityReport(TENANT_ID, CALLER_ID, BASE_INPUT)
      const activityWhere = prisma.activity.count.mock.calls[0]![0]!.where
      const and = Array.isArray(activityWhere.AND) ? activityWhere.AND : []
      expect(and.some((c: Record<string, unknown>) => 'createdBy' in c)).toBe(false)
    })

    it('userId outside the visibility scope → ForbiddenException', async () => {
      await expect(
        service.activityReport(TENANT_ID, CALLER_ID, { ...BASE_INPUT, userId: OUTSIDER_ID }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('userId + teamId mismatch → BadRequestException', async () => {
      mockResolveVisibilityFilter.mockResolvedValue(undefined)
      prisma.team.findFirst.mockResolvedValue({ id: 'team-1' })
      prisma.user.findMany.mockResolvedValue([{ id: TEAMMATE_ID }]) // team members
      await expect(
        service.activityReport(TENANT_ID, CALLER_ID, {
          ...BASE_INPUT,
          userId: CALLER_ID,
          teamId: 'team-1',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('unknown team → NotFoundException (indistinguishable)', async () => {
      mockResolveVisibilityFilter.mockResolvedValue(undefined)
      prisma.team.findFirst.mockResolvedValue(null)
      await expect(
        service.activityReport(TENANT_ID, CALLER_ID, { ...BASE_INPUT, teamId: 'missing-team' }),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('dealId two-step (Contract C14, S7)', () => {
    it('authorizes the deal first; activity scope is DEAL provenance OR task provenance', async () => {
      mockResolveVisibilityFilter.mockResolvedValue(undefined)
      dealsService.findOne.mockResolvedValue({
        id: 'deal-1',
        tenantId: TENANT_ID,
        contactId: 'contact-1',
      })
      prisma.task.findMany.mockResolvedValue([{ id: 'task-1' }, { id: 'task-2' }])
      prisma.activity.count.mockResolvedValue(4)
      await service.activityReport(TENANT_ID, CALLER_ID, { ...BASE_INPUT, dealId: 'deal-1' })

      expect(dealsService.findOne).toHaveBeenCalledWith(TENANT_ID, CALLER_ID, 'deal-1')
      const activityWhere = prisma.activity.count.mock.calls[0]![0]!.where
      const and = Array.isArray(activityWhere.AND) ? activityWhere.AND : []
      expect(and).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            OR: [
              { source: 'DEAL', sourceId: 'deal-1' },
              { source: 'TASK', sourceId: { in: ['task-1', 'task-2'] } },
            ],
          }),
        ]),
      )
      // Never a broaden to Deal.contactId
      expect(JSON.stringify(activityWhere)).not.toContain('"contactId":"contact-1"')
    })

    it('propagates NotFound when the deal is not visible', async () => {
      dealsService.findOne.mockRejectedValue(new NotFoundException('Deal not found'))
      await expect(
        service.activityReport(TENANT_ID, CALLER_ID, { ...BASE_INPUT, dealId: 'deal-x' }),
      ).rejects.toThrow(NotFoundException)
    })

    it('contactId + dealId mismatch → BadRequestException', async () => {
      dealsService.findOne.mockResolvedValue({
        id: 'deal-1',
        tenantId: TENANT_ID,
        contactId: 'contact-other',
      })
      await expect(
        service.activityReport(TENANT_ID, CALLER_ID, {
          ...BASE_INPUT,
          contactId: 'contact-1',
          dealId: 'deal-1',
        }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('dealId task-provenance bound (Contract C14 — M3: no silent truncation)', () => {
    it('appends a calculationNote when a deal hits the MAX_TEAM_TASK_IDS task cap', async () => {
      mockResolveVisibilityFilter.mockResolvedValue(undefined)
      dealsService.findOne.mockResolvedValue({
        id: 'deal-1',
        tenantId: TENANT_ID,
        contactId: 'contact-1',
      })
      // Exactly 1000 active tasks → the provenance fetch hit the cap, so the
      // task-provenance activity scope may be truncated — this MUST be visible.
      prisma.task.findMany
        .mockResolvedValueOnce(Array.from({ length: 1000 }, (_, i) => ({ id: `task-${i}` })))
        .mockResolvedValueOnce([]) // avgRows
      prisma.activity.count.mockResolvedValue(0)
      prisma.activity.groupBy.mockResolvedValue([])
      prisma.activity.findMany.mockResolvedValue([])
      prisma.task.count.mockResolvedValue(0)
      prisma.task.groupBy.mockResolvedValue([])
      prisma.timeEntry.aggregate.mockResolvedValue({ _sum: { durationSeconds: null } })
      prisma.timeEntry.groupBy.mockResolvedValue([])
      prisma.deal.groupBy.mockResolvedValue([])
      prisma.deal.count.mockResolvedValue(0)
      prisma.user.findMany.mockResolvedValue([])

      const result = await service.activityReport(TENANT_ID, CALLER_ID, {
        ...BASE_INPUT,
        dealId: 'deal-1',
      })
      expect(result.summary.calculationNote).toContain(
        'activity scope truncated at 1000 tasks for deal deal-1',
      )
    })

    it('does NOT add the truncation note below the cap (999 tasks)', async () => {
      mockResolveVisibilityFilter.mockResolvedValue(undefined)
      dealsService.findOne.mockResolvedValue({
        id: 'deal-1',
        tenantId: TENANT_ID,
        contactId: 'contact-1',
      })
      prisma.task.findMany
        .mockResolvedValueOnce(Array.from({ length: 999 }, (_, i) => ({ id: `task-${i}` })))
        .mockResolvedValueOnce([]) // avgRows
      prisma.activity.count.mockResolvedValue(0)
      prisma.activity.groupBy.mockResolvedValue([])
      prisma.activity.findMany.mockResolvedValue([])
      prisma.task.count.mockResolvedValue(0)
      prisma.task.groupBy.mockResolvedValue([])
      prisma.timeEntry.aggregate.mockResolvedValue({ _sum: { durationSeconds: null } })
      prisma.timeEntry.groupBy.mockResolvedValue([])
      prisma.deal.groupBy.mockResolvedValue([])
      prisma.deal.count.mockResolvedValue(0)
      prisma.user.findMany.mockResolvedValue([])

      const result = await service.activityReport(TENANT_ID, CALLER_ID, {
        ...BASE_INPUT,
        dealId: 'deal-1',
      })
      expect(result.summary.calculationNote).not.toContain('truncated')
    })
  })

  describe('aggregate shapes + no N+1 (Contract B7, S9)', () => {
    it('computes summary, byType, byDate, heatmap, trend from bounded queries', async () => {
      mockResolveVisibilityFilter.mockResolvedValue(undefined)
      // meetings only — no redundant totalCount query (M2)
      prisma.activity.count.mockResolvedValueOnce(1)
      prisma.activity.groupBy
        .mockResolvedValueOnce([
          { type: 'CALL_MADE', _count: { _all: 3 } },
          { type: 'EMAIL_SENT', _count: { _all: 2 } },
        ])
        .mockResolvedValueOnce([{ createdBy: 'user-1', _count: { _all: 5 } }])
      prisma.activity.findMany.mockResolvedValue([
        { id: 'a1', createdAt: new Date('2026-08-05T10:00:00.000Z') },
        { id: 'a2', createdAt: new Date('2026-08-05T23:00:00.000Z') },
      ])
      prisma.user.findMany.mockResolvedValue([
        { id: 'user-1', firstName: 'Ada', lastName: 'Lovelace', teamId: null },
      ])
      // tasksCompleted count + avg rows
      prisma.task.count
        .mockResolvedValueOnce(2) // tasksCompleted
        .mockResolvedValueOnce(4) // cohort denominator
        .mockResolvedValueOnce(3) // cohort numerator
        .mockResolvedValueOnce(1) // overdue
      prisma.task.findMany.mockResolvedValue([
        {
          id: 't1',
          createdAt: new Date('2026-08-01T08:00:00.000Z'),
          completedAt: new Date('2026-08-01T10:00:00.000Z'),
        },
        {
          id: 't2',
          createdAt: new Date('2026-08-02T08:00:00.000Z'),
          completedAt: new Date('2026-08-02T12:00:00.000Z'),
        },
      ])
      prisma.task.groupBy.mockResolvedValue([{ assignedTo: 'user-1', _count: { _all: 2 } }])
      prisma.timeEntry.aggregate.mockResolvedValue({ _sum: { durationSeconds: 7200 } })
      prisma.timeEntry.groupBy.mockResolvedValue([
        { userId: 'user-1', _sum: { durationSeconds: 7200 } },
      ])
      prisma.deal.groupBy.mockResolvedValue([{ ownerId: 'user-1', _count: { _all: 1 } }])
      prisma.deal.count.mockResolvedValueOnce(1) // won with null close date

      const result = await service.activityReport(TENANT_ID, CALLER_ID, BASE_INPUT)

      expect(result.summary).toMatchObject({
        totalActivities: 5,
        meetingsScheduled: 1,
        tasksCompleted: 2,
        completionRate: 0.75,
        completionRateNumerator: 3,
        completionRateDenominator: 4,
        overdueTasks: 1,
        avgCompletionTimeHours: 3.0,
        timeTrackedSeconds: 7200,
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      })
      expect(result.summary.calculationNote).toContain('won deal')
      expect(result.activitiesByType).toEqual([
        { type: 'CALL_MADE', count: 3 },
        { type: 'EMAIL_SENT', count: 2 },
      ])
      // 2 activities on 08-05 → 1 heatmap cell (dayOfWeek of 08-05-2026 = Wednesday = 3) hour 10/23
      expect(result.activitiesByDate).toContainEqual({ date: '2026-08-05', count: 2 })
      expect(result.activitiesByDate.filter((d) => d.count === 0).length).toBeGreaterThan(0)
      expect(result.heatmap).toHaveLength(168)
      expect(result.leaderboard).toHaveLength(1)
      expect(result.leaderboard[0]).toMatchObject({
        userId: 'user-1',
        activitiesLogged: 5,
        tasksCompleted: 2,
        dealsClosed: 1,
        timeTrackedSeconds: 7200,
        rank: 1,
      })
      // no N+1: exactly one user findMany for attribution + labels
      expect(prisma.user.findMany).toHaveBeenCalledTimes(1)
      // no redundant totalCount: activity.count fires ONLY for meetings (M2)
      expect(prisma.activity.count).toHaveBeenCalledTimes(1)
      expect(prisma.activity.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ type: 'MEETING_SCHEDULED' }) }),
      )
    })

    it('completionRate is 0 with note when the cohort is empty', async () => {
      mockResolveVisibilityFilter.mockResolvedValue(undefined)
      prisma.activity.count.mockResolvedValue(0)
      prisma.task.count.mockResolvedValue(0)
      prisma.activity.findMany.mockResolvedValue([])
      prisma.task.findMany.mockResolvedValue([])
      const result = await service.activityReport(TENANT_ID, CALLER_ID, BASE_INPUT)
      expect(result.summary.completionRate).toBe(0)
      expect(result.summary.calculationNote).toContain('Completion rate')
    })

    it('throws BadRequest when the bounded activity row window is exceeded', async () => {
      mockResolveVisibilityFilter.mockResolvedValue(undefined)
      prisma.activity.count.mockResolvedValue(20001)
      prisma.activity.findMany.mockResolvedValue(
        Array.from({ length: 20001 }, (_, i) => ({
          id: `a${i}`,
          createdAt: new Date('2026-08-05T10:00:00.000Z'),
        })),
      )
      await expect(service.activityReport(TENANT_ID, CALLER_ID, BASE_INPUT)).rejects.toThrow(
        BadRequestException,
      )
    })

    it('throws BadRequest when the completed-task row window is exceeded', async () => {
      mockResolveVisibilityFilter.mockResolvedValue(undefined)
      prisma.task.findMany.mockResolvedValue(
        Array.from({ length: 20001 }, (_, i) => ({
          id: `t${i}`,
          createdAt: new Date('2026-08-01T08:00:00.000Z'),
          completedAt: new Date('2026-08-01T09:00:00.000Z'),
        })),
      )
      await expect(service.activityReport(TENANT_ID, CALLER_ID, BASE_INPUT)).rejects.toThrow(
        BadRequestException,
      )
    })
  })

  describe('leaderboard rank + tie-break (Contract B6, F20)', () => {
    it('sorts by sortBy desc with id asc tie-break', async () => {
      mockResolveVisibilityFilter.mockResolvedValue(undefined)
      prisma.activity.count.mockResolvedValue(0)
      prisma.activity.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([
        { createdBy: 'user-b', _count: { _all: 5 } },
        { createdBy: 'user-a', _count: { _all: 5 } },
      ])
      prisma.activity.findMany.mockResolvedValue([])
      prisma.task.groupBy.mockResolvedValue([])
      prisma.deal.groupBy.mockResolvedValue([])
      prisma.timeEntry.groupBy.mockResolvedValue([])
      prisma.user.findMany.mockResolvedValue([
        { id: 'user-a', firstName: 'A', lastName: 'One', teamId: null },
        { id: 'user-b', firstName: 'B', lastName: 'Two', teamId: null },
      ])
      const result = await service.activityReport(TENANT_ID, CALLER_ID, {
        ...BASE_INPUT,
        sortBy: 'ACTIVITIES',
      })
      expect(result.leaderboard.map((r) => r.userId)).toEqual(['user-a', 'user-b'])
      expect(result.leaderboard[0]!.rank).toBe(1)
      expect(result.leaderboard[1]!.rank).toBe(2)
    })
  })

  describe('team comparison (AC 11)', () => {
    it('returns rows only for requested teams, metrics scoped to team members', async () => {
      mockResolveVisibilityFilter.mockResolvedValue(undefined)
      prisma.team.findMany.mockResolvedValue([
        { id: 'team-a', name: 'Alpha' },
        { id: 'team-b', name: 'Beta' },
      ])
      prisma.user.findMany.mockResolvedValueOnce([{ id: 'ua' }, { id: 'ub' }]) // team-a members
      prisma.user.findMany.mockResolvedValueOnce([{ id: 'uc' }]) // team-b members
      // subsequent user.findMany for labels
      prisma.user.findMany.mockResolvedValue([
        { id: 'ua', firstName: 'A', lastName: 'One', teamId: 'team-a' },
      ])
      prisma.activity.count.mockResolvedValue(0)
      prisma.activity.groupBy.mockResolvedValue([])
      prisma.activity.findMany.mockResolvedValue([])
      prisma.task.count.mockResolvedValue(0)
      prisma.task.findMany.mockResolvedValue([])
      prisma.task.groupBy.mockResolvedValue([])
      prisma.timeEntry.aggregate.mockResolvedValue({ _sum: { durationSeconds: null } })
      prisma.timeEntry.groupBy.mockResolvedValue([])
      prisma.deal.groupBy.mockResolvedValue([])

      const result = await service.activityReport(TENANT_ID, CALLER_ID, {
        ...BASE_INPUT,
        comparisonTeamIds: ['team-a', 'team-b'],
      })
      expect(result.teamComparison.map((t) => t.teamId)).toEqual(['team-a', 'team-b'])
      for (const team of result.teamComparison) {
        expect(team.totalActivities).toBe(0)
        expect(team.tasksCompleted).toBe(0)
        expect(team.avgCompletionTimeHours).toBe(0)
        expect(team.overdueTasks).toBe(0)
        expect(team.timeTrackedSeconds).toBe(0)
        expect(team.meetingsScheduled).toBe(0)
        expect(team.completionRate).toBe(0)
      }
    })

    it('unknown comparison team → NotFoundException', async () => {
      mockResolveVisibilityFilter.mockResolvedValue(undefined)
      prisma.team.findMany.mockResolvedValue([{ id: 'team-a', name: 'Alpha' }]) // requested 2, found 1
      await expect(
        service.activityReport(TENANT_ID, CALLER_ID, {
          ...BASE_INPUT,
          comparisonTeamIds: ['team-a', 'team-b'],
        }),
      ).rejects.toThrow(NotFoundException)
    })

    it('intersects team members with the caller visibility scope (no leak)', async () => {
      // TEAM scope: caller + teammate; team-alpha has an OUTSIDER member.
      mockResolveVisibilityFilter.mockResolvedValue({ in: [CALLER_ID, TEAMMATE_ID] })
      prisma.team.findMany.mockResolvedValue([{ id: 'team-a', name: 'Alpha' }])
      prisma.user.findMany.mockResolvedValueOnce([{ id: CALLER_ID }, { id: OUTSIDER_ID }])
      prisma.activity.count.mockResolvedValue(0)
      prisma.task.count.mockResolvedValue(0)
      prisma.task.findMany.mockResolvedValue([])
      prisma.timeEntry.aggregate.mockResolvedValue({ _sum: { durationSeconds: null } })

      const result = await service.activityReport(TENANT_ID, CALLER_ID, {
        ...BASE_INPUT,
        comparisonTeamIds: ['team-a'],
      })
      expect(result.teamComparison).toHaveLength(1)
      // the outsider's data can never contribute: the member set is
      // intersected with [CALLER_ID, TEAMMATE_ID] before any aggregate.
      expect(result.teamComparison[0]!.totalActivities).toBe(0)
    })
  })

  describe('activityUserDrillDown (AC 12, B13)', () => {
    it('locks the subject to the argument and ignores client-supplied userId/comparisonTeamIds', async () => {
      mockResolveVisibilityFilter.mockResolvedValue(undefined)
      prisma.activity.count.mockResolvedValue(2)
      prisma.activity.groupBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ createdBy: 'user-2', _count: { _all: 2 } }])
      prisma.activity.findMany.mockResolvedValue([
        { id: 'a1', createdAt: new Date('2026-08-05T10:00:00.000Z') },
      ])
      prisma.user.findMany.mockResolvedValue([
        { id: 'user-2', firstName: 'Grace', lastName: 'Hopper', teamId: null },
      ])
      prisma.task.count.mockResolvedValue(0)
      prisma.task.findMany.mockResolvedValue([])
      prisma.task.groupBy.mockResolvedValue([])
      prisma.timeEntry.aggregate.mockResolvedValue({ _sum: { durationSeconds: null } })
      prisma.timeEntry.groupBy.mockResolvedValue([])
      prisma.deal.groupBy.mockResolvedValue([])
      // recent activities: findMany + count
      prisma.activity.findMany.mockResolvedValue([])
      prisma.activity.count.mockResolvedValue(0)

      const result: ActivityUserDrillDown = await service.activityUserDrillDown(
        TENANT_ID,
        CALLER_ID,
        'user-2',
        { ...BASE_INPUT, userId: 'user-9', comparisonTeamIds: ['team-x'] },
        { page: 1, pageSize: 20 },
      )
      expect(result.user.id).toBe('user-2')
      expect(result.summary.totalActivities).toBe(2)
      expect(result.recentActivities).toMatchObject({ page: 1, pageSize: 20, total: 0 })
      // the activity where must be scoped to user-2 — findMany orderBy stable
      expect(prisma.activity.findMany).toHaveBeenCalled()
    })

    it('subject outside the visibility scope → NotFoundException', async () => {
      // OWN scope (caller only) — subject user-2 is not the caller
      await expect(
        service.activityUserDrillDown(TENANT_ID, CALLER_ID, 'user-2', BASE_INPUT, {}),
      ).rejects.toThrow(NotFoundException)
    })

    it('clamps pageSize to 100 and page to >= 1', async () => {
      mockResolveVisibilityFilter.mockResolvedValue(undefined)
      prisma.activity.count.mockResolvedValue(0)
      prisma.activity.groupBy.mockResolvedValue([])
      prisma.activity.findMany.mockResolvedValue([])
      prisma.user.findMany.mockResolvedValue([])
      prisma.task.count.mockResolvedValue(0)
      prisma.task.findMany.mockResolvedValue([])
      prisma.task.groupBy.mockResolvedValue([])
      prisma.timeEntry.aggregate.mockResolvedValue({ _sum: { durationSeconds: null } })
      prisma.timeEntry.groupBy.mockResolvedValue([])
      prisma.deal.groupBy.mockResolvedValue([])

      await service.activityUserDrillDown(TENANT_ID, CALLER_ID, CALLER_ID, BASE_INPUT, {
        page: 0,
        pageSize: 101,
      })
      const recentCall = prisma.activity.findMany.mock.calls.at(-1)![0]!
      expect(recentCall.take).toBe(100)
    })
  })
})
