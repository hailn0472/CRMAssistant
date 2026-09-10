import {
  executeTextToSqlPreview,
  generateTextToSqlPreview,
  TextToSqlError,
} from '../text-to-sql.service'

describe('generateTextToSqlPreview', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    jest.restoreAllMocks()
    Object.defineProperty(global, 'fetch', { configurable: true, value: originalFetch })
  })

  function mockFetch(response: Promise<Response>): jest.Mock {
    const fetchMock = jest.fn().mockImplementation(() => response)
    Object.defineProperty(global, 'fetch', { configurable: true, value: fetchMock })
    return fetchMock
  }

  it('posts a question and returns the server preview', async () => {
    const preview = {
      sql: 'SELECT "id" FROM "Contact" WHERE "tenantId" = :tenantId LIMIT 10',
      explanation: 'Shows contacts.',
      intent: 'CONTACT_FOLLOW_UPS' as const,
      model: 'gemini-test',
      executionToken: 'signed-preview',
      status: 'preview' as const,
    }
    const fetchMock = mockFetch(
      Promise.resolve({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(preview),
      } as unknown as Response),
    )

    await expect(generateTextToSqlPreview('Who should I follow up with?')).resolves.toEqual(preview)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ai/text-to-sql/preview',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ question: 'Who should I follow up with?' }),
      }),
    )
  })

  it('reports a safe message from failed API responses', async () => {
    mockFetch(
      Promise.resolve({
        ok: false,
        status: 503,
        json: jest.fn().mockResolvedValue({ message: 'Text-to-SQL is not configured' }),
      } as unknown as Response),
    )

    await expect(generateTextToSqlPreview('Show pipeline')).rejects.toEqual(
      expect.objectContaining({ message: 'Text-to-SQL is not configured', status: 503 }),
    )
  })

  it('distinguishes transport failures from API errors', async () => {
    mockFetch(Promise.reject(new Error('offline')))

    await expect(generateTextToSqlPreview('Show pipeline')).rejects.toBeInstanceOf(TextToSqlError)
  })

  it('posts a signed preview to the execution endpoint', async () => {
    const preview = {
      sql: 'SELECT "id" FROM "Contact" WHERE "tenantId" = :tenantId LIMIT 10',
      explanation: 'Shows contacts.',
      intent: 'CONTACT_FOLLOW_UPS' as const,
      model: 'gemini-test',
      executionToken: 'signed-preview',
      status: 'preview' as const,
    }
    const fetchMock = mockFetch(
      Promise.resolve({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ status: 'completed', rows: [] }),
      } as unknown as Response),
    )

    await expect(executeTextToSqlPreview('Who should I follow up with?', preview)).resolves.toEqual(
      {
        status: 'completed',
        rows: [],
      },
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ai/text-to-sql/execute',
      expect.objectContaining({
        body: JSON.stringify({
          question: 'Who should I follow up with?',
          sql: preview.sql,
          intent: preview.intent,
          executionToken: preview.executionToken,
        }),
      }),
    )
  })
})
