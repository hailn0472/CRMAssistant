import { BadRequestException, ForbiddenException } from '@nestjs/common'

import { ProductivityService, MAX_REPORT_ENTRIES } from '../productivity.service'
import type { ProductivityReportInput } from '../productivity.service'
import { TimeEntriesService } from '../../time-tracking/time-entries.service'

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

type ReportEntry = {
  id: string
  taskId: string
  startTime: Date
  durationSeconds: number
  task: {
    id: string
    title: string
    contactId: string | null
    dealId: string | null
    contact: { firstName: string; lastName: string } | null
    deal: { title: string } | null
  }
}

function makeEntry(overrides: Partial<ReportEntry> = {}): ReportEntry {
  return {
    id: 'entry-1',
    taskId: 'task-1',
    startTime: new Date('2026-08-06T08:00:00.000Z'),
    durationSeconds: 3600,
    task: {
      id: 'task-1',
      title: 'Follow up with Acme',
      contactId: 'contact-1',
      dealId: null,
      contact: { firstName: 'Grace', lastName: 'Hopper' },
      deal: null,
    },
    ...overrides,
  }
}

describe('ProductivityService', () => {
  let prisma: { timeEntry: { findMany: jest.Mock } }
  let timeEntriesService: { buildTimeEntryWhere: jest.Mock }
  let service: ProductivityService

  beforeEach(() => {
    prisma = { timeEntry: { findMany: jest.fn() } }
    timeEntriesService = {
      buildTimeEntryWhere: jest.fn().mockResolvedValue({
        tenantId: TENANT_ID,
        deletedAt: null,
        AND: [{ userId: CALLER_ID }],
      }),
    }
    mockResolveVisibilityFilter.mockReset()
    mockResolveVisibilityFilter.mockResolvedValue(CALLER_ID)

    service = new ProductivityService(
      prisma as never,
      timeEntriesService as unknown as TimeEntriesService,
    )
  })

  const baseInput: ProductivityReportInput = {
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    bucket: 'DAY',
  }

  describe('date validation (AC 16)', () => {
    it('throws BadRequestException when endDate < startDate', async () => {
      await expect(
        service.productivityReport(TENANT_ID, CALLER_ID, {
          ...baseInput,
          startDate: '2026-09-01',
          endDate: '2026-08-31',
        }),
      ).rejects.toThrow(BadRequestException)
      expect(prisma.timeEntry.findMany).not.toHaveBeenCalled()
    })

    it('throws BadRequestException for a 367-day range', async () => {
      await expect(
        service.productivityReport(TENANT_ID, CALLER_ID, {
          ...baseInput,
          startDate: '2026-01-01',
          endDate: '2027-01-03',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('accepts a 366-day range', async () => {
      prisma.timeEntry.findMany.mockResolvedValue([])
      mockResolveVisibilityFilter.mockResolvedValue(undefined)

      await expect(
        service.productivityReport(TENANT_ID, CALLER_ID, {
          ...baseInput,
          startDate: '2026-01-01',
          endDate: '2027-01-02',
        }),
      ).resolves.toBeDefined()
    })
  })

  describe('cross-user access (AC 17) — tested as NON-ADMIN', () => {
    it('defaults the report subject to the caller when userId is omitted', async () => {
      prisma.timeEntry.findMany.mockResolvedValue([])

      await service.productivityReport(TENANT_ID, CALLER_ID, baseInput)

      expect(timeEntriesService.buildTimeEntryWhere).toHaveBeenCalledWith(
        TENANT_ID,
        CALLER_ID,
        expect.objectContaining({ userId: CALLER_ID }),
      )
    })

    it('refuses an OWN-scoped caller reading another user', async () => {
      mockResolveVisibilityFilter.mockResolvedValue(CALLER_ID)

      await expect(
        service.productivityReport(TENANT_ID, CALLER_ID, { ...baseInput, userId: TEAMMATE_ID }),
      ).rejects.toThrow(ForbiddenException)
      expect(prisma.timeEntry.findMany).not.toHaveBeenCalled()
    })

    it('lets a TEAM-scoped caller read a teammate but refuses an outsider', async () => {
      mockResolveVisibilityFilter.mockResolvedValue({ in: [CALLER_ID, TEAMMATE_ID] })
      prisma.timeEntry.findMany.mockResolvedValue([])

      await expect(
        service.productivityReport(TENANT_ID, CALLER_ID, { ...baseInput, userId: TEAMMATE_ID }),
      ).resolves.toBeDefined()

      await expect(
        service.productivityReport(TENANT_ID, CALLER_ID, { ...baseInput, userId: OUTSIDER_ID }),
      ).rejects.toThrow(ForbiddenException)
    })

    it('lets an ADMIN (undefined filter = bypass) read anyone', async () => {
      mockResolveVisibilityFilter.mockResolvedValue(undefined)
      prisma.timeEntry.findMany.mockResolvedValue([])

      await expect(
        service.productivityReport(TENANT_ID, CALLER_ID, { ...baseInput, userId: OUTSIDER_ID }),
      ).resolves.toBeDefined()
    })
  })

  describe('scope delegation (AC 18)', () => {
    it('composes buildTimeEntryWhere with the subject and the date range — never a second predicate', async () => {
      prisma.timeEntry.findMany.mockResolvedValue([])
      mockResolveVisibilityFilter.mockResolvedValue(undefined)

      await service.productivityReport(TENANT_ID, CALLER_ID, {
        ...baseInput,
        userId: TEAMMATE_ID,
      })

      expect(timeEntriesService.buildTimeEntryWhere).toHaveBeenCalledWith(TENANT_ID, CALLER_ID, {
        userId: TEAMMATE_ID,
        startFrom: '2026-08-01',
        startTo: '2026-08-31',
      })
      // The running-exclusion is layered on the composed where (AC 21), not
      // re-derived.
      const where = prisma.timeEntry.findMany.mock.calls[0]![0]!.where
      expect(where.AND).toEqual(
        expect.arrayContaining([expect.objectContaining({ endTime: { not: null } })]),
      )
    })

    it('fetches exactly once with the narrow report select (AC 19)', async () => {
      prisma.timeEntry.findMany.mockResolvedValue([])

      await service.productivityReport(TENANT_ID, CALLER_ID, baseInput)

      expect(prisma.timeEntry.findMany).toHaveBeenCalledTimes(1)
      const call = prisma.timeEntry.findMany.mock.calls[0]![0]!
      expect(call.select).toEqual(
        expect.objectContaining({
          id: true,
          taskId: true,
          startTime: true,
          durationSeconds: true,
          task: expect.objectContaining({
            select: expect.objectContaining({
              contact: { select: { firstName: true, lastName: true } },
              deal: { select: { title: true } },
            }),
          }),
        }),
      )
    })
  })

  describe('bounded fetch (AC 20)', () => {
    it('throws instead of truncating when the range exceeds MAX_REPORT_ENTRIES', async () => {
      prisma.timeEntry.findMany.mockResolvedValue(
        Array.from({ length: MAX_REPORT_ENTRIES + 1 }, (_, i) => makeEntry({ id: `e${i}` })),
      )

      await expect(service.productivityReport(TENANT_ID, CALLER_ID, baseInput)).rejects.toThrow(
        BadRequestException,
      )
    })

    it('asks for MAX_REPORT_ENTRIES + 1 rows to detect overflow', async () => {
      prisma.timeEntry.findMany.mockResolvedValue([])

      await service.productivityReport(TENANT_ID, CALLER_ID, baseInput)

      expect(prisma.timeEntry.findMany.mock.calls[0]![0]!.take).toBe(MAX_REPORT_ENTRIES + 1)
    })
  })

  describe('aggregation (AC 15, 21-22, 24)', () => {
    it('computes the full result shape from one in-memory reduce', async () => {
      prisma.timeEntry.findMany.mockResolvedValue([
        makeEntry({
          id: 'e1',
          taskId: 'task-1',
          startTime: new Date('2026-08-06T08:00:00.000Z'),
          durationSeconds: 3600,
        }),
        makeEntry({
          id: 'e2',
          taskId: 'task-2',
          startTime: new Date('2026-08-06T10:00:00.000Z'),
          durationSeconds: 1800,
          task: {
            id: 'task-2',
            title: 'Proposal review',
            contactId: null,
            dealId: 'deal-1',
            contact: null,
            deal: { title: 'CloudTech deal' },
          },
        }),
        makeEntry({
          id: 'e3',
          taskId: 'task-3',
          startTime: new Date('2026-08-07T09:00:00.000Z'),
          durationSeconds: 600,
          task: {
            id: 'task-3',
            title: 'Unlinked work',
            contactId: null,
            dealId: null,
            contact: null,
            deal: null,
          },
        }),
      ])

      const report = await service.productivityReport(TENANT_ID, CALLER_ID, baseInput)

      expect(report.totalSeconds).toBe(6000)
      expect(report.entryCount).toBe(3)
      expect(report.trackedDays).toBe(2)
      expect(report.averageSecondsPerTrackedDay).toBe(3000)
      expect(report.bucket).toBe('DAY')
      expect(report.userId).toBe(CALLER_ID)

      // byTask sorted desc with percentages.
      expect(report.byTask.map((t) => t.taskTitle)).toEqual([
        'Follow up with Acme',
        'Proposal review',
        'Unlinked work',
      ])
      expect(report.byTask[0]!.percentage).toBe(60)
      expect(report.byTask[1]!.percentage).toBe(30)
      expect(report.byTask[2]!.percentage).toBe(10)
      expect(report.byTask.reduce((sum, t) => sum + t.percentage, 0)).toBe(100)

      // byRelated sorted totalSeconds desc: CONTACT (3600), DEAL (1800), NONE (600).
      expect(report.byRelated.map((r) => r.kind)).toEqual(['CONTACT', 'DEAL', 'NONE'])
      expect(report.byRelated[0]).toEqual(
        expect.objectContaining({ id: 'contact-1', label: 'Grace Hopper', totalSeconds: 3600 }),
      )
      expect(report.byRelated[1]).toEqual(
        expect.objectContaining({ id: 'deal-1', label: 'CloudTech deal', totalSeconds: 1800 }),
      )
      expect(report.byRelated[2]).toEqual(
        expect.objectContaining({ id: null, label: 'Unlinked', totalSeconds: 600 }),
      )
    })

    it('produces dense zero-filled buckets for the whole range', async () => {
      prisma.timeEntry.findMany.mockResolvedValue([
        makeEntry({
          id: 'e1',
          startTime: new Date('2026-08-06T08:00:00.000Z'),
          durationSeconds: 3600,
        }),
      ])

      const report = await service.productivityReport(TENANT_ID, CALLER_ID, {
        ...baseInput,
        startDate: '2026-08-05',
        endDate: '2026-08-07',
      })

      expect(report.buckets).toHaveLength(3)
      expect(report.buckets[0]).toEqual({
        bucketStart: '2026-08-05T00:00:00.000Z',
        totalSeconds: 0,
      })
      expect(report.buckets[1]).toEqual({
        bucketStart: '2026-08-06T00:00:00.000Z',
        totalSeconds: 3600,
      })
      expect(report.buckets[2]).toEqual({
        bucketStart: '2026-08-07T00:00:00.000Z',
        totalSeconds: 0,
      })
    })

    it('caps byTask at 8 plus an Other row', async () => {
      const entries = Array.from({ length: 12 }, (_, i) =>
        makeEntry({
          id: `e${i}`,
          taskId: `task-${i}`,
          startTime: new Date(Date.UTC(2026, 7, 6, 8)),
          durationSeconds: (i + 1) * 100,
          task: {
            id: `task-${i}`,
            title: `Task ${i}`,
            contactId: null,
            dealId: null,
            contact: null,
            deal: null,
          },
        }),
      )
      prisma.timeEntry.findMany.mockResolvedValue(entries)

      const report = await service.productivityReport(TENANT_ID, CALLER_ID, baseInput)

      expect(report.byTask).toHaveLength(9)
      expect(report.byTask[8]!.taskTitle).toBe('Other')
      // Other sums the tail: durations 100..1200, top 8 = 500..1200, tail = 400+300+200+100.
      expect(report.byTask[8]!.totalSeconds).toBe(1000)
      // Percentages still sum to ~100 with no NaN.
      const sum = report.byTask.reduce((acc, t) => acc + t.percentage, 0)
      expect(Number.isNaN(sum)).toBe(false)
      expect(Math.round(sum)).toBe(100)
    })

    it('uses durationSeconds verbatim — never recomputes from startTime/endTime (AC 22)', async () => {
      // Hand-corrected entry: durationSeconds disagrees with the interval.
      prisma.timeEntry.findMany.mockResolvedValue([
        makeEntry({
          id: 'e1',
          startTime: new Date('2026-08-06T08:00:00.000Z'),
          durationSeconds: 999,
        }),
      ])

      const report = await service.productivityReport(TENANT_ID, CALLER_ID, baseInput)

      expect(report.totalSeconds).toBe(999)
      expect(report.byTask[0]!.totalSeconds).toBe(999)
      expect(
        report.buckets.find((b) => b.bucketStart === '2026-08-06T00:00:00.000Z')!.totalSeconds,
      ).toBe(999)
    })

    it('returns zeroed metrics for an empty range (no NaN anywhere)', async () => {
      prisma.timeEntry.findMany.mockResolvedValue([])

      const report = await service.productivityReport(TENANT_ID, CALLER_ID, baseInput)

      expect(report.totalSeconds).toBe(0)
      expect(report.entryCount).toBe(0)
      expect(report.trackedDays).toBe(0)
      expect(report.averageSecondsPerTrackedDay).toBe(0)
      expect(report.byTask).toEqual([])
      expect(report.byRelated).toEqual([])
      expect(report.buckets).toHaveLength(31)
    })

    it('aggregates WEEK and MONTH buckets on the UTC boundary', async () => {
      prisma.timeEntry.findMany.mockResolvedValue([
        makeEntry({
          id: 'e1',
          startTime: new Date('2026-08-03T00:30:00.000Z'), // Monday 08-03
          durationSeconds: 100,
        }),
        makeEntry({
          id: 'e2',
          startTime: new Date('2026-08-09T23:30:00.000Z'), // Sunday of the same ISO week
          durationSeconds: 200,
        }),
      ])

      const week = await service.productivityReport(TENANT_ID, CALLER_ID, {
        ...baseInput,
        startDate: '2026-08-03',
        endDate: '2026-08-09',
        bucket: 'WEEK',
      })
      expect(week.buckets).toHaveLength(1)
      expect(week.buckets[0]!.bucketStart).toBe('2026-08-03T00:00:00.000Z')
      expect(week.buckets[0]!.totalSeconds).toBe(300)

      const month = await service.productivityReport(TENANT_ID, CALLER_ID, {
        ...baseInput,
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        bucket: 'MONTH',
      })
      expect(month.buckets).toHaveLength(1)
      expect(month.buckets[0]!.bucketStart).toBe('2026-08-01T00:00:00.000Z')
      expect(month.buckets[0]!.totalSeconds).toBe(300)
    })
  })
})
