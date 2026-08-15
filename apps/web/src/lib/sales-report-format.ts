/**
 * Story 6.2 — pure formatting helpers for the sales-report workspace.
 * No React imports — unit-testable in isolation.
 */
import type { ReportMetric, ReportType, ReportConfig } from '@/services/sales-report.service'

export function formatMoney(value: number | null, currency: string | null): string {
  if (value === null) return '—'
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency ?? 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${currency ?? 'USD'} ${value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  }
}

export function formatPercent(value: number | null): string {
  if (value === null) return '—'
  return `${value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

export function formatCount(value: number | null): string {
  if (value === null) return '—'
  return value.toLocaleString('en-US')
}

export function formatDays(value: number | null): string {
  if (value === null) return '—'
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })} days`
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return iso.slice(0, 10)
}

export type ChangePresentation = {
  /** Human text: "Up 12.3%", "Down 4.0%", "No change", "New", "—" (AC 71). */
  label: string
  /** Always paired with the text — never color alone (AC 71/80). */
  icon: 'up' | 'down' | 'flat' | 'new' | 'none'
}

/** Trend text + icon for a metric or bucket (AC 25, AC 71). */
export function changePresentation(metric: ReportMetric): ChangePresentation {
  if (metric.displayToken === 'NEW') {
    return { label: 'New', icon: 'new' }
  }
  if (metric.direction === 'UP') {
    return { label: `Up ${formatPercent(metric.percentageChange)}`, icon: 'up' }
  }
  if (metric.direction === 'DOWN') {
    return { label: `Down ${formatPercent(metric.percentageChange)}`, icon: 'down' }
  }
  if (metric.direction === 'FLAT') {
    return { label: 'No change', icon: 'flat' }
  }
  return { label: '—', icon: 'none' }
}

export function metricUnitSuffix(unit: ReportMetric['unit']): string {
  switch (unit) {
    case 'CURRENCY':
      return ''
    case 'PERCENT':
      return '%'
    case 'DAYS':
      return ' days'
    default:
      return ''
  }
}

/** Chart series derived from the current period buckets (value ?? count fallback). */
export function chartSeries(
  buckets: Array<{ key: string; label: string; value: number | null; count: number }>,
  currency: string | null,
): Array<{ key: string; label: string; value: number; count: number; formatted: string }> {
  return buckets.map((b) => ({
    key: b.key,
    label: b.label,
    value: b.value ?? b.count,
    count: b.count,
    formatted: b.value !== null ? formatMoney(b.value, currency) : formatCount(b.count),
  }))
}

// ─── Default templates for the six report types (AC 66) ─────────────

export const REPORT_TYPE_TEMPLATES: Array<{
  type: ReportType
  label: string
  description: string
  config: ReportConfig
}> = [
  {
    type: 'SALES_OVERVIEW',
    label: 'Sales overview',
    description: 'Revenue, win rate and stage share',
    config: {
      datePreset: 'THIS_MONTH',
      startDate: null,
      endDate: null,
      comparisonMode: 'PREVIOUS_PERIOD',
      comparisonStartDate: null,
      comparisonEndDate: null,
      groupBy: 'MONTH',
      ownerId: null,
      teamId: null,
      stageId: null,
      productId: null,
      currency: null,
    },
  },
  {
    type: 'PIPELINE_ANALYSIS',
    label: 'Pipeline analysis',
    description: 'Open deals by expected close',
    config: {
      datePreset: 'THIS_QUARTER',
      startDate: null,
      endDate: null,
      comparisonMode: 'PREVIOUS_PERIOD',
      comparisonStartDate: null,
      comparisonEndDate: null,
      groupBy: 'MONTH',
      ownerId: null,
      teamId: null,
      stageId: null,
      productId: null,
      currency: null,
    },
  },
  {
    type: 'WIN_LOSS',
    label: 'Win / loss',
    description: 'Closed deals, reasons and competitors',
    config: {
      datePreset: 'THIS_MONTH',
      startDate: null,
      endDate: null,
      comparisonMode: 'PREVIOUS_PERIOD',
      comparisonStartDate: null,
      comparisonEndDate: null,
      groupBy: 'MONTH',
      ownerId: null,
      teamId: null,
      stageId: null,
      productId: null,
      currency: null,
    },
  },
  {
    type: 'REVENUE_FORECAST',
    label: 'Revenue forecast',
    description: 'Commit, best case and pipeline bands',
    config: {
      datePreset: 'THIS_QUARTER',
      startDate: null,
      endDate: null,
      comparisonMode: 'PREVIOUS_PERIOD',
      comparisonStartDate: null,
      comparisonEndDate: null,
      groupBy: 'MONTH',
      ownerId: null,
      teamId: null,
      stageId: null,
      productId: null,
      currency: null,
    },
  },
  {
    type: 'TEAM_PERFORMANCE',
    label: 'Team performance',
    description: 'Won revenue by owner or team',
    config: {
      datePreset: 'THIS_MONTH',
      startDate: null,
      endDate: null,
      comparisonMode: 'PREVIOUS_PERIOD',
      comparisonStartDate: null,
      comparisonEndDate: null,
      groupBy: 'OWNER',
      ownerId: null,
      teamId: null,
      stageId: null,
      productId: null,
      currency: null,
    },
  },
  {
    type: 'DEAL_VELOCITY',
    label: 'Deal velocity',
    description: 'Average and median cycle time',
    config: {
      datePreset: 'THIS_MONTH',
      startDate: null,
      endDate: null,
      comparisonMode: 'PREVIOUS_PERIOD',
      comparisonStartDate: null,
      comparisonEndDate: null,
      groupBy: 'MONTH',
      ownerId: null,
      teamId: null,
      stageId: null,
      productId: null,
      currency: null,
    },
  },
]

export function defaultTemplateFor(type: ReportType): ReportConfig {
  const template = REPORT_TYPE_TEMPLATES.find((t) => t.type === type)
  return template ? { ...template.config } : REPORT_TYPE_TEMPLATES[0].config
}
