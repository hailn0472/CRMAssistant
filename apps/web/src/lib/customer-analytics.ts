/**
 * Story 6.7 — Customer Analytics formatting and chart normalization helpers.
 */
import type {
  ChurnRiskDistributionBin,
  CustomerAnalyticsCohort,
  CustomerAnalyticsTrendPoint,
  CustomerChurnRisk,
  LtvDistributionBin,
} from '@/services/customer-analytics.service'
import type {
  NormalizedBarChart,
  NormalizedLineChart,
  NormalizedPieChart,
} from '@/lib/report-chart'

/**
 * Formats a monetary value. When mixedCurrencies is true, returns a neutral
 * formatted number without any currency symbol.
 */
export function formatCustomerLtv(
  value: number | null | undefined,
  mixedCurrencies = false,
  currency?: string | null,
): string {
  if (value === null || value === undefined) {
    return '—'
  }

  if (mixedCurrencies || !currency) {
    return new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 0,
    }).format(value)
  }

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
  }
}

/**
 * Formats risk score to 1 decimal place or em dash.
 */
export function formatRiskScore(score: number | null | undefined): string {
  if (score === null || score === undefined) {
    return '—'
  }
  return (Math.round((score + Number.EPSILON) * 10) / 10).toFixed(1)
}

/**
 * Returns badge text and styling classes for Churn Risk.
 */
export function getChurnRiskBadgeDetails(
  risk: CustomerChurnRisk | 'NOT_CALCULATED' | string | null | undefined,
): {
  label: string
  colorClass: string
  dotColorClass: string
} {
  switch (risk) {
    case 'LOW':
      return {
        label: 'Low',
        colorClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        dotColorClass: 'bg-emerald-500',
      }
    case 'MEDIUM':
      return {
        label: 'Medium',
        colorClass: 'bg-amber-50 text-amber-700 border-amber-200',
        dotColorClass: 'bg-amber-500',
      }
    case 'HIGH':
      return {
        label: 'High',
        colorClass: 'bg-rose-50 text-rose-700 border-rose-200',
        dotColorClass: 'bg-rose-500',
      }
    default:
      return {
        label: 'Not calculated',
        colorClass: 'bg-slate-100 text-slate-600 border-slate-200',
        dotColorClass: 'bg-slate-400',
      }
  }
}

export interface AnalyticsFilterRangeInput {
  minLtv?: number | null
  maxLtv?: number | null
  fromDate?: string | null
  toDate?: string | null
}

/**
 * Validates range filter inputs inline.
 */
export function validateAnalyticsFilterRange(input: AnalyticsFilterRangeInput): string | null {
  if (input.minLtv !== null && input.minLtv !== undefined) {
    if (!Number.isFinite(input.minLtv)) {
      return 'LTV must be a finite number.'
    }
  }

  if (input.maxLtv !== null && input.maxLtv !== undefined) {
    if (!Number.isFinite(input.maxLtv)) {
      return 'LTV must be a finite number.'
    }
  }

  if (
    input.minLtv !== null &&
    input.minLtv !== undefined &&
    input.maxLtv !== null &&
    input.maxLtv !== undefined
  ) {
    if (Number(input.minLtv) > Number(input.maxLtv)) {
      return 'Min LTV cannot be greater than Max LTV.'
    }
  }

  if (input.fromDate && input.toDate) {
    if (new Date(input.fromDate) > new Date(input.toDate)) {
      return 'From date cannot be after To date.'
    }
  }

  return null
}

// ─── Chart Adapters for ReportChart ──────────────────────────────────────

export function buildLtvDistributionChartData(bins: LtvDistributionBin[]): NormalizedBarChart {
  const points = bins.map((b) => ({
    key: b.label,
    label: b.label,
    dimensionLabels: [b.label],
    values: { count: b.count },
  }))

  const rows = bins.map((b) => [b.label, String(b.count)])

  return {
    type: 'BAR',
    orientation: 'VERTICAL',
    title: 'LTV Distribution',
    showLegend: false,
    showDataLabels: true,
    colors: ['INDIGO', 'VIOLET', 'BLUE', 'CYAN', 'PINK'],
    legendPosition: 'BOTTOM',
    xAxisLabel: 'LTV Range',
    yAxisLabel: 'Customers',
    totalPoints: bins.length,
    series: [{ metricId: 'count', label: 'Customers' }],
    points,
    srTable: {
      headers: ['LTV Range', 'Customers'],
      rows,
    },
  }
}

export function buildChurnDistributionChartData(
  bins: ChurnRiskDistributionBin[],
): NormalizedPieChart {
  const total = bins.reduce((sum, b) => sum + b.count, 0)
  const slices = bins.map((b) => ({
    key: b.risk,
    label: b.risk,
    value: b.count,
    percentage: b.percentage,
    dimensionLabels: [b.risk],
    metricId: 'riskCount',
  }))

  const rows = bins.map((b) => [b.risk, String(b.count), `${b.percentage.toFixed(1)}%`])

  return {
    type: 'PIE',
    isDonut: true,
    title: 'Churn Risk Distribution',
    showLegend: true,
    showDataLabels: true,
    colors: ['GREEN', 'AMBER', 'RED', 'BLUE'],
    legendPosition: 'BOTTOM',
    metricId: 'riskCount',
    metricLabel: 'Customers',
    total,
    slices,
    totalPoints: slices.length,
    srTable: {
      headers: ['Risk Level', 'Customers', 'Percentage'],
      rows,
    },
  }
}

export function buildLtvTrendChartData(
  points: CustomerAnalyticsTrendPoint[],
  mixedCurrencies = false,
  currency?: string | null,
): NormalizedLineChart {
  const linePoints = points.map((p) => ({
    key: p.snapshotDate,
    label: p.snapshotDate,
    dimensionLabels: [p.snapshotDate],
    values: {
      totalLtv: p.totalLtv,
      averageLtv: p.averageLtv,
    },
  }))

  const rows = points.map((p) => [
    p.snapshotDate,
    formatCustomerLtv(p.totalLtv, mixedCurrencies, currency),
    formatCustomerLtv(p.averageLtv, mixedCurrencies, currency),
    String(p.customerCount),
  ])

  return {
    type: 'LINE',
    title: 'Historical LTV Trend',
    showLegend: true,
    showDataLabels: false,
    colors: ['INDIGO', 'GREEN'],
    legendPosition: 'TOP',
    xAxisLabel: 'Date',
    yAxisLabel: 'LTV',
    totalPoints: points.length,
    series: [
      { metricId: 'totalLtv', label: 'Total LTV' },
      { metricId: 'averageLtv', label: 'Average LTV' },
    ],
    points: linePoints,
    srTable: {
      headers: ['Snapshot Date', 'Total LTV', 'Average LTV', 'Customer Count'],
      rows,
    },
  }
}

export function buildCohortChartData(
  cohorts: CustomerAnalyticsCohort[],
  mixedCurrencies = false,
  currency?: string | null,
): NormalizedBarChart {
  const points = cohorts.map((c) => ({
    key: c.cohort,
    label: c.cohort,
    dimensionLabels: [c.cohort],
    values: {
      totalLtv: c.totalLtv,
      averageLtv: c.averageLtv,
    },
  }))

  const rows = cohorts.map((c) => [
    c.cohort,
    String(c.customerCount),
    formatCustomerLtv(c.totalLtv, mixedCurrencies, currency),
    formatCustomerLtv(c.averageLtv, mixedCurrencies, currency),
  ])

  return {
    type: 'BAR',
    orientation: 'VERTICAL',
    title: 'Acquisition Cohort Analysis',
    showLegend: true,
    showDataLabels: false,
    colors: ['INDIGO', 'GREEN'],
    legendPosition: 'TOP',
    xAxisLabel: 'Cohort (YYYY-MM)',
    yAxisLabel: 'LTV',
    totalPoints: cohorts.length,
    series: [
      { metricId: 'totalLtv', label: 'Total LTV' },
      { metricId: 'averageLtv', label: 'Average LTV' },
    ],
    points,
    srTable: {
      headers: ['Acquisition Cohort', 'Customer Count', 'Total LTV', 'Average LTV'],
      rows,
    },
  }
}
