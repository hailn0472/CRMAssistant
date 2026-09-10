export const SALES_QUERY_INTENTS = [
  'CONTACT_FOLLOW_UPS',
  'OVERDUE_TASKS',
  'INBOX_WORKLOAD',
  'LEAD_PIPELINE',
  'ACTIVITY_SUMMARY',
] as const

export type SalesQueryIntent = (typeof SALES_QUERY_INTENTS)[number]

export type GeneratedSalesQuery = {
  sql: string
  explanation: string
  intent: SalesQueryIntent
}

export type TextToSqlPreview = GeneratedSalesQuery & {
  model: string
  executionToken: string
  status: 'preview'
}

export type AssistantSummary = {
  answer: string
  suggestedNextSteps: string[]
}

export type TextToSqlExecution = AssistantSummary & {
  rows: Array<Record<string, unknown>>
  rowCount: number
  status: 'completed'
}
