/**
 * Story 6.8 (Contract D17-D18, F33): ActivityGoalsService unit tests with
 * mocked Prisma + mocked resolveVisibilityFilter. Focus: exact validation
 * bounds, subject visibility, duplicate (activityType, period) rejection,
 * P2002 → ConflictException, server-computed progress (batched groupBy —
 * no N+1) and the visibility-scoped list.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

import { ActivityGoalsService } from '../activity-goals.service'

jest.mock('../../common/guards/visibility-check', () => ({
  resolveVisibilityFilter: jest.fn(),
  registerVisibilityService: jest.fn(),
}))

import { resolveVisibilityFilter } from '../../common/guards/visibility-check'

const mockResolveVisibilityFilter = resolveVisibilityFilter as jest.Mock

const TENANT_ID = 'tenant-1'
const MANAGER_ID = 'user-manager'
const SUBJECT_ID = 'user-rep1'
const OUTSIDER_ID = 'user-outsider'

const BASE_INPUT = {
  name: '50 calls per week',
  activityType: 'CALL_MADE',
  targetCount: 50,
  period: 'WEEKLY' as const,
  userId: SUBJECT_ID,
  startsOn: '2026-08-19T00:00:00.000Z',
}

type MockPrisma = {
  activityGoal: {
    findFirst: jest.Mock
    findMany: jest.Mock
    count: jest.Mock
    create: jest.Mock
    update: jest.Mock
    updateMany: jest.Mock
  }
  user: { findFirst: jest.Mock; findMany: jest.Mock }
  activity: { groupBy: jest.Mock }
}

function makePrisma(): MockPrisma {
  return {
    activityGoal: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    user: { findFirst: jest.fn(), findMany: jest.fn() },
    activity: { groupBy: jest.fn() },
  }
}

function goalRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'goal-1',
    tenantId: TENANT_ID,
    name: '50 calls per week',
    activityType: 'CALL_MADE',
    targetCount: 50,
    period: 'WEEKLY',
    userId: SUBJECT_ID,
    startsOn: new Date('2026-08-19T00:00:00.000Z'),
    isActive: true,
    createdAt: new Date('2026-08-20T00:00:00.000Z'),
    updatedAt: new Date('2026-08-20T00:00:00.000Z'),
    createdBy: MANAGER_ID,
    updatedBy: MANAGER_ID,
    deletedAt: null,
    ...overrides,
  }
}

function p2002(message: string): PrismaClientKnownRequestError {
  return new PrismaClientKnownRequestError(message, { code: 'P2002', clientVersion: '5.10' })
}

const NOW = new Date('2026-08-22T07:00:00.000Z')

describe('ActivityGoalsService', () => {
  let prisma: MockPrisma
  let service: ActivityGoalsService

  beforeEach(() => {
    prisma = makePrisma()
    mockResolveVisibilityFilter.mockReset()
    // ADMIN/ALL by default — most tests exercise pure validation.
    mockResolveVisibilityFilter.mockResolvedValue(undefined)
    service = new ActivityGoalsService(prisma as never, { now: (): Date => NOW })
  })

  describe('create validation (Contract A5/D17)', () => {
    it('rejects an empty or >200 char name', async () => {
      await expect(
        service.createActivityGoal(TENANT_ID, MANAGER_ID, { ...BASE_INPUT, name: '   ' }),
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.createActivityGoal(TENANT_ID, MANAGER_ID, {
          ...BASE_INPUT,
          name: 'x'.repeat(201),
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects targetCount outside 1..10000 and non-integers', async () => {
      for (const targetCount of [0, -1, 10_001, 1.5]) {
        await expect(
          service.createActivityGoal(TENANT_ID, MANAGER_ID, { ...BASE_INPUT, targetCount }),
        ).rejects.toThrow(BadRequestException)
      }
    })

    it('rejects an invalid period and an invalid activityType', async () => {
      await expect(
        service.createActivityGoal(TENANT_ID, MANAGER_ID, {
          ...BASE_INPUT,
          period: 'YEARLY' as never,
        }),
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.createActivityGoal(TENANT_ID, MANAGER_ID, {
          ...BASE_INPUT,
          activityType: 'NOT_A_TYPE',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects a startsOn that is not UTC midnight', async () => {
      await expect(
        service.createActivityGoal(TENANT_ID, MANAGER_ID, {
          ...BASE_INPUT,
          startsOn: '2026-08-19T07:30:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('create access + duplicates', () => {
    it('NotFound when the subject user is not active in the tenant', async () => {
      prisma.user.findFirst.mockResolvedValue(null)
      await expect(service.createActivityGoal(TENANT_ID, MANAGER_ID, BASE_INPUT)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('Forbidden when the subject is outside the caller visibility scope', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: SUBJECT_ID })
      mockResolveVisibilityFilter.mockResolvedValue(MANAGER_ID) // OWN scope
      await expect(service.createActivityGoal(TENANT_ID, MANAGER_ID, BASE_INPUT)).rejects.toThrow(
        ForbiddenException,
      )
    })

    it('BadRequest on an existing active goal with the same (user, period, activityType)', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: SUBJECT_ID })
      prisma.activityGoal.findFirst.mockResolvedValue({ id: 'goal-existing' })
      await expect(service.createActivityGoal(TENANT_ID, MANAGER_ID, BASE_INPUT)).rejects.toThrow(
        BadRequestException,
      )
    })

    it('ConflictException on a P2002 unique violation (race-safe backstop)', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: SUBJECT_ID })
      prisma.activityGoal.findFirst.mockResolvedValue(null) // check passes...
      prisma.activityGoal.create.mockRejectedValue(
        p2002(
          'Unique constraint failed on the fields: (`tenantId`,`userId`,`period`,`activityType`)',
        ),
      )
      await expect(service.createActivityGoal(TENANT_ID, MANAGER_ID, BASE_INPUT)).rejects.toThrow(
        ConflictException,
      )
    })

    it('creates and returns a view with server-computed progress', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: SUBJECT_ID })
      prisma.activityGoal.findFirst.mockResolvedValue(null)
      prisma.activityGoal.create.mockResolvedValue(goalRow())
      // window 2026-08-19..2026-08-26; 3 CALL_MADE activities → 6%
      prisma.activity.groupBy.mockResolvedValue([
        { createdBy: SUBJECT_ID, type: 'CALL_MADE', _count: { _all: 3 } },
      ])
      prisma.user.findMany.mockResolvedValue([
        { id: SUBJECT_ID, firstName: 'Ada', lastName: 'Lovelace' },
      ])

      const view = await service.createActivityGoal(TENANT_ID, MANAGER_ID, BASE_INPUT)
      expect(view.id).toBe('goal-1')
      expect(view.qualifyingCount).toBe(3)
      expect(view.progress).toBeCloseTo(0.06, 5)
      expect(view.progressPercent).toBe(6)
      expect(view.user).toEqual({ id: SUBJECT_ID, firstName: 'Ada', lastName: 'Lovelace' })
      expect(prisma.activityGoal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_ID,
            name: '50 calls per week',
            activityType: 'CALL_MADE',
            targetCount: 50,
            period: 'WEEKLY',
            userId: SUBJECT_ID,
            createdBy: MANAGER_ID,
          }),
        }),
      )
    })
  })

  describe('update (Contract D17)', () => {
    beforeEach(() => {
      prisma.user.findFirst.mockResolvedValue({ id: SUBJECT_ID })
    })

    it('NotFound for a missing/deleted goal', async () => {
      prisma.activityGoal.findFirst.mockResolvedValue(null)
      await expect(
        service.updateActivityGoal(TENANT_ID, MANAGER_ID, 'goal-x', { name: 'New name' }),
      ).rejects.toThrow(NotFoundException)
    })

    it('does not allow changing the subject userId (no silent move)', async () => {
      prisma.activityGoal.findFirst
        .mockResolvedValueOnce(goalRow()) // findOwnedGoal
        .mockResolvedValueOnce(null) // duplicate probe (excluding self)
      prisma.activityGoal.update.mockResolvedValue(goalRow({ name: 'Renamed' }))
      prisma.activity.groupBy.mockResolvedValue([])
      prisma.user.findMany.mockResolvedValue([])
      // TS input type has no userId — the service must keep the stored userId.
      const view = await service.updateActivityGoal(TENANT_ID, MANAGER_ID, 'goal-1', {
        name: 'Renamed',
      })
      expect(view.userId).toBe(SUBJECT_ID)
      expect(prisma.activityGoal.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Renamed', updatedBy: MANAGER_ID }),
        }),
      )
    })

    it('rejects a duplicate (user, period, activityType) excluding itself', async () => {
      prisma.activityGoal.findFirst
        .mockResolvedValueOnce(goalRow())
        .mockResolvedValueOnce({ id: 'goal-other' })
      await expect(
        service.updateActivityGoal(TENANT_ID, MANAGER_ID, 'goal-1', { targetCount: 100 }),
      ).rejects.toThrow(BadRequestException)
    })

    it('maps a P2002 unique violation to ConflictException', async () => {
      prisma.activityGoal.findFirst.mockResolvedValueOnce(goalRow()).mockResolvedValueOnce(null) // duplicate check passes
      prisma.activityGoal.update.mockRejectedValue(p2002('Unique constraint failed'))
      await expect(
        service.updateActivityGoal(TENANT_ID, MANAGER_ID, 'goal-1', { targetCount: 100 }),
      ).rejects.toThrow(ConflictException)
    })

    it('validates every updateable field shape (isActive/period/startsOn/activityType/name)', async () => {
      prisma.activityGoal.findFirst.mockResolvedValue(goalRow())
      const cases: Record<string, unknown>[] = [
        { isActive: 'yes' },
        { period: 'YEARLY' },
        { startsOn: '2026-08-19T07:00:00.000Z' },
        { startsOn: 'not-a-date' },
        { activityType: 'NOT_A_TYPE' },
        { name: 'x'.repeat(201) },
        {},
      ]
      for (const input of cases) {
        await expect(
          service.updateActivityGoal(TENANT_ID, MANAGER_ID, 'goal-1', input as never),
        ).rejects.toThrow(BadRequestException)
      }
      // activityType: null explicitly clears the type (allowed)
      prisma.activityGoal.findFirst
        .mockReset()
        .mockResolvedValueOnce(goalRow())
        .mockResolvedValueOnce(null)
      prisma.activityGoal.update.mockReset()
      prisma.activityGoal.update.mockResolvedValue(goalRow({ activityType: null }))
      prisma.activity.groupBy.mockResolvedValue([])
      prisma.user.findMany.mockResolvedValue([])
      const cleared = await service.updateActivityGoal(TENANT_ID, MANAGER_ID, 'goal-1', {
        activityType: null,
      })
      expect(cleared.activityType).toBeNull()
    })

    it('NotFound when the subject user is no longer active', async () => {
      prisma.user.findFirst.mockResolvedValue(null)
      prisma.activityGoal.findFirst.mockResolvedValue(goalRow())
      await expect(
        service.updateActivityGoal(TENANT_ID, MANAGER_ID, 'goal-1', { name: 'x' }),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('delete (Contract D17)', () => {
    it('soft-deletes and returns true; NotFound when missing', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: SUBJECT_ID })
      prisma.activityGoal.findFirst.mockResolvedValue(goalRow())
      prisma.activityGoal.updateMany.mockResolvedValue({ count: 1 })
      await expect(service.deleteActivityGoal(TENANT_ID, MANAGER_ID, 'goal-1')).resolves.toBe(true)
      expect(prisma.activityGoal.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'goal-1', tenantId: TENANT_ID, deletedAt: null }),
          data: expect.objectContaining({ deletedAt: NOW, updatedBy: MANAGER_ID }),
        }),
      )

      prisma.activityGoal.findFirst.mockResolvedValue(null)
      await expect(service.deleteActivityGoal(TENANT_ID, MANAGER_ID, 'goal-x')).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('list + progress (Contract D18, S9)', () => {
    it('scopes the list to the caller visibility set (OWN → self only)', async () => {
      mockResolveVisibilityFilter.mockResolvedValue(MANAGER_ID)
      prisma.activityGoal.findMany.mockResolvedValue([goalRow()])
      prisma.activityGoal.count.mockResolvedValue(1)
      prisma.activity.groupBy.mockResolvedValue([])
      prisma.user.findMany.mockResolvedValue([])

      const conn = await service.activityGoals(TENANT_ID, MANAGER_ID, {})
      expect(prisma.activityGoal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: { in: [MANAGER_ID] } }),
        }),
      )
      expect(conn.total).toBe(1)
      expect(conn.items).toHaveLength(1)
    })

    it('returns an empty list for an out-of-scope subject filter (no leak)', async () => {
      mockResolveVisibilityFilter.mockResolvedValue(MANAGER_ID)
      const conn = await service.activityGoals(TENANT_ID, MANAGER_ID, {
        userId: OUTSIDER_ID,
      })
      expect(conn).toEqual({ items: [], total: 0, page: 1, pageSize: 20 })
      expect(prisma.activityGoal.findMany).not.toHaveBeenCalled()
    })

    it('computes progress with ONE groupBy per distinct window (no N+1)', async () => {
      prisma.activityGoal.findMany.mockResolvedValue([
        goalRow({ id: 'goal-a', activityType: 'CALL_MADE' }),
        goalRow({ id: 'goal-b', activityType: null }), // TOTAL — sums all types
      ])
      prisma.activityGoal.count.mockResolvedValue(2)
      prisma.activity.groupBy.mockResolvedValue([
        { createdBy: SUBJECT_ID, type: 'CALL_MADE', _count: { _all: 3 } },
        { createdBy: SUBJECT_ID, type: 'EMAIL_SENT', _count: { _all: 2 } },
      ])
      prisma.user.findMany.mockResolvedValue([
        { id: SUBJECT_ID, firstName: 'Ada', lastName: 'Lovelace' },
      ])

      const conn = await service.activityGoals(TENANT_ID, MANAGER_ID, {})
      // one window (both WEEKLY anchored on the same startsOn) → one groupBy
      expect(prisma.activity.groupBy).toHaveBeenCalledTimes(1)
      const goalA = conn.items.find((g) => g.id === 'goal-a')!
      const goalB = conn.items.find((g) => g.id === 'goal-b')!
      expect(goalA.qualifyingCount).toBe(3) // CALL_MADE only
      expect(goalB.qualifyingCount).toBe(5) // TOTAL = all types
      expect(goalB.progressPercent).toBe(10) // 5/50
    })

    it('applies list filters (period/activityType/activeOnly) and clamps pagination', async () => {
      prisma.activityGoal.findMany.mockResolvedValue([])
      prisma.activityGoal.count.mockResolvedValue(0)
      prisma.activity.groupBy.mockResolvedValue([])
      prisma.user.findMany.mockResolvedValue([])

      await service.activityGoals(
        TENANT_ID,
        MANAGER_ID,
        {
          period: 'MONTHLY',
          activityType: 'EMAIL_SENT',
          activeOnly: true,
        },
        { page: 0, pageSize: 101 },
      )
      expect(prisma.activityGoal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            period: 'MONTHLY',
            activityType: 'EMAIL_SENT',
            isActive: true,
          }),
          skip: 0,
          take: 100,
        }),
      )
    })
  })
})
