import {
  TASK_DUE_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  daysBetweenUtc,
  isTaskPriority,
  isTaskStatus,
  resolveDueStatus,
  toUtcMidnight,
} from '../task-due-status'
import type { TaskStatus } from '../task-due-status'

describe('task-due-status tuples and guards', () => {
  it('exports TASK_STATUSES with exactly the four values of AC 2', () => {
    expect(TASK_STATUSES).toEqual(['TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
    expect(TASK_STATUSES).toHaveLength(4)
  })

  it('exports TASK_PRIORITIES with exactly the four values of AC 2', () => {
    expect(TASK_PRIORITIES).toEqual(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
    expect(TASK_PRIORITIES).toHaveLength(4)
  })

  it('exports TASK_DUE_STATUSES with exactly the five values of AC 3', () => {
    expect(TASK_DUE_STATUSES).toEqual(['NO_DUE_DATE', 'OVERDUE', 'DUE_TODAY', 'UPCOMING', 'DONE'])
    expect(TASK_DUE_STATUSES).toHaveLength(5)
  })

  it('isTaskStatus accepts every member and rejects everything else', () => {
    for (const status of TASK_STATUSES) {
      expect(isTaskStatus(status)).toBe(true)
    }
    expect(isTaskStatus('BLOCKED')).toBe(false)
    expect(isTaskStatus('todo')).toBe(false)
    expect(isTaskStatus('')).toBe(false)
  })

  it('isTaskPriority accepts every member and rejects everything else', () => {
    for (const priority of TASK_PRIORITIES) {
      expect(isTaskPriority(priority)).toBe(true)
    }
    expect(isTaskPriority('CRITICAL')).toBe(false)
    expect(isTaskPriority('medium')).toBe(false)
  })

  it('type guards narrow the union at compile time', () => {
    const value: string = 'IN_PROGRESS'
    if (isTaskStatus(value)) {
      const status: TaskStatus = value
      expect(status).toBe('IN_PROGRESS')
    } else {
      throw new Error('expected the guard to accept IN_PROGRESS')
    }
  })
})

describe('toUtcMidnight', () => {
  it('normalises a mid-day instant to its UTC calendar day', () => {
    const result = toUtcMidnight(new Date('2026-08-02T14:37:12.345Z'))
    expect(result.toISOString()).toBe('2026-08-02T00:00:00.000Z')
  })

  it('normalises a time before UTC midnight boundary correctly (00:01)', () => {
    const result = toUtcMidnight(new Date('2026-08-02T00:00:01.000Z'))
    expect(result.toISOString()).toBe('2026-08-02T00:00:00.000Z')
  })

  it('normalises a time at 23:59:59.999 to the same calendar day', () => {
    const result = toUtcMidnight(new Date('2026-08-02T23:59:59.999Z'))
    expect(result.toISOString()).toBe('2026-08-02T00:00:00.000Z')
  })

  it('is idempotent on an already-midnight date', () => {
    const midnight = new Date('2026-08-02T00:00:00.000Z')
    expect(toUtcMidnight(midnight).toISOString()).toBe('2026-08-02T00:00:00.000Z')
  })
})

describe('daysBetweenUtc', () => {
  it('returns 0 for two instants on the same UTC day', () => {
    const from = new Date('2026-08-02T01:00:00.000Z')
    const to = new Date('2026-08-02T23:00:00.000Z')
    expect(daysBetweenUtc(from, to)).toBe(0)
  })

  it('returns 1 for consecutive UTC days', () => {
    const from = new Date('2026-08-02T23:59:59.999Z')
    const to = new Date('2026-08-03T00:00:00.000Z')
    expect(daysBetweenUtc(from, to)).toBe(1)
  })

  it('returns a positive count for dates further apart', () => {
    const from = new Date('2026-07-01T00:00:00.000Z')
    const to = new Date('2026-08-02T00:00:00.000Z')
    expect(daysBetweenUtc(from, to)).toBe(32)
  })
})

describe('resolveDueStatus precedence (AC 5)', () => {
  const now = new Date('2026-08-03T12:00:00.000Z')

  it('COMPLETED → DONE regardless of due date', () => {
    expect(
      resolveDueStatus({ status: 'COMPLETED', dueDate: new Date('2026-07-01T00:00:00.000Z') }, now),
    ).toBe('DONE')
  })

  it('CANCELLED → DONE and never OVERDUE even with a past due date', () => {
    expect(
      resolveDueStatus({ status: 'CANCELLED', dueDate: new Date('2026-07-01T00:00:00.000Z') }, now),
    ).toBe('DONE')
  })

  it('null dueDate → NO_DUE_DATE', () => {
    expect(resolveDueStatus({ status: 'TODO', dueDate: null }, now)).toBe('NO_DUE_DATE')
    expect(resolveDueStatus({ status: 'IN_PROGRESS', dueDate: null }, now)).toBe('NO_DUE_DATE')
  })

  it('due date before today → OVERDUE', () => {
    expect(
      resolveDueStatus({ status: 'TODO', dueDate: new Date('2026-08-02T00:00:00.000Z') }, now),
    ).toBe('OVERDUE')
  })

  it('due date on the same UTC day as now → DUE_TODAY', () => {
    expect(
      resolveDueStatus(
        { status: 'IN_PROGRESS', dueDate: new Date('2026-08-03T00:00:00.000Z') },
        now,
      ),
    ).toBe('DUE_TODAY')
  })

  it('due date after today → UPCOMING', () => {
    expect(
      resolveDueStatus({ status: 'TODO', dueDate: new Date('2026-08-04T00:00:00.000Z') }, now),
    ).toBe('UPCOMING')
  })

  it('day boundary: dueDate 23:59:59.999 on 2026-08-02 with now 2026-08-03 00:00:00 → OVERDUE', () => {
    const boundaryNow = new Date('2026-08-03T00:00:00.000Z')
    expect(
      resolveDueStatus(
        { status: 'TODO', dueDate: new Date('2026-08-02T23:59:59.999Z') },
        boundaryNow,
      ),
    ).toBe('OVERDUE')
  })

  it('day boundary: dueDate exactly 2026-08-03 00:00:00 with now 2026-08-03 00:00:00 → DUE_TODAY', () => {
    const boundaryNow = new Date('2026-08-03T00:00:00.000Z')
    expect(
      resolveDueStatus(
        { status: 'TODO', dueDate: new Date('2026-08-03T00:00:00.000Z') },
        boundaryNow,
      ),
    ).toBe('DUE_TODAY')
  })

  it('day boundary: dueDate 2026-08-03 00:00:01 with now 2026-08-03 00:00:00 → DUE_TODAY (same UTC day)', () => {
    const boundaryNow = new Date('2026-08-03T00:00:00.000Z')
    expect(
      resolveDueStatus(
        { status: 'TODO', dueDate: new Date('2026-08-03T00:00:01.000Z') },
        boundaryNow,
      ),
    ).toBe('DUE_TODAY')
  })

  it('day boundary: dueDate 2026-08-04 00:00:00 with now 2026-08-03 23:59:59.999 → UPCOMING (next UTC day)', () => {
    const boundaryNow = new Date('2026-08-03T23:59:59.999Z')
    expect(
      resolveDueStatus(
        { status: 'TODO', dueDate: new Date('2026-08-04T00:00:00.000Z') },
        boundaryNow,
      ),
    ).toBe('UPCOMING')
  })
})
