/**
 * Pure formatting helpers for deal health (Story 3.7).
 * No React, no component imports — every derived string lives here so the
 * page-level components stay thin and the coverage gates (branches 80 /
 * functions 78 / lines 80 / statements 80) are met by pure, testable code.
 */

export type DealHealthStatus = 'HEALTHY' | 'AT_RISK' | 'STALE'
export type DealHealthSignal =
  | 'NO_ACTIVITY_7D'
  | 'NO_ACTIVITY_14D'
  | 'NO_CLOSE_DATE'
  | 'PAST_CLOSE_DATE'
  | 'CLOSING_SOON'
  | 'PROBABILITY_MISMATCH'

export const HEALTH_STATUS_LABELS: Record<DealHealthStatus, string> = {
  HEALTHY: 'Healthy',
  AT_RISK: 'At risk',
  STALE: 'Stale',
}

/** Maps a health status to an existing badge.tsx variant (success/warning/danger). */
export function healthBadgeVariant(status: DealHealthStatus): 'success' | 'warning' | 'danger' {
  if (status === 'HEALTHY') return 'success'
  if (status === 'STALE') return 'danger'
  return 'warning'
}

export const HEALTH_SIGNAL_LABELS: Record<DealHealthSignal, string> = {
  NO_ACTIVITY_7D: 'No activity in 7+ days',
  NO_ACTIVITY_14D: 'No activity in 14+ days',
  NO_CLOSE_DATE: 'No expected close date set',
  PAST_CLOSE_DATE: 'Close date is past due',
  CLOSING_SOON: 'Closing within 3 days',
  PROBABILITY_MISMATCH: "Probability doesn't match the stage",
}

/** Whole days between the ISO activity timestamp and `now` (UTC-midnight based). */
export function formatDaysSince(iso: string, now: Date): string {
  const activity = new Date(iso)
  const days = Math.floor((now.getTime() - activity.getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

export function formatSnoozedUntil(iso: string): string {
  return new Date(iso).toLocaleDateString()
}
