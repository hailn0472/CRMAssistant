import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'

import { GoogleAiStudioClient } from '../google-ai-studio.client'

describe('GoogleAiStudioClient', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    Object.defineProperty(global, 'fetch', { configurable: true, value: originalFetch })
  })

  function createClient(values: Record<string, string | undefined>): GoogleAiStudioClient {
    const configService = {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService

    return new GoogleAiStudioClient(configService)
  }

  it('fails closed when no Google AI Studio key is configured', async () => {
    const client = createClient({})

    await expect(client.generateJson('system', 'question')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
  })

  it('posts JSON-mode generation requests with the API key in a header', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        candidates: [{ content: { parts: [{ text: '{"sql":"SELECT 1"}' }] } }],
      }),
    } as unknown as Response)
    Object.defineProperty(global, 'fetch', { configurable: true, value: fetchMock })
    const client = createClient({
      GOOGLE_AI_STUDIO_API_KEY: 'test-key',
      GOOGLE_AI_STUDIO_MODEL: 'gemini-test',
    })

    await expect(client.generateJson('system prompt', 'sales question')).resolves.toEqual({
      content: '{"sql":"SELECT 1"}',
      model: 'gemini-test',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/models/gemini-test:generateContent'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-goog-api-key': 'test-key' }),
      }),
    )
  })

  const failureCases: Array<[string, () => Promise<Response>]> = [
    ['network failure', (): Promise<Response> => Promise.reject(new Error('network'))],
    ['provider rejection', (): Promise<Response> => Promise.resolve({ ok: false } as Response)],
    [
      'invalid JSON',
      (): Promise<Response> =>
        Promise.resolve({
          ok: true,
          json: (): Promise<unknown> => Promise.reject(new Error('json')),
        } as Response),
    ],
    [
      'empty candidates',
      (): Promise<Response> =>
        Promise.resolve({
          ok: true,
          json: (): Promise<unknown> => Promise.resolve({}),
        } as Response),
    ],
  ]

  it.each(failureCases)('maps %s to a safe provider error', async (_label, responseFactory) => {
    Object.defineProperty(global, 'fetch', {
      configurable: true,
      value: jest.fn(responseFactory),
    })
    const client = createClient({ GOOGLE_AI_STUDIO_API_KEY: 'test-key' })

    await expect(client.generateJson('system', 'question')).rejects.toBeInstanceOf(
      BadGatewayException,
    )
  })
})
