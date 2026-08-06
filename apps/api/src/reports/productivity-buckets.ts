// ─── Pure UTC bucketing for the productivity report (Story 4.5, AC 23-24) ───
//
// Framework-free, React-free, Prisma-free — exhaustively unit-tested in
// productivity-buckets.spec.ts. All math is native Date with getUTC* accessors
// so every answer is TZ-independent by construction (finding 3.7-F4: a UTC
// timestamp must never land in a local-time bucket).
//
// This is the BACKEND TWIN of apps/web/src/lib/time-format.ts: the web side
// re-declares TIME_CHART_COLORS and the tick/duration formatters, this side
// owns the day/week/month keys. There is no shared packages/* — keep the two
// files in sync (docs/project-context.md › "Consequence of the empty
// packages": hand-duplication with a cross-reference comment).

export type ProductivityBucket = 'DAY' | 'WEEK' | 'MONTH'

/** UTC midnight (start of day) of the given instant. */
export function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function formatKey(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * The bucket key an instant falls into:
 * - DAY:   yyyy-mm-dd of the UTC day
 * - WEEK:  the Monday UTC-midnight of the ISO week (getUTCDay() 0=Sun..6=Sat;
 *          Monday is (day + 6) % 7 days back)
 * - MONTH: the 1st of the UTC month
 */
export function bucketKey(date: Date, bucket: ProductivityBucket): string {
  if (bucket === 'MONTH') {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`
  }
  const midnight = toUtcMidnight(date)
  if (bucket === 'DAY') {
    return formatKey(midnight)
  }
  // WEEK
  const mondayOffset = (midnight.getUTCDay() + 6) % 7
  midnight.setUTCDate(midnight.getUTCDate() - mondayOffset)
  return formatKey(midnight)
}

/**
 * The dense, zero-filled key list from `from` to `to` (both inclusive) so a
 * day/week/month with no tracked time renders as a zero bar rather than
 * vanishing from the chart. setUTCDate(getUTCDate() + n) rolls months and
 * years correctly (avoid setUTCMonth for grid maths — 31 Jan + 1 month is
 * 3 March).
 */
export function enumerateBuckets(from: Date, to: Date, bucket: ProductivityBucket): string[] {
  const keys: string[] = []
  const current = toUtcMidnight(from)
  const end = toUtcMidnight(to)
  const stepDays = bucket === 'WEEK' ? 7 : 1
  let cursor = current

  while (cursor <= end) {
    keys.push(bucketKey(cursor, bucket))
    if (bucket === 'MONTH') {
      // Advance to the 1st of the next month from the 1st — safe day-of-month.
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
    } else {
      cursor.setUTCDate(cursor.getUTCDate() + stepDays)
    }
  }
  return keys
}

/**
 * A part-over-total percentage rounded to one decimal. Returns 0 when the
 * total is 0 — never NaN, never a division by zero (AC 23).
 */
export function percentageOf(part: number, total: number): number {
  if (total === 0) return 0
  return Math.round((part / total) * 1000) / 10
}

export type TaskTimeRow = {
  taskId: string
  taskTitle: string
  totalSeconds: number
}

/**
 * Cap a sorted-by-totalSeconds list at the top n rows plus one aggregated
 * `Other` row carrying the sum of the tail (AC 24 — a pie chart with 200
 * slices is not a chart). taskId '' is the null-equivalent for the Other row.
 * Pure so it is testable without Prisma.
 */
export function collapseToTopN(rows: TaskTimeRow[], n: number, otherLabel: string): TaskTimeRow[] {
  if (rows.length <= n) return rows
  const sorted = [...rows].sort((a, b) => b.totalSeconds - a.totalSeconds)
  const top = sorted.slice(0, n)
  const tailTotal = sorted.slice(n).reduce((sum, row) => sum + row.totalSeconds, 0)
  return [...top, { taskId: '', taskTitle: otherLabel, totalSeconds: tailTotal }]
}
