/**
 * Pure notification formatting utilities (Story 4.8, AC 66).
 *
 * All helpers are free of React and browser imports so they can be
 * unit-tested in isolation.
 */

import type { Notification } from '@/services/notification.service'

const DEAL_MAP = ['DEAL_REMINDER', 'DEAL_MENTION'] as const

/**
 * Resolve the href for a notification's target. Returns null when there is
 * no navigable target (neither non-null).
 */
export function notificationHref(n: Notification): string | null {
  if (n.dealId) return `/deals/${n.dealId}`
  if (n.taskId) return `/tasks/${n.taskId}`
  if (n.reportExportId) {
    if (n.type === 'REPORT_EXPORT_READY') {
      return `/reports/exports?download=${n.reportExportId}`
    }
    return `/reports/exports?exportId=${n.reportExportId}`
  }
  return null
}

/** Human-readable label for a notification type. */
export function notificationTypeLabel(type: string): string {
  switch (type) {
    case 'TASK_ASSIGNED':
      return 'Task assigned'
    case 'DEAL_REMINDER':
      return 'Deal reminder'
    case 'DEAL_MENTION':
      return 'Mention'
    case 'REPORT_EXPORT_READY':
      return 'Report export ready'
    case 'REPORT_EXPORT_FAILED':
      return 'Report export failed'
    default:
      return type
  }
}

/** Icon name from lucide-react matching each notification category. */
export function notificationTypeIconName(type: string): string {
  if (DEAL_MAP.includes(type as (typeof DEAL_MAP)[number])) return 'DollarSign'
  if (type === 'TASK_ASSIGNED') return 'CheckSquare'
  if (type === 'REPORT_EXPORT_READY' || type === 'REPORT_EXPORT_FAILED') return 'Download'
  return 'Bell'
}

/**
 * Relative-time formatter — copied verbatim from
 * `apps/web/src/components/notes/NotesPanel.tsx:300-313`.
 * The duplication is intentional and ledgered (deferred-work.md, Story 4.8).
 * Keep the two copies in sync — docs/project-context.md § "Consequence of the
 * empty packages".
 *
 * Twin: apps/web/src/components/notes/NotesPanel.tsx formatRelativeTime.
 */
export function formatRelativeTime(iso: string): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  if (isNaN(then)) return ''

  const diffMs = now - then
  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return 'Just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`

  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}
