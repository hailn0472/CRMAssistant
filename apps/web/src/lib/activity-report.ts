/**
 * Story 6.8 — Pure activity report helper functions and transformations.
 */
import type { ActivityHeatmapCell } from '@/services/activity-report.service'

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
export const DAY_NAMES_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'] as const

/**
 * Formats completion rate (0..1) as percentage with 1 decimal place.
 */
export function formatCompletionRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

/**
 * Formats duration in hours with 1 decimal place.
 */
export function formatDurationHours(hours: number): string {
  return `${hours.toFixed(1)}h`
}

/**
 * Formats duration in seconds to human readable form (e.g., "1h 15m", "45s").
 */
export function formatDurationSeconds(seconds: number): string {
  if (seconds === 0) return '0s'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60

  const parts: string[] = []
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  if (s > 0 && h === 0 && m === 0) parts.push(`${s}s`)

  return parts.join(' ') || '0s'
}

/**
 * Validates date range for Activity Report.
 */
export function validateActivityReportFilterRange(params: {
  startDate?: string | null
  endDate?: string | null
}): string | null {
  if (!params.startDate || !params.endDate) {
    return 'Start date and end date are required.'
  }

  const start = new Date(params.startDate)
  const end = new Date(params.endDate)

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return 'Invalid date format.'
  }

  if (end < start) {
    return 'End date must be greater than or equal to start date.'
  }

  const diffMs = end.getTime() - start.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays > 366) {
    return 'Date range cannot exceed 366 days.'
  }

  return null
}

/**
 * Matrix of 7 days (0..6) x 24 hours (0..23).
 */
export function buildHeatmapMatrix(cells: ActivityHeatmapCell[]): ActivityHeatmapCell[][] {
  const matrix: ActivityHeatmapCell[][] = Array.from({ length: 7 }, (_, day) =>
    Array.from({ length: 24 }, (_, hour) => ({
      dayOfWeek: day,
      hour,
      count: 0,
    })),
  )

  for (const cell of cells) {
    if (cell.dayOfWeek >= 0 && cell.dayOfWeek < 7 && cell.hour >= 0 && cell.hour < 24) {
      matrix[cell.dayOfWeek][cell.hour] = cell
    }
  }

  return matrix
}

/**
 * Builds a NormalizedLineChart from ActivityTrendPoint[] to be rendered via ReportChart.
 */
export function buildActivityTrendChartData(
  trend: { bucketStart: string; count: number }[],
): import('@/lib/report-chart').NormalizedLineChart {
  const points = trend.map((t) => ({
    key: t.bucketStart,
    label: t.bucketStart,
    dimensionLabels: [t.bucketStart],
    values: {
      activities: t.count,
    },
  }))

  const rows = trend.map((t) => [t.bucketStart, String(t.count)])

  return {
    type: 'LINE',
    title: 'Activity Trend',
    showLegend: true,
    showDataLabels: false,
    colors: ['INDIGO'],
    legendPosition: 'TOP',
    xAxisLabel: 'Period',
    yAxisLabel: 'Activities',
    totalPoints: trend.length,
    series: [
      {
        metricId: 'activities',
        label: 'Activities',
      },
    ],
    points,
    srTable: {
      headers: ['Period', 'Activities'],
      rows,
    },
  }
}

/**
 * Heatmap cell color based on intensity.
 */
export function getHeatmapCellColor(count: number, maxCount: number): string {
  if (count === 0 || maxCount <= 0) {
    return 'bg-slate-100 text-slate-400'
  }

  const ratio = count / maxCount

  if (ratio <= 0.25) {
    return 'bg-emerald-100 text-emerald-800'
  }
  if (ratio <= 0.5) {
    return 'bg-emerald-300 text-emerald-900'
  }
  if (ratio <= 0.75) {
    return 'bg-emerald-500 text-white'
  }
  return 'bg-emerald-700 text-white'
}
