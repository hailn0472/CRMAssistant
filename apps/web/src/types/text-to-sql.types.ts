export type SalesQueryIntent =
  | 'CONTACT_FOLLOW_UPS'
  | 'OVERDUE_TASKS'
  | 'INBOX_WORKLOAD'
  | 'LEAD_PIPELINE'
  | 'ACTIVITY_SUMMARY'

export type TextToSqlPreview = {
  sql: string
  explanation: string
  intent: SalesQueryIntent
  model: string
  executionToken: string
  status: 'preview'
}

export type TextToSqlExecution = {
  answer: string
  suggestedNextSteps: string[]
  rows: Array<Record<string, unknown>>
  rowCount: number
  status: 'completed'
}
