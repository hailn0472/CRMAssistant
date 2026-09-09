/**
 * Pure widget-format module (Story 6.1).
 *
 * Framework-free, React-free. Duplicates resolveWidgetSpan and label maps from
 * apps/api/src/dashboards/widget-types.ts because packages/* is empty
 * (docs/project-context.md:48-50). Keep the two files in sync.
 *
 * Cross-reference: apps/api/src/dashboards/widget-types.ts
 */
import { TIME_CHART_COLORS } from '@/lib/time-format'

export const WIDGET_TYPES: Record<string, string> = {
  METRIC_CARD: 'Metric Card',
  LINE_CHART: 'Line Chart',
  BAR_CHART: 'Bar Chart',
  PIE_CHART: 'Pie Chart',
  TABLE: 'Table',
  FUNNEL: 'Funnel',
  ACTIVITY_FEED: 'Activity Feed',
  TASK_LIST: 'Task List',
}

export const WIDGET_SIZES: Record<string, string> = {
  '1x1': 'Small (1×1)',
  '2x1': 'Wide (2×1)',
  '2x2': 'Medium (2×2)',
  '3x2': 'Large (3×2)',
}

export const WIDGET_SOURCES: Record<string, string> = {
  MY_TASKS: 'My Tasks',
  TASK_STATS: 'Task Stats',
  RECENT_ACTIVITY: 'Recent Activity',
  CONTACT_COUNT: 'Contact Count',
  LEAD_FUNNEL: 'Lead Funnel',
}

// Mirrors apps/api/src/dashboards/widget-types.ts WIDGET_SOURCES permission map
// (AC 13). The library dialog hides sources the caller lacks permission for.
export const WIDGET_SOURCE_PERMISSIONS: Record<string, { resource: string; action: string }> = {
  MY_TASKS: { resource: 'TASK', action: 'READ' },
  TASK_STATS: { resource: 'TASK', action: 'READ' },
  RECENT_ACTIVITY: { resource: 'TASK', action: 'READ' },
  CONTACT_COUNT: { resource: 'CONTACT', action: 'READ' },
  LEAD_FUNNEL: { resource: 'CONTACT', action: 'READ' },
}

// Short human description per source (AC 79 — the picker shows a static
// illustrative preview + description, never live data).
export const WIDGET_SOURCE_DESCRIPTIONS: Record<string, string> = {
  MY_TASKS: 'Your open tasks ordered by due date.',
  TASK_STATS: 'Open, due-today and overdue task counts.',
  RECENT_ACTIVITY: 'Latest activity across your records.',
  CONTACT_COUNT: 'Total contacts in your workspace.',
  LEAD_FUNNEL: 'Contacts grouped by qualification status.',
}

// Reuse TIME_CHART_COLORS from @/lib/time-format rather than inventing a second
// palette (AC 61). Violet is reserved for AI surfaces and must never appear
// here (ux-design-specification-basic-revision.md:127-135).
export const WIDGET_SERIES_COLORS: readonly string[] = [...TIME_CHART_COLORS]

// Literal span class map (AC 66). Tailwind v3.4 JIT scans source for literal
// class strings — a template-literal interpolation produces nothing it can see,
// so every span class must appear verbatim here. `col-span-2`, `col-span-3`
// and `row-span-2` below are the literals the grid relies on.
const SPAN_CLASS: Record<string, { colSpan: number; rowSpan: number; className: string }> = {
  '1x1': { colSpan: 1, rowSpan: 1, className: 'col-span-1 row-span-1' },
  '2x1': { colSpan: 2, rowSpan: 1, className: 'col-span-2 row-span-1' },
  '2x2': { colSpan: 2, rowSpan: 2, className: 'col-span-2 row-span-2' },
  '3x2': { colSpan: 3, rowSpan: 2, className: 'col-span-3 row-span-2' },
}

export function resolveWidgetSpan(
  size: string,
  columns: number,
): { colSpan: number; rowSpan: number; className: string } {
  const entry = SPAN_CLASS[size] ?? SPAN_CLASS['1x1']
  const clamped = Math.min(entry.colSpan, columns)
  // The clamp always lands on a known size key (colSpan ∈ 1..3, rowSpan ∈ 1..2),
  // so the className is always a literal from SPAN_CLASS — never interpolated.
  const resolved = SPAN_CLASS[`${clamped}x${entry.rowSpan}`] ?? SPAN_CLASS['1x1']
  return { colSpan: resolved.colSpan, rowSpan: resolved.rowSpan, className: resolved.className }
}

export function formatWidgetMetric(
  metric: { value: number; label: string; unit: string | null },
  currency: string,
): string {
  if (metric.unit === '%') {
    return `${metric.value}%`
  }
  if (metric.unit === 'hrs') {
    return `${metric.label}: ${metric.value} hrs`
  }
  if (metric.unit === 'USD') {
    const symbol = currency === 'EUR' ? '€' : '$'
    return `${metric.label}: ${symbol}${metric.value}`
  }
  return `${metric.label}: ${metric.value}`
}

export function trendLabel(
  direction: 'UP' | 'DOWN' | 'FLAT' | null,
  percent: number | null,
): string {
  if (percent === null || direction === null) return ''
  if (direction === 'UP') return `${percent}% increase`
  if (direction === 'DOWN') return `${percent}% decrease`
  return 'No change'
}

export function resolveWidgetReorder(
  widgetIds: string[],
  activeId: string,
  overId: string,
): string[] {
  const oldIndex = widgetIds.indexOf(activeId)
  const newIndex = widgetIds.indexOf(overId)
  if (oldIndex === -1 || newIndex === -1) return widgetIds
  if (oldIndex === newIndex) return widgetIds
  const result = [...widgetIds]
  result.splice(oldIndex, 1)
  result.splice(newIndex, 0, activeId)
  return result
}
