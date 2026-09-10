import type { TextToSqlExecution, TextToSqlPreview } from '@/types/text-to-sql.types'

const TEXT_TO_SQL_ENDPOINT = '/api/ai/text-to-sql/preview'
const TEXT_TO_SQL_EXECUTE_ENDPOINT = '/api/ai/text-to-sql/execute'

export class TextToSqlError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'TextToSqlError'
  }
}

export async function generateTextToSqlPreview(question: string): Promise<TextToSqlPreview> {
  return postTextToSql<TextToSqlPreview>(TEXT_TO_SQL_ENDPOINT, { question })
}

export async function executeTextToSqlPreview(
  question: string,
  preview: TextToSqlPreview,
): Promise<TextToSqlExecution> {
  return postTextToSql<TextToSqlExecution>(TEXT_TO_SQL_EXECUTE_ENDPOINT, {
    question,
    sql: preview.sql,
    intent: preview.intent,
    executionToken: preview.executionToken,
  })
}

async function postTextToSql<T>(url: string, body: Record<string, string>): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new TextToSqlError('Unable to reach the AI assistant. Please try again.')
  }

  let payload: unknown
  try {
    payload = (await response.json()) as unknown
  } catch {
    throw new TextToSqlError('The AI assistant returned an invalid response.', response.status)
  }

  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'message' in payload
        ? String(payload.message)
        : 'Unable to generate a query preview.'
    throw new TextToSqlError(message, response.status)
  }

  return payload as T
}
