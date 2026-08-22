/**
 * Story 6.8 (Contract E30): activity → ReportDocumentPayload adapter.
 *
 * Pure module (no Nest/Prisma): converts the authoritative
 * ActivityReportsService result + the immutable filter snapshot into the
 * SHARED document payload consumed by the existing Story 6.6 renderer
 * (PDFKit/ExcelJS) — no new renderer, no client SVG/HTML, no second export
 * vocabulary. All text passes through the renderer's formula-injection
 * protection; nulls are preserved, never coerced.
 */
import { shortIdToken, type ReportDocumentPayload } from './report-document-payload'
import type { ActivityReport, ActivityReportExportSnapshot } from './activity-reports.service'
import type { ActivityTypeValue } from './activity-report-metrics'

const DAY_OF_WEEK_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function activityCrmUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/reports/activity`
}

/** Human-readable effective activity scope (never raw JSON). */
export function activityFilterSummary(snapshot: ActivityReportExportSnapshot): string {
  const parts: string[] = []
  parts.push(`Dates: ${snapshot.startDate} to ${snapshot.endDate}`)
  if (snapshot.userId) parts.push('User filtered')
  if (snapshot.teamId) parts.push('Team filtered')
  if (snapshot.comparisonTeamIds.length > 0) {
    parts.push(`Compare: ${snapshot.comparisonTeamIds.length} team(s)`)
  }
  if (snapshot.activityTypes.length > 0) {
    parts.push(`Types: ${snapshot.activityTypes.join(', ')}`)
  }
  if (snapshot.contactId) parts.push('Contact filtered')
  if (snapshot.dealId) parts.push('Deal filtered')
  if (snapshot.bucket && snapshot.bucket !== 'DAY') parts.push(`Bucket: ${snapshot.bucket}`)
  if (snapshot.sortBy && snapshot.sortBy !== 'ACTIVITIES') parts.push(`Sort: ${snapshot.sortBy}`)
  return parts.join('; ')
}

/** Deterministic short filename tokens (report name + range + these). */
export function activityFilterTokens(snapshot: ActivityReportExportSnapshot): (string | null)[] {
  return [
    shortIdToken('user', snapshot.userId),
    shortIdToken('team', snapshot.teamId),
    shortIdToken('contact', snapshot.contactId),
    shortIdToken('deal', snapshot.dealId),
  ]
}

export type ActivityExportGoalRow = {
  name: string
  targetCount: number
  period: string
  progressPercent: number
  userLabel: string
}

/**
 * Defensive parse of the immutable ACTIVITY_REPORT filter snapshot persisted
 * on the export row (Contract E30). Unknown/malformed shapes throw — the
 * processor classifies that as a terminal INVALID_REQUEST, never a silent
 * re-run with a different scope.
 */
export function parseActivityExportSnapshot(raw: unknown): ActivityReportExportSnapshot {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Activity export snapshot is missing')
  }
  const record = raw as Record<string, unknown>
  const optionalString = (value: unknown): string | null =>
    typeof value === 'string' && value.length > 0 ? value : null
  const stringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  if (
    typeof record.startDate !== 'string' ||
    typeof record.endDate !== 'string' ||
    record.startDate.length === 0 ||
    record.endDate.length === 0
  ) {
    throw new Error('Activity export snapshot must carry startDate and endDate')
  }
  const bucket =
    record.bucket === 'WEEK' || record.bucket === 'MONTH' ? record.bucket : ('DAY' as const)
  const sortBy =
    record.sortBy === 'TASKS_COMPLETED' ||
    record.sortBy === 'DEALS_CLOSED' ||
    record.sortBy === 'TIME_TRACKED'
      ? record.sortBy
      : ('ACTIVITIES' as const)
  return {
    startDate: record.startDate,
    endDate: record.endDate,
    userId: optionalString(record.userId),
    teamId: optionalString(record.teamId),
    comparisonTeamIds: stringArray(record.comparisonTeamIds),
    activityTypes: stringArray(record.activityTypes) as ActivityTypeValue[],
    contactId: optionalString(record.contactId),
    dealId: optionalString(record.dealId),
    bucket,
    sortBy,
  }
}

function labelCell(
  fieldId: string,
  label: string,
  value: string,
): {
  fieldId: string
  label: string
  valueType: 'STRING'
  stringValue: string
  numberValue: null
  booleanValue: null
  dateValue: null
  isNull: boolean
} {
  return {
    fieldId,
    label,
    valueType: 'STRING',
    stringValue: value,
    numberValue: null,
    booleanValue: null,
    dateValue: null,
    isNull: false,
  }
}

function numberCell(
  fieldId: string,
  label: string,
  value: number | null,
): {
  fieldId: string
  label: string
  valueType: 'NUMBER'
  stringValue: null
  numberValue: number | null
  booleanValue: null
  dateValue: null
  isNull: boolean
} {
  return {
    fieldId,
    label,
    valueType: 'NUMBER',
    stringValue: null,
    numberValue: value,
    booleanValue: null,
    dateValue: null,
    isNull: value === null,
  }
}

type ActivityExportRow = {
  key: string
  cells: [ReturnType<typeof labelCell>, ReturnType<typeof labelCell>, ReturnType<typeof numberCell>]
}

function row(key: string, section: string, label: string, value: number | null): ActivityExportRow {
  return {
    key,
    cells: [
      labelCell('section', 'Section', section),
      labelCell('label', 'Label', label),
      numberCell('value', 'Value', value),
    ],
  }
}

/**
 * Builds the shared document payload for an ACTIVITY_REPORT export. The
 * single Data table carries the sectioned activity data (By Type, By User,
 * By Date, Heatmap, Leaderboard, Team Comparison, Goals) — the renderer is
 * the unmodified Story 6.6 one (Summary/Data/Charts sheets, chart PNG from
 * the trend series).
 */
export function buildActivityReportDocumentPayload(input: {
  result: ActivityReport
  snapshot: ActivityReportExportSnapshot
  goals: ActivityExportGoalRow[]
  crmUrl: string
  now?: Date
}): ReportDocumentPayload {
  const { result, snapshot, goals, crmUrl } = input
  const generatedAt = (input.now ?? new Date()).toISOString()

  const rows: ReturnType<typeof row>[] = []

  for (const typeRow of result.activitiesByType) {
    rows.push(row(`type:${typeRow.type}`, 'By Type', typeRow.type, typeRow.count))
  }
  for (const userRow of result.activitiesByUser) {
    const label = `${userRow.firstName} ${userRow.lastName}`.trim() || userRow.userId
    rows.push(row(`user:${userRow.userId}`, 'By User', label, userRow.count))
  }
  for (const dateRow of result.activitiesByDate) {
    rows.push(row(`date:${dateRow.date}`, 'By Date', dateRow.date, dateRow.count))
  }
  for (const cell of result.heatmap) {
    if (cell.count > 0) {
      const label = `${DAY_OF_WEEK_LABELS[cell.dayOfWeek] ?? cell.dayOfWeek} ${String(cell.hour).padStart(2, '0')}:00`
      rows.push(row(`heatmap:${cell.dayOfWeek}:${cell.hour}`, 'Heatmap', label, cell.count))
    }
  }
  for (const entry of result.leaderboard) {
    const name = `${entry.firstName} ${entry.lastName}`.trim() || entry.userId
    rows.push(
      row(
        `lb:${entry.userId}:activities`,
        'Leaderboard',
        `#${entry.rank} ${name} — Activities`,
        entry.activitiesLogged,
      ),
    )
    rows.push(
      row(
        `lb:${entry.userId}:tasks`,
        'Leaderboard',
        `#${entry.rank} ${name} — Tasks completed`,
        entry.tasksCompleted,
      ),
    )
    rows.push(
      row(
        `lb:${entry.userId}:deals`,
        'Leaderboard',
        `#${entry.rank} ${name} — Deals closed`,
        entry.dealsClosed,
      ),
    )
    rows.push(
      row(
        `lb:${entry.userId}:time`,
        'Leaderboard',
        `#${entry.rank} ${name} — Time tracked (s)`,
        entry.timeTrackedSeconds,
      ),
    )
  }
  for (const team of result.teamComparison) {
    rows.push(
      row(
        `team:${team.teamId}:activities`,
        'Team Comparison',
        `${team.teamName} — Activities`,
        team.totalActivities,
      ),
    )
    rows.push(
      row(
        `team:${team.teamId}:tasks`,
        'Team Comparison',
        `${team.teamName} — Tasks completed`,
        team.tasksCompleted,
      ),
    )
    rows.push(
      row(
        `team:${team.teamId}:overdue`,
        'Team Comparison',
        `${team.teamName} — Overdue tasks`,
        team.overdueTasks,
      ),
    )
    rows.push(
      row(
        `team:${team.teamId}:time`,
        'Team Comparison',
        `${team.teamName} — Time tracked (s)`,
        team.timeTrackedSeconds,
      ),
    )
    rows.push(
      row(
        `team:${team.teamId}:meetings`,
        'Team Comparison',
        `${team.teamName} — Meetings scheduled`,
        team.meetingsScheduled,
      ),
    )
    rows.push(
      row(
        `team:${team.teamId}:completion`,
        'Team Comparison',
        `${team.teamName} — Completion rate`,
        Math.round(team.completionRate * 1000) / 10,
      ),
    )
    rows.push(
      row(
        `team:${team.teamId}:avg`,
        'Team Comparison',
        `${team.teamName} — Avg completion (h)`,
        team.avgCompletionTimeHours,
      ),
    )
  }
  for (const goal of goals) {
    rows.push(
      row(
        `goal:${goal.name}`,
        'Goals',
        `${goal.name} (${goal.userLabel}) — progress %`,
        goal.progressPercent,
      ),
    )
  }

  return {
    reportId: '',
    reportType: 'ACTIVITY_REPORT',
    reportName: 'Activity report',
    generatedAt,
    dateRangeLabel: `${snapshot.startDate} — ${snapshot.endDate}`,
    filterSummary: activityFilterSummary(snapshot),
    dateRangeStart: snapshot.startDate,
    dateRangeEnd: snapshot.endDate,
    filterTokens: activityFilterTokens(snapshot),
    summaryMetrics: [
      {
        key: 'totalActivities',
        label: 'Total activities',
        value: result.summary.totalActivities,
        unit: 'COUNT',
      },
      {
        key: 'completionRate',
        label: 'Completion rate',
        value: Math.round(result.summary.completionRate * 1000) / 10,
        unit: 'PERCENT',
      },
      {
        key: 'tasksCompleted',
        label: 'Tasks completed',
        value: result.summary.tasksCompleted,
        unit: 'COUNT',
      },
      {
        key: 'avgCompletionTimeHours',
        label: 'Avg completion time (hours)',
        value: result.summary.avgCompletionTimeHours,
        unit: 'COUNT',
      },
      {
        key: 'overdueTasks',
        label: 'Overdue tasks',
        value: result.summary.overdueTasks,
        unit: 'COUNT',
      },
      {
        key: 'timeTrackedSeconds',
        label: 'Time tracked (seconds)',
        value: result.summary.timeTrackedSeconds,
        unit: 'COUNT',
      },
      {
        key: 'meetingsScheduled',
        label: 'Meetings scheduled',
        value: result.summary.meetingsScheduled,
        unit: 'COUNT',
      },
      {
        key: 'unattributedActivities',
        label: 'Unattributed activities',
        value: result.summary.unattributedActivities,
        unit: 'COUNT',
      },
    ],
    columns: [
      {
        fieldId: 'section',
        label: 'Section',
        valueType: 'STRING',
        role: 'DIMENSION',
        aggregation: null,
        granularity: null,
        isCalculated: false,
      },
      {
        fieldId: 'label',
        label: 'Label',
        valueType: 'STRING',
        role: 'DIMENSION',
        aggregation: null,
        granularity: null,
        isCalculated: false,
      },
      {
        fieldId: 'value',
        label: 'Value',
        valueType: 'NUMBER',
        role: 'METRIC',
        aggregation: 'SUM',
        granularity: null,
        isCalculated: false,
      },
    ],
    rows,
    totalRows: rows.length,
    warnings:
      result.summary.calculationNote.length > 0
        ? [{ code: 'CALCULATION_NOTE', message: result.summary.calculationNote }]
        : [],
    currency: null,
    mixedCurrencies: false,
    crmUrl,
    visualization: {
      type: 'AREA',
      title: 'Activity trend',
      showLegend: true,
      showDataLabels: false,
      xAxisLabel: 'Period',
      yAxisLabel: 'Activities',
      orientation: 'VERTICAL',
      colors: ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626'],
      legendPosition: 'BOTTOM',
    },
    chartSeries: [
      {
        metricId: 'activities',
        label: 'Activities',
        points: result.trend.map((point) => ({
          key: point.bucketStart,
          label: point.bucketStart.slice(0, 10),
          value: point.count,
          dimensionLabels: [point.bucketStart.slice(0, 10)],
        })),
      },
    ],
    calculatedFields: [],
    metricAliases: [],
  }
}
