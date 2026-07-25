import {
  CircuitBreaker,
  FacebookCircuitOpenError,
  FacebookGraphClient,
  FacebookRateLimitError,
} from '../facebook-graph.client'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

describe('FacebookGraphClient', () => {
  let client: FacebookGraphClient
  let fetchMock: jest.Mock

  beforeEach(() => {
    client = new FacebookGraphClient()
    fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('sendMessage()', () => {
    it('POSTs to /me/messages with the recipient PSID and message payload', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ message_id: 'mid.123' }))

      const result = await client.sendMessage('page-token', 'psid-1', { text: 'Hello' })

      expect(result).toEqual({ message_id: 'mid.123' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/me/messages?access_token=page-token')
      expect(url).toContain('graph.facebook.com')
      const body = JSON.parse(init.body as string) as Record<string, unknown>
      expect(body).toEqual({
        recipient: { id: 'psid-1' },
        messaging_type: 'RESPONSE',
        message: { text: 'Hello' },
      })
    })

    it('never includes the access token in the request body', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ message_id: 'mid.1' }))

      await client.sendMessage('super-secret-token', 'psid-1', { text: 'Hi' })

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(init.body as string).not.toContain('super-secret-token')
    })

    it('retries transient failures with exponential backoff before succeeding', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({}, false, 500))
        .mockResolvedValueOnce(jsonResponse({}, false, 500))
        .mockResolvedValueOnce(jsonResponse({ message_id: 'mid.ok' }))

      const result = await client.sendMessage('token', 'psid-1', { text: 'Retry' })

      expect(result).toEqual({ message_id: 'mid.ok' })
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('throws after exhausting retry attempts', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: 'boom' }, false, 500))

      await expect(client.sendMessage('token', 'psid-1', { text: 'Fail' })).rejects.toThrow(
        /Facebook Graph API error/,
      )
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('does not retry a non-retryable 4xx error (fails fast on the first attempt)', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid token' }, false, 401))

      await expect(client.sendMessage('token', 'psid-1', { text: 'Fail' })).rejects.toThrow(
        /Facebook Graph API error \(401\)/,
      )
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('passes a request timeout signal on every outbound call', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ message_id: 'mid.1' }))

      await client.sendMessage('token', 'psid-1', { text: 'Hi' })

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(init.signal).toBeInstanceOf(AbortSignal)
    })
  })

  describe('rate limiter', () => {
    it('blocks outbound calls after 600 requests within the rolling hour', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ message_id: 'mid' }))

      for (let i = 0; i < 600; i++) {
        // eslint-disable-next-line no-await-in-loop
        await client.sendMessage('token', 'psid', { text: `msg-${i}` })
      }

      await expect(client.sendMessage('token', 'psid', { text: 'over-limit' })).rejects.toThrow(
        FacebookRateLimitError,
      )
      expect(fetchMock).toHaveBeenCalledTimes(600)
    })
  })

  describe('getConversations()', () => {
    it('GETs /me/conversations with the correct fields and access token', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ data: [], paging: {} }))

      await client.getConversations('page-token')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url] = fetchMock.mock.calls[0] as [string]
      expect(url).toContain('/me/conversations?')
      expect(url).toContain('graph.facebook.com')
      expect(url).toContain(
        `fields=${encodeURIComponent('participants,messages{message,from,to,created_time,id}')}`,
      )
      expect(url).toContain('access_token=page-token')
      expect(url).not.toContain('&after=')
    })

    it('appends the after cursor when paginating', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ data: [], paging: {} }))

      await client.getConversations('page-token', { after: 'cursor-123' })

      const [url] = fetchMock.mock.calls[0] as [string]
      expect(url).toContain('&after=cursor-123')
    })

    it('returns the parsed conversations payload', async () => {
      const payload = {
        data: [{ id: 'conv-1', messages: { data: [] } }],
        paging: { cursors: { after: 'next-cursor' } },
      }
      fetchMock.mockResolvedValue(jsonResponse(payload))

      const result = await client.getConversations('page-token')

      expect(result).toEqual(payload)
    })

    it('shares the outbound rate limiter budget with sendMessage', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ message_id: 'mid' }))

      for (let i = 0; i < 600; i++) {
        // eslint-disable-next-line no-await-in-loop
        await client.sendMessage('token', 'psid', { text: `msg-${i}` })
      }

      await expect(client.getConversations('token')).rejects.toThrow(FacebookRateLimitError)
    })

    it('is short-circuited by an open circuit breaker from prior sendMessage failures', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, false, 500))

      for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop
        await expect(client.sendMessage('token', 'psid', { text: `fail-${i}` })).rejects.toThrow()
      }
      expect(client.getCircuitState()).toBe('OPEN')

      fetchMock.mockClear()
      await expect(client.getConversations('token')).rejects.toThrow(FacebookCircuitOpenError)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('getPageByUrl()', () => {
    it('GETs the given absolute URL as-is when it already carries an access token', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ data: [] }))

      await client.getPageByUrl(
        'https://graph.facebook.com/v21.0/t/messages?access_token=abc&after=x',
      )

      const [url] = fetchMock.mock.calls[0] as [string]
      expect(url).toBe('https://graph.facebook.com/v21.0/t/messages?access_token=abc&after=x')
    })

    it('appends the access token when the URL does not already carry one', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ data: [] }))

      await client.getPageByUrl('https://graph.facebook.com/v21.0/t/messages?after=x', 'page-token')

      const [url] = fetchMock.mock.calls[0] as [string]
      expect(url).toBe(
        'https://graph.facebook.com/v21.0/t/messages?after=x&access_token=page-token',
      )
    })

    it('passes a request timeout signal', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ data: [] }))

      await client.getPageByUrl('https://graph.facebook.com/v21.0/t/messages', 'page-token')

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(init.signal).toBeInstanceOf(AbortSignal)
    })
  })

  describe('circuit breaker', () => {
    it('opens after 5 consecutive failures and short-circuits further calls', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, false, 500))

      for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop
        await expect(client.sendMessage('token', 'psid', { text: `fail-${i}` })).rejects.toThrow()
      }

      expect(client.getCircuitState()).toBe('OPEN')

      fetchMock.mockClear()
      await expect(
        client.sendMessage('token', 'psid', { text: 'short-circuited' }),
      ).rejects.toThrow(FacebookCircuitOpenError)
      // Short-circuited — no network call attempted.
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('half-opens after the cooldown and closes again on success', async () => {
      // Inject a circuit breaker with a short cooldown so the test doesn't need
      // to wait out the real 30s default or fight fake timers against the
      // client's internal retry backoff.
      const shortCooldownClient = new FacebookGraphClient({
        circuitBreaker: new CircuitBreaker(5, 20),
      })

      fetchMock.mockResolvedValue(jsonResponse({}, false, 500))

      for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop
        await expect(
          shortCooldownClient.sendMessage('token', 'psid', { text: `fail-${i}` }),
        ).rejects.toThrow()
      }
      expect(shortCooldownClient.getCircuitState()).toBe('OPEN')

      await new Promise((resolve) => setTimeout(resolve, 30))

      fetchMock.mockResolvedValueOnce(jsonResponse({ message_id: 'recovered' }))
      const result = await shortCooldownClient.sendMessage('token', 'psid', {
        text: 'half-open probe',
      })

      expect(result).toEqual({ message_id: 'recovered' })
      expect(shortCooldownClient.getCircuitState()).toBe('CLOSED')
    })
  })
})
