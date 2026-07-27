export type ActivityTypeValue =
  | 'EMAIL_SENT'
  | 'CALL_MADE'
  | 'MEETING_SCHEDULED'
  | 'NOTE_ADDED'
  | 'DEAL_CREATED'
  | 'CONTACT_CREATED'
  | 'CONTACT_UPDATED'

export type Activity = {
  id: string
  contactId: string
  type: ActivityTypeValue
  title: string
  description: string | null
  createdAt: string
  createdBy: string
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
]

export const SYSTEM_TYPES: ActivityTypeValue[] = [
  'CONTACT_CREATED',
  'CONTACT_UPDATED',
  'DEAL_CREATED',
]

export const ACTIVITY_TYPE_LABELS: Record<ActivityTypeValue, string> = {
  EMAIL_SENT: 'Email Sent',
  CALL_MADE: 'Call Made',
  MEETING_SCHEDULED: 'Meeting Scheduled',
  NOTE_ADDED: 'Note Added',
  DEAL_CREATED: 'Deal Created',
  CONTACT_CREATED: 'Contact Created',
  CONTACT_UPDATED: 'Contact Updated',
}
