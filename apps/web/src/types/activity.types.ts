export type ActivityTypeValue =
  | 'EMAIL_SENT'
  | 'CALL_MADE'
  | 'MEETING_SCHEDULED'
  | 'NOTE_ADDED'
  | 'CONTACT_CREATED'
  | 'CONTACT_UPDATED'
  | 'CONTACT_OWNER_CHANGED'
  // Story 4.2 auto-logged types
  | 'TASK_COMPLETED'
  | 'MESSAGE_RECEIVED'
  | 'MESSAGE_SENT'

export type Activity = {
  id: string
  contactId: string
  type: ActivityTypeValue
  title: string
  description: string | null
  createdAt: string
  createdBy: string
  // TASK or MESSAGE when auto-logged, null for manual notes.
  source: string | null
}

export type ActivityEdge = {
  cursor: string
  node: Activity
}

export type ActivityPageInfo = {
  hasNextPage: boolean
  endCursor: string | null
}

export type ContactTimelineResult = {
  edges: ActivityEdge[]
  pageInfo: ActivityPageInfo
  totalCount: number
}

export type ActivityFilterType = 'ALL' | 'SALES' | 'SYSTEM'

export const SALES_TYPES: ActivityTypeValue[] = [
  'EMAIL_SENT',
  'CALL_MADE',
  'MEETING_SCHEDULED',
  'NOTE_ADDED',
  'TASK_COMPLETED',
  'MESSAGE_RECEIVED',
  'MESSAGE_SENT',
]

export const SYSTEM_TYPES: ActivityTypeValue[] = [
  'CONTACT_CREATED',
  'CONTACT_UPDATED',
  'CONTACT_OWNER_CHANGED',
]

export const ACTIVITY_TYPE_LABELS: Record<ActivityTypeValue, string> = {
  EMAIL_SENT: 'Email Sent',
  CALL_MADE: 'Call Made',
  MEETING_SCHEDULED: 'Meeting Scheduled',
  NOTE_ADDED: 'Note Added',
  CONTACT_CREATED: 'Contact Created',
  CONTACT_UPDATED: 'Contact Updated',
  CONTACT_OWNER_CHANGED: 'Owner Changed',
  TASK_COMPLETED: 'Task Completed',
  MESSAGE_RECEIVED: 'Message Received',
  MESSAGE_SENT: 'Message Sent',
}

// ─── Story 4.4: tenant-wide feed vocabulary (AC 7, 10, 36) ────────────────

export type ActivityFeedContact = {
  id: string
  firstName: string
  lastName: string
}

/** A feed row — `Activity` plus the widened select (`sourceId` + contact identity, AC 10). */
export type ActivityFeedItem = Activity & {
  sourceId: string | null
  contact: ActivityFeedContact | null
}

/** Mirrors `ActivityFeedFilterInput` server-side (AC 7). Unknown/empty values are ignored by the API. */
export type ActivityFeedFilter = {
  type?: ActivityTypeValue
  source?: string
  contactId?: string
  createdBy?: string
  createdFrom?: string
  createdTo?: string
  search?: string
}

/** The house connection shape, page 1 / size 20 default, clamped at 100. */
export type ActivityFeedPage = {
  items: ActivityFeedItem[]
  total: number
  page: number
  pageSize: number
}

/** The workspace metric strip (AC 11) — activity counters + task counters composed server-side. */
export type ActivityFeedStats = {
  todayCount: number
  weekCount: number
  tasksDueToday: number
  overdueTasks: number
}
