/**
 * Pure widget-config module (Story 6.1).
 *
 * Framework-free, Nest-free, Prisma-free. Parses and validates the JSON stored
 * in Widget.config. Read-path: parseWidgetConfig never throws — returns
 * defaults for malformed or unknown-key config so one corrupt row doesn't blank
 * the whole dashboard. Write-path: validateWidgetConfig DOES throw.
 */

import type { WidgetSource } from './widget-types'
import { isWidgetSource } from './widget-types'
import { MAX_LIST_WIDGET_ROWS } from './widget-types'

export interface WidgetConfig {
  source: WidgetSource
  dateRangeDays: number
  stageId: string | null
  ownerId: string | null
  limit: number
}

export const DEFAULT_WIDGET_CONFIG: WidgetConfig = {
  source: 'TASK_STATS',
  dateRangeDays: 30,
  stageId: null,
  ownerId: null,
  limit: MAX_LIST_WIDGET_ROWS,
}

export function parseWidgetConfig(raw: unknown): WidgetConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ...DEFAULT_WIDGET_CONFIG }
  }

  const obj = raw as Record<string, unknown>

  const source =
    typeof obj.source === 'string' && isWidgetSource(obj.source)
      ? (obj.source as WidgetSource)
      : DEFAULT_WIDGET_CONFIG.source

  const dateRangeDays =
    typeof obj.dateRangeDays === 'number' &&
    Number.isFinite(obj.dateRangeDays) &&
    obj.dateRangeDays > 0 &&
    obj.dateRangeDays <= 365
      ? obj.dateRangeDays
      : DEFAULT_WIDGET_CONFIG.dateRangeDays

  const stageId = typeof obj.stageId === 'string' && obj.stageId.length > 0 ? obj.stageId : null

  const ownerId = typeof obj.ownerId === 'string' && obj.ownerId.length > 0 ? obj.ownerId : null

  const limit =
    typeof obj.limit === 'number' &&
    Number.isFinite(obj.limit) &&
    obj.limit > 0 &&
    obj.limit <= MAX_LIST_WIDGET_ROWS
      ? obj.limit
      : DEFAULT_WIDGET_CONFIG.limit

  return { source, dateRangeDays, stageId, ownerId, limit }
}

export function validateWidgetConfig(raw: unknown): WidgetConfig {
  // Write-path validation is strict (AC 34): a non-object config (null, array,
  // or primitive) is a client bug and must throw, not silently fall back to the
  // default source. That lenient fallback is the read path's (parseWidgetConfig)
  // job — one corrupt row must not blank a dashboard, but a bad write must fail.
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('widget config must be an object')
  }

  const obj = raw as Record<string, unknown>

  if (typeof obj.source !== 'string' || !isWidgetSource(obj.source)) {
    throw new Error('widget config source is required and must be a valid WidgetSource')
  }
  if (obj.dateRangeDays !== undefined) {
    if (
      typeof obj.dateRangeDays !== 'number' ||
      !Number.isFinite(obj.dateRangeDays) ||
      obj.dateRangeDays < 1 ||
      obj.dateRangeDays > 365
    ) {
      throw new Error('widget config dateRangeDays must be a number between 1 and 365')
    }
  }
  if (obj.limit !== undefined) {
    if (
      typeof obj.limit !== 'number' ||
      !Number.isFinite(obj.limit) ||
      obj.limit < 1 ||
      obj.limit > MAX_LIST_WIDGET_ROWS
    ) {
      throw new Error(`widget config limit must be a number between 1 and ${MAX_LIST_WIDGET_ROWS}`)
    }
  }

  return parseWidgetConfig(obj)
}
