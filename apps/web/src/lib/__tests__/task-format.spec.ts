import {
  TASK_DUE_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  formatDueDate,
  isTaskPriority,
  isTaskStatus,
  resolveDueStatus,
  taskDueBadgeClass,
  taskPriorityBadgeClass,
  taskStatusBadgeClass,
  toUtcMidnight,
} from '../task-format'

describe('task-format tuples and guards (mirrors apps/api task-due-status)', () => {
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
  })

  it('isTaskPriority accepts every member and rejects everything else', () => {
    for (const priority of TASK_PRIORITIES) {
      expect(isTaskPriority(priority)).toBe(true)
    }
    expect(isTaskPriority('CRITICAL')).toBe(false)
  })
})

describe('toUtcMidnight (mirrors the API module)', () => {
  it('normalises a mid-day instant to its UTC calendar day', () => {
    expect(toUtcMidnight(new Date('2026-08-02T14:37:12.345Z')).toISOString()).toBe(
      '2026-08-02T00:00:00.000Z',
    )
  })

  it('normalises 23:59:59.999 to the same calendar day', () => {
    expect(toUtcMidnight(new Date('2026-08-02T23:59:59.999Z')).toISOString()).toBe(
      '2026-08-02T00:00:00.000Z',
    )
  })
})

describe('resolveDueStatus (AC 5, mirrored — day-boundary parity with the API spec, AC 93)', () => {
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

describe('formatDueDate', () => {
  it('renders an em-dash for null', () => {
    expect(formatDueDate(null)).toBe('\u2014')
  })

  it('renders an em-dash for an invalid date string', () => {
    expect(formatDueDate('not-a-date')).toBe('\u2014')
  })

  it('renders a locale date for a valid ISO string', () => {
    const result = formatDueDate('2026-08-05T00:00:00.000Z')
    expect(result).not.toBe('\u2014')
    expect(result.length).toBeGreaterThan(0)
  })
})

describe('badge classes — colour always paired with a text label', () => {
  it('taskStatusBadgeClass returns a class for every status', () => {
    for (const status of TASK_STATUSES) {
      expect(typeof taskStatusBadgeClass(status)).toBe('string')
      expect(taskStatusBadgeClass(status).length).toBeGreaterThan(0)
    }
  })

  it('taskPriorityBadgeClass returns a class for every priority', () => {
    for (const priority of TASK_PRIORITIES) {
      expect(typeof taskPriorityBadgeClass(priority)).toBe('string')
      expect(taskPriorityBadgeClass(priority).length).toBeGreaterThan(0)
    }
  })

  it('taskDueBadgeClass maps every due status to a distinct class', () => {
    const classes = TASK_DUE_STATUSES.map((s) => taskDueBadgeClass(s))
    expect(new Set(classes).size).toBe(TASK_DUE_STATUSES.length)
    expect(taskDueBadgeClass('OVERDUE')).toContain('text-red')
    expect(taskDueBadgeClass('DUE_TODAY')).toContain('text-amber')
    expect(taskDueBadgeClass('DONE')).toContain('text-emerald')
  })
})
