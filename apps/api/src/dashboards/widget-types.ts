/**
 * Pure widget-types module (Story 6.1).
 *
 * This module must stay free of @nestjs/* imports and Prisma imports so it
 * can be unit-tested in isolation. The const tuples below are the single source
 * of truth for widget vocabulary: the Pothos enums in dashboards.graphql.ts
 * mirror them.
 *
 * Every future widget type adds a member here; a Prisma enum would make each
 * one a migration, so model Widget.type is a String validated here before
 * every insert.
 *
 * Cross-reference: apps/web/src/lib/widget-format.ts duplicates
 * resolveWidgetSpan and the label maps because packages/* is empty
 * (docs/project-context.md:48-50). Keep the two files in sync.
 */

export const WIDGET_TYPES = [
  'METRIC_CARD',
  'LINE_CHART',
  'BAR_CHART',
  'PIE_CHART',
  'TABLE',
  'FUNNEL',
  'ACTIVITY_FEED',
  'TASK_LIST',
] as const
export type WidgetType = (typeof WIDGET_TYPES)[number]

export const WIDGET_SIZES = ['1x1', '2x1', '2x2', '3x2'] as const
export type WidgetSize = (typeof WIDGET_SIZES)[number]

export const MAX_WIDGETS_PER_DASHBOARD = 12
export const MAX_DASHBOARDS_PER_USER = 10
export const MAX_LIST_WIDGET_ROWS = 5
export const MAX_CHART_POINTS = 24

// ─── Widget sources ─────────────────────────────────────────────────────────

export type WidgetSource =
  | 'MY_TASKS'
  | 'TASK_STATS'
  | 'RECENT_ACTIVITY'
  | 'CONTACT_COUNT'
  | 'LEAD_FUNNEL'

export const WIDGET_SOURCES: Record<
  WidgetSource,
  {
    permission: { resource: string; action: string }
    allowedTypes: readonly WidgetType[]
    defaultTitle: string
  }
> = {
  MY_TASKS: {
    permission: { resource: 'TASK', action: 'READ' },
    allowedTypes: ['TASK_LIST'] as const,
    defaultTitle: 'My Tasks',
  },
  TASK_STATS: {
    permission: { resource: 'TASK', action: 'READ' },
    allowedTypes: ['METRIC_CARD'] as const,
    defaultTitle: 'Task Stats',
  },
  RECENT_ACTIVITY: {
    permission: { resource: 'TASK', action: 'READ' },
    allowedTypes: ['ACTIVITY_FEED'] as const,
    defaultTitle: 'Recent Activity',
  },
  CONTACT_COUNT: {
    permission: { resource: 'CONTACT', action: 'READ' },
    allowedTypes: ['METRIC_CARD'] as const,
    defaultTitle: 'Contact Count',
  },
  LEAD_FUNNEL: {
    permission: { resource: 'CONTACT', action: 'READ' },
    allowedTypes: ['BAR_CHART', 'PIE_CHART', 'FUNNEL'] as const,
    defaultTitle: 'Lead Funnel',
  },
}

// ─── Type guards ─────────────────────────────────────────────────────────────

export function isWidgetType(value: string): value is WidgetType {
  return (WIDGET_TYPES as readonly string[]).includes(value)
}

export function isWidgetSize(value: string): value is WidgetSize {
  return (WIDGET_SIZES as readonly string[]).includes(value)
}

export function isWidgetSource(value: string): value is WidgetSource {
  return Object.keys(WIDGET_SOURCES).includes(value)
}

export function assertValidWidgetType(value: string): void {
  if (!isWidgetType(value)) {
    throw new Error(`Invalid widget type: ${value}. Expected one of: ${WIDGET_TYPES.join(', ')}`)
  }
}

export function assertValidWidgetSize(value: string): void {
  if (!isWidgetSize(value)) {
    throw new Error(`Invalid widget size: ${value}. Expected one of: ${WIDGET_SIZES.join(', ')}`)
  }
}

export function assertValidWidgetSource(value: string): void {
  if (!isWidgetSource(value)) {
    throw new Error(
      `Invalid widget source: ${value}. Expected one of: ${Object.keys(WIDGET_SOURCES).join(', ')}`,
    )
  }
}

// ─── Validation ──────────────────────────────────────────────────────────────

export function assertTypeMatchesSource(type: WidgetType, source: WidgetSource): void {
  const allowed = WIDGET_SOURCES[source].allowedTypes
  if (!(allowed as readonly string[]).includes(type)) {
    throw new Error(`Widget type ${type} cannot render source ${source}`)
  }
}

export const MAX_WIDGET_TITLE_LENGTH = 80

export function normalizeWidgetTitle(title: string): string {
  const trimmed = title.trim().replace(/\s+/g, ' ')
  if (!trimmed) {
    throw new Error('Widget title must not be empty')
  }
  if (trimmed.length > MAX_WIDGET_TITLE_LENGTH) {
    throw new Error(`Widget title must not exceed ${MAX_WIDGET_TITLE_LENGTH} characters`)
  }
  return trimmed
}

// ─── Layout ──────────────────────────────────────────────────────────────────

export function resolveWidgetSpan(
  size: WidgetSize,
  columns: number,
): { colSpan: number; rowSpan: number } {
  const map: Record<WidgetSize, { colSpan: number; rowSpan: number }> = {
    '1x1': { colSpan: 1, rowSpan: 1 },
    '2x1': { colSpan: 2, rowSpan: 1 },
    '2x2': { colSpan: 2, rowSpan: 2 },
    '3x2': { colSpan: 3, rowSpan: 2 },
  }
  const { colSpan, rowSpan } = map[size]
  return { colSpan: Math.min(colSpan, columns), rowSpan }
}
