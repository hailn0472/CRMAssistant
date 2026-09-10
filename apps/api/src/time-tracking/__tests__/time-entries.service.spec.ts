import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import { Prisma } from '@prisma/client'

import { TimeEntriesService } from '../time-entries.service'
import type { TimeEntryItem } from '../time-entries.service'
import { TasksService } from '../../tasks/tasks.service'
import { AuditService } from '../../audit/audit.service'

jest.mock('../../common/guards/visibility-check', () => ({
  resolveVisibilityFilter: jest.fn(),
  registerVisibilityService: jest.fn(),
}))

import { resolveVisibilityFilter } from '../../common/guards/visibility-check'

const mockResolveVisibilityFilter = resolveVisibilityFilter as jest.Mock

type MockTimeEntryDelegate = {
  findFirst: jest.Mock
  findMany: jest.Mock
  count: jest.Mock
  create: jest.Mock
  updateMany: jest.Mock
}

type MockTx = {
  timeEntry: Pick<MockTimeEntryDelegate, 'findFirst' | 'create'>
}

type MockPrisma = {
  timeEntry: MockTimeEntryDelegate
  $transaction: jest.Mock
}

const NOW = new Date('2026-08-06T09:00:00.000Z')
const TENANT_ID = 'tenant-1'
const OTHER_TENANT_ID = 'tenant-2'
const USER_ID = 'user-1'
const OTHER_USER_ID = 'user-2'
const TASK_ID = 'task-1'
const ENTRY_ID = 'entry-1'

function makeEntry(overrides: Partial<Record<string, unknown>> = {}): TimeEntryItem {
  return {
    id: ENTRY_ID,
    tenantId: TENANT_ID,
    taskId: TASK_ID,
    userId: USER_ID,
    startTime: new Date('2026-08-06T08:00:00.000Z'),
    endTime: null,
    durationSeconds: 0,
    description: null,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: USER_ID,
    updatedBy: USER_ID,
    deletedAt: null,
    task: { id: TASK_ID, title: 'Follow up with Acme' },
    ...overrides,
  } as TimeEntryItem
}

function makePrisma(): MockPrisma {
  const delegate: MockTimeEntryDelegate = {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
  }
  return {
    timeEntry: delegate,
    $transaction: jest.fn(),
  }
}

describe('TimeEntriesService', () => {
  let prisma: MockPrisma
  let tasksService: { findOne: jest.Mock }
  let auditService: { log: jest.Mock }
  let service: TimeEntriesService

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW)
    prisma = makePrisma()
    tasksService = {
      findOne: jest.fn().mockResolvedValue({ id: TASK_ID, title: 'Follow up with Acme' }),
    }
    auditService = { log: jest.fn().mockResolvedValue(undefined) }
    mockResolveVisibilityFilter.mockReset()
    mockResolveVisibilityFilter.mockResolvedValue(USER_ID)

    service = new TimeEntriesService(
      prisma as unknown as PrismaService,
      tasksService as unknown as TasksService,
      auditService as unknown as AuditService,
    )
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('startTimer', () => {
    it('proves the task exists and is visible via TasksService.findOne before creating', async () => {
      const mockTx: MockTx = {
        timeEntry: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue(makeEntry()),
        },
      }
      prisma.$transaction.mockImplementation(async (cb: (tx: MockTx) => Promise<unknown>) =>
        cb(mockTx),
      )

      await service.startTimer(TENANT_ID, USER_ID, TASK_ID)

      expect(tasksService.findOne).toHaveBeenCalledWith(TENANT_ID, USER_ID, TASK_ID)
      expect(mockTx.timeEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_ID,
            taskId: TASK_ID,
            userId: USER_ID,
            endTime: null,
            durationSeconds: 0,
          }),
        }),
      )
    })

    it('propagates TasksService.findOne NotFoundException for an invisible task', async () => {
      tasksService.findOne.mockRejectedValue(new NotFoundException('Task not found'))

      await expect(service.startTimer(TENANT_ID, USER_ID, TASK_ID)).rejects.toThrow(
        NotFoundException,
      )
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('opens the interactive transaction with Serializable isolation level', async () => {
      const mockTx: MockTx = {
        timeEntry: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue(makeEntry()),
        },
      }
      prisma.$transaction.mockImplementation(async (cb: (tx: MockTx) => Promise<unknown>) =>
        cb(mockTx),
      )

      await service.startTimer(TENANT_ID, USER_ID, TASK_ID)

      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        }),
      )
    })

    it('refuses a second concurrent timer with ConflictException', async () => {
      const mockTx: MockTx = {
        timeEntry: {
          findFirst: jest.fn().mockResolvedValue({ id: 'other-running' }),
          create: jest.fn(),
        },
      }
      prisma.$transaction.mockImplementation(async (cb: (tx: MockTx) => Promise<unknown>) =>
        cb(mockTx),
      )

      await expect(service.startTimer(TENANT_ID, USER_ID, TASK_ID)).rejects.toThrow(
        ConflictException,
      )
      expect(mockTx.timeEntry.create).not.toHaveBeenCalled()
      expect(auditService.log).not.toHaveBeenCalled()
    })

    it('maps a Prisma P2034 serialization failure to the same ConflictException', async () => {
      prisma.$transaction.mockRejectedValue(
        new PrismaClientKnownRequestError('Transaction failed due to a write conflict', {
          code: 'P2034',
          clientVersion: '5.22.0',
        }),
      )

      await expect(service.startTimer(TENANT_ID, USER_ID, TASK_ID)).rejects.toThrow(
        'A timer is already running. Stop it before starting a new one.',
      )
    })

    it('writes an audit row with entity TIME_ENTRY after a successful start', async () => {
      const mockTx: MockTx = {
        timeEntry: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue(makeEntry()),
        },
      }
      prisma.$transaction.mockImplementation(async (cb: (tx: MockTx) => Promise<unknown>) =>
        cb(mockTx),
      )

      await service.startTimer(TENANT_ID, USER_ID, TASK_ID)

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          userId: USER_ID,
          action: 'CREATE',
          entity: 'TIME_ENTRY',
          entityId: ENTRY_ID,
        }),
      )
    })
  })

  describe('stopTimer', () => {
    it('computes durationSeconds from the real interval and stops the timer', async () => {
      prisma.timeEntry.findFirst
        .mockResolvedValueOnce(
          makeEntry({
            startTime: new Date('2026-08-06T07:30:00.000Z'),
            endTime: null,
            durationSeconds: 0,
          }),
        )
        .mockResolvedValueOnce(
          makeEntry({
            endTime: new Date('2026-08-06T09:00:00.000Z'),
            durationSeconds: 5400,
          }),
        )
      prisma.timeEntry.updateMany.mockResolvedValue({ count: 1 })

      const stopped = await service.stopTimer(TENANT_ID, USER_ID, ENTRY_ID)

      expect(prisma.timeEntry.updateMany).toHaveBeenCalledWith({
        where: {
          id: ENTRY_ID,
          tenantId: TENANT_ID,
          userId: USER_ID,
          endTime: null,
          deletedAt: null,
        },
        data: expect.objectContaining({ durationSeconds: 5400, endTime: NOW }),
      })
      expect(stopped.durationSeconds).toBe(5400)
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', entity: 'TIME_ENTRY' }),
      )
    })

    it('throws NotFoundException when the entry is already stopped (updateMany count 0)', async () => {
      prisma.timeEntry.findFirst.mockResolvedValue(makeEntry({ endTime: null, durationSeconds: 0 }))
      prisma.timeEntry.updateMany.mockResolvedValue({ count: 0 })

      await expect(service.stopTimer(TENANT_ID, USER_ID, ENTRY_ID)).rejects.toThrow(
        NotFoundException,
      )
    })

    it("refuses to stop another user's timer (userId scoped updateMany)", async () => {
      prisma.timeEntry.findFirst.mockResolvedValue(makeEntry({ endTime: null, durationSeconds: 0 }))
      // The service must scope the update by the CALLER's userId — an entry
      // owned by someone else falls out of the where and count is 0.
      prisma.timeEntry.updateMany.mockImplementation((args: { where: { userId: string } }) => {
        if (args.where.userId === OTHER_USER_ID) return Promise.resolve({ count: 1 })
        return Promise.resolve({ count: 0 })
      })

      await expect(service.stopTimer(TENANT_ID, USER_ID, ENTRY_ID)).rejects.toThrow(
        NotFoundException,
      )
      expect(prisma.timeEntry.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: USER_ID }) }),
      )
    })
  })

  describe('createTimeEntry', () => {
    const validInput = { taskId: TASK_ID, durationSeconds: 1800 }

    it('calls TasksService.findOne and propagates NotFoundException for an invisible task', async () => {
      tasksService.findOne.mockRejectedValue(new NotFoundException('Task not found'))

      await expect(service.createTimeEntry(TENANT_ID, USER_ID, validInput)).rejects.toThrow(
        NotFoundException,
      )
      expect(prisma.timeEntry.create).not.toHaveBeenCalled()
    })

    it.each([
      [0, 'zero'],
      [-1, 'negative'],
      [86401, 'over the 24h cap'],
    ])('rejects durationSeconds %s (%s) with BadRequestException', async (duration) => {
      await expect(
        service.createTimeEntry(TENANT_ID, USER_ID, {
          taskId: TASK_ID,
          durationSeconds: duration as number,
        }),
      ).rejects.toThrow(BadRequestException)
      expect(prisma.timeEntry.create).not.toHaveBeenCalled()
    })

    it('rejects non-integer durations with BadRequestException', async () => {
      await expect(
        service.createTimeEntry(TENANT_ID, USER_ID, { taskId: TASK_ID, durationSeconds: 60.5 }),
      ).rejects.toThrow(BadRequestException)
    })

    it('defaults startTime to now - durationSeconds and writes a consistent endTime', async () => {
      prisma.timeEntry.create.mockResolvedValue(makeEntry())

      await service.createTimeEntry(TENANT_ID, USER_ID, validInput)

      const data = prisma.timeEntry.create.mock.calls[0]![0]!.data as {
        startTime: Date
        endTime: Date
        durationSeconds: number
      }
      expect(data.durationSeconds).toBe(1800)
      expect(data.endTime.getTime() - data.startTime.getTime()).toBe(1800 * 1000)
      // Defaulted startTime lands 30 minutes before the faked "now".
      expect(data.startTime.getTime()).toBe(NOW.getTime() - 1800 * 1000)
    })

    it('uses an explicit startTime and still writes endTime = startTime + duration', async () => {
      prisma.timeEntry.create.mockResolvedValue(makeEntry())
      const startTime = '2026-08-06T06:00:00.000Z'

      await service.createTimeEntry(TENANT_ID, USER_ID, {
        taskId: TASK_ID,
        durationSeconds: 3600,
        startTime,
        description: 'Manual correction',
      })

      const data = prisma.timeEntry.create.mock.calls[0]![0]!.data as {
        startTime: Date
        endTime: Date
        description: string
      }
      expect(data.startTime.toISOString()).toBe(startTime)
      expect(data.endTime.toISOString()).toBe('2026-08-06T07:00:00.000Z')
      expect(data.description).toBe('Manual correction')
    })

    it('writes an audit row after creating', async () => {
      prisma.timeEntry.create.mockResolvedValue(makeEntry())

      await service.createTimeEntry(TENANT_ID, USER_ID, validInput)

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entity: 'TIME_ENTRY', entityId: ENTRY_ID }),
      )
    })
  })

  describe('updateTimeEntry', () => {
    it('recomputes endTime when durationSeconds changes on a stopped entry', async () => {
      prisma.timeEntry.findFirst.mockResolvedValue(
        makeEntry({
          startTime: new Date('2026-08-06T08:00:00.000Z'),
          endTime: new Date('2026-08-06T08:30:00.000Z'),
          durationSeconds: 1800,
        }),
      )
      prisma.timeEntry.updateMany.mockResolvedValue({ count: 1 })
      prisma.timeEntry.findFirst.mockResolvedValueOnce(
        makeEntry({
          startTime: new Date('2026-08-06T08:00:00.000Z'),
          endTime: new Date('2026-08-06T08:30:00.000Z'),
          durationSeconds: 1800,
        }),
      )
      prisma.timeEntry.findFirst.mockResolvedValueOnce(
        makeEntry({
          startTime: new Date('2026-08-06T08:00:00.000Z'),
          endTime: new Date('2026-08-06T09:00:00.000Z'),
          durationSeconds: 3600,
        }),
      )

      const updated = await service.updateTimeEntry(TENANT_ID, USER_ID, ENTRY_ID, {
        durationSeconds: 3600,
      })

      expect(prisma.timeEntry.updateMany).toHaveBeenCalledWith({
        where: { id: ENTRY_ID, tenantId: TENANT_ID, deletedAt: null },
        data: expect.objectContaining({
          durationSeconds: 3600,
          endTime: new Date('2026-08-06T09:00:00.000Z'),
        }),
      })
      expect(updated.durationSeconds).toBe(3600)
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', entity: 'TIME_ENTRY' }),
      )
    })

    it('recomputes endTime when startTime changes', async () => {
      prisma.timeEntry.findFirst.mockResolvedValue(
        makeEntry({
          startTime: new Date('2026-08-06T08:00:00.000Z'),
          endTime: new Date('2026-08-06T08:30:00.000Z'),
          durationSeconds: 1800,
        }),
      )
      prisma.timeEntry.updateMany.mockResolvedValue({ count: 1 })
      prisma.timeEntry.findFirst.mockResolvedValueOnce(
        makeEntry({
          startTime: new Date('2026-08-06T08:00:00.000Z'),
          endTime: new Date('2026-08-06T08:30:00.000Z'),
          durationSeconds: 1800,
        }),
      )
      prisma.timeEntry.findFirst.mockResolvedValueOnce(makeEntry())

      await service.updateTimeEntry(TENANT_ID, USER_ID, ENTRY_ID, {
        startTime: '2026-08-06T07:00:00.000Z',
      })

      expect(prisma.timeEntry.updateMany).toHaveBeenCalledWith({
        where: { id: ENTRY_ID, tenantId: TENANT_ID, deletedAt: null },
        data: expect.objectContaining({
          startTime: new Date('2026-08-06T07:00:00.000Z'),
          endTime: new Date('2026-08-06T07:30:00.000Z'),
        }),
      })
    })

    it('refuses to edit a running entry (endTime null)', async () => {
      prisma.timeEntry.findFirst.mockResolvedValue(makeEntry({ endTime: null, durationSeconds: 0 }))

      await expect(
        service.updateTimeEntry(TENANT_ID, USER_ID, ENTRY_ID, { durationSeconds: 3600 }),
      ).rejects.toThrow(BadRequestException)
      expect(prisma.timeEntry.updateMany).not.toHaveBeenCalled()
    })

    it('validates the new duration against the 1..86400 window', async () => {
      prisma.timeEntry.findFirst.mockResolvedValue(
        makeEntry({ endTime: new Date('2026-08-06T08:30:00.000Z'), durationSeconds: 1800 }),
      )

      await expect(
        service.updateTimeEntry(TENANT_ID, USER_ID, ENTRY_ID, { durationSeconds: 86401 }),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws NotFoundException when the entry is gone (count 0)', async () => {
      prisma.timeEntry.findFirst.mockResolvedValue(makeEntry())
      prisma.timeEntry.updateMany.mockResolvedValue({ count: 0 })

      await expect(
        service.updateTimeEntry(TENANT_ID, USER_ID, ENTRY_ID, { description: 'x' }),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('deleteTimeEntry', () => {
    it('soft-deletes via updateMany (deletedAt set, never a hard delete)', async () => {
      prisma.timeEntry.findFirst.mockResolvedValue(makeEntry())
      prisma.timeEntry.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.deleteTimeEntry(TENANT_ID, USER_ID, ENTRY_ID)

      expect(result).toBe(true)
      const call = prisma.timeEntry.updateMany.mock.calls[0]![0]!
      expect(call.where).toEqual({ id: ENTRY_ID, tenantId: TENANT_ID, deletedAt: null })
      expect((call.data as { deletedAt: Date }).deletedAt).toBeInstanceOf(Date)
      expect((prisma.timeEntry as unknown as { delete?: unknown }).delete).toBeUndefined()
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DELETE', entity: 'TIME_ENTRY' }),
      )
    })

    it('throws NotFoundException when the entry is already deleted', async () => {
      prisma.timeEntry.findFirst.mockResolvedValue(makeEntry())
      prisma.timeEntry.updateMany.mockResolvedValue({ count: 0 })

      await expect(service.deleteTimeEntry(TENANT_ID, USER_ID, ENTRY_ID)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('findOne (visibility oracle)', () => {
    it('returns the entry for a caller whose scope covers it (OWN)', async () => {
      prisma.timeEntry.findFirst.mockResolvedValue(makeEntry())

      const entry = await service.findOne(TENANT_ID, USER_ID, ENTRY_ID)

      expect(entry.id).toBe(ENTRY_ID)
    })

    it("hides another user's entry from an OWN-scoped NON-ADMIN caller", async () => {
      mockResolveVisibilityFilter.mockResolvedValue(USER_ID)
      prisma.timeEntry.findFirst.mockResolvedValue(makeEntry({ userId: OTHER_USER_ID }))

      await expect(service.findOne(TENANT_ID, USER_ID, ENTRY_ID)).rejects.toThrow(NotFoundException)
    })

    it('hides a cross-tenant entry (NON-ADMIN)', async () => {
      mockResolveVisibilityFilter.mockResolvedValue(USER_ID)
      // The tenant scope lives in the WHERE — a row from another tenant never
      // matches it, exactly as it never would in the real database.
      prisma.timeEntry.findFirst.mockImplementation((args: { where: { tenantId: string } }) => {
        if (args.where.tenantId !== TENANT_ID) {
          return Promise.resolve(makeEntry({ tenantId: OTHER_TENANT_ID }))
        }
        return Promise.resolve(null)
      })

      await expect(service.findOne(TENANT_ID, USER_ID, ENTRY_ID)).rejects.toThrow(NotFoundException)
      expect(prisma.timeEntry.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenantId: TENANT_ID }) }),
      )
    })

    it("lets an ADMIN (undefined filter = bypass) read any user's entry", async () => {
      mockResolveVisibilityFilter.mockResolvedValue(undefined)
      prisma.timeEntry.findFirst.mockResolvedValue(makeEntry({ userId: OTHER_USER_ID }))

      const entry = await service.findOne(TENANT_ID, USER_ID, ENTRY_ID)

      expect(entry.userId).toBe(OTHER_USER_ID)
    })
  })

  describe('buildTimeEntryWhere', () => {
    it('starts from { tenantId, deletedAt: null } always', async () => {
      mockResolveVisibilityFilter.mockResolvedValue(USER_ID)

      const where = await service.buildTimeEntryWhere(TENANT_ID, USER_ID, {})

      expect(where.tenantId).toBe(TENANT_ID)
      expect(where.deletedAt).toBeNull()
      expect(where.AND).toEqual([{ userId: USER_ID }])
    })

    it('composes the userId scope for each resolveVisibilityFilter shape', async () => {
      mockResolveVisibilityFilter.mockResolvedValue(undefined)
      expect((await service.buildTimeEntryWhere(TENANT_ID, USER_ID, {})).AND).toBeUndefined()

      mockResolveVisibilityFilter.mockResolvedValue(USER_ID)
      expect((await service.buildTimeEntryWhere(TENANT_ID, USER_ID, {})).AND).toEqual([
        { userId: USER_ID },
      ])

      mockResolveVisibilityFilter.mockResolvedValue({ in: [USER_ID, OTHER_USER_ID] })
      expect((await service.buildTimeEntryWhere(TENANT_ID, USER_ID, {})).AND).toEqual([
        { userId: { in: [USER_ID, OTHER_USER_ID] } },
      ])
    })

    it('applies the explicit userId filter on top of the scope', async () => {
      mockResolveVisibilityFilter.mockResolvedValue(USER_ID)

      const where = await service.buildTimeEntryWhere(TENANT_ID, USER_ID, { userId: OTHER_USER_ID })

      expect(where.AND).toEqual([{ userId: USER_ID }, { userId: OTHER_USER_ID }])
    })

    it('makes startTo inclusive of the whole final day', async () => {
      const where = await service.buildTimeEntryWhere(TENANT_ID, USER_ID, {
        startFrom: '2026-08-01',
        startTo: '2026-08-06',
      })

      const dateFilter = (where.AND as Prisma.TimeEntryWhereInput[]).find(
        (c) => (c as { startTime?: unknown }).startTime !== undefined,
      ) as { startTime: { gte: Date; lte: Date } }
      expect(dateFilter.startTime.gte.toISOString()).toBe(new Date('2026-08-01').toISOString())
      // The bound is the UTC end of the final day (setUTCHours) — the day
      // is the UTC day everywhere in this feature (AC 23, todayUtc()), and
      // the literal instant is TZ-independent so this assertion holds in
      // any TZ (T5 trap — setHours would truncate on non-UTC servers).
      expect(dateFilter.startTime.lte.toISOString()).toBe('2026-08-06T23:59:59.999Z')
    })

    it('maps runningOnly to endTime: null', async () => {
      const where = await service.buildTimeEntryWhere(TENANT_ID, USER_ID, { runningOnly: true })

      expect(where.AND).toEqual([{ userId: USER_ID }, { endTime: null }])
    })

    it('ignores unknown/empty filter values', async () => {
      const where = await service.buildTimeEntryWhere(TENANT_ID, USER_ID, {
        taskId: '',
        userId: '',
        runningOnly: false,
      })

      expect(where.AND).toEqual([{ userId: USER_ID }])
    })
  })

  describe('findMany', () => {
    it('returns the house connection shape', async () => {
      prisma.timeEntry.findMany.mockResolvedValue([makeEntry()])
      prisma.timeEntry.count.mockResolvedValue(1)

      const result = await service.findMany(TENANT_ID, USER_ID)

      expect(result).toEqual({
        items: [expect.objectContaining({ id: ENTRY_ID })],
        total: 1,
        page: 1,
        pageSize: 20,
      })
    })

    it('clamps pageSize at 100', async () => {
      prisma.timeEntry.findMany.mockResolvedValue([])
      prisma.timeEntry.count.mockResolvedValue(0)

      await service.findMany(TENANT_ID, USER_ID, {}, { page: 1, pageSize: 999 })

      const call = prisma.timeEntry.findMany.mock.calls[0]![0]!
      expect(call.take).toBe(100)
    })

    it('orders by startTime desc with id desc as the stable tiebreaker', async () => {
      prisma.timeEntry.findMany.mockResolvedValue([])
      prisma.timeEntry.count.mockResolvedValue(0)

      await service.findMany(TENANT_ID, USER_ID, {}, { page: 1, pageSize: 20 })

      expect(prisma.timeEntry.findMany.mock.calls[0]![0]!.orderBy).toEqual([
        { startTime: 'desc' },
        { id: 'desc' },
      ])
    })
  })

  describe('findActive', () => {
    it("returns the caller's single running entry", async () => {
      prisma.timeEntry.findFirst.mockResolvedValue(makeEntry({ endTime: null }))

      const active = await service.findActive(TENANT_ID, USER_ID)

      expect(active?.id).toBe(ENTRY_ID)
      expect(prisma.timeEntry.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT_ID, userId: USER_ID, endTime: null, deletedAt: null },
        }),
      )
    })

    it('returns null when no timer is running', async () => {
      prisma.timeEntry.findFirst.mockResolvedValue(null)

      await expect(service.findActive(TENANT_ID, USER_ID)).resolves.toBeNull()
    })
  })

  describe('TIME_ENTRY_SELECT', () => {
    it('covers every field the Pothos TimeEntry ref exposes, including nested task', () => {
      // Walk the ref surface in time-tracking.graphql.ts: id, taskId, userId,
      // startTime, endTime, durationSeconds, description, createdAt, updatedAt,
      // task { id, title }. A missing field crashes at QUERY time, not compile time.
      const select = { ...TIME_ENTRY_SELECT } as Record<string, unknown>
      for (const field of [
        'id',
        'taskId',
        'userId',
        'startTime',
        'endTime',
        'durationSeconds',
        'description',
        'createdAt',
        'updatedAt',
      ]) {
        expect(select[field]).toBe(true)
      }
      expect(select['task']).toEqual({ select: { id: true, title: true } })
    })
  })
})

import { TIME_ENTRY_SELECT } from '../time-entries.service'
import type { PrismaService } from '../../prisma/prisma.service'
