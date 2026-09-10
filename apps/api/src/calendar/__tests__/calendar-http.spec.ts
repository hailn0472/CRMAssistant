import {
  CalendarApiError,
  CalendarCircuitOpenError,
  CalendarHttp,
  CalendarRateLimitError,
  CircuitBreaker,
} from '../calendar-http'

// NFR18/NFR20 reliability tests (AC 20-21). fetch is mocked; sleeps are
// driven with jest fake timers so the suite stays fast. IMPORTANT: the
// `.rejects` assertion must be attached BEFORE advancing timers, otherwise
// the promise rejects with no handler attached and jest fails the test as an
// unhandled rejection.

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: new Headers(headers),
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response
}

describe('CalendarHttp', () => {
  let fetchMock: jest.Mock

  beforeEach(() => {
    jest.useFakeTimers()
    fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('retries a 5xx up to 3 attempts with backoff, then throws the typed error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, 'boom'))
    const http = new CalendarHttp()

    const promise = http.request('GET', 'https://calendar.example/x')
    const assertion = expect(promise).rejects.toThrow(CalendarApiError)
    await jest.advanceTimersByTimeAsync(100_000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does NOT retry a 4xx (permanent failure)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, 'invalid_grant'))
    const http = new CalendarHttp()

    const promise = http.request('GET', 'https://calendar.example/x')
    const assertion = expect(promise).rejects.toThrow(CalendarApiError)
    await jest.advanceTimersByTimeAsync(100_000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('treats 429 as retryable', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, 'too many requests'))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    const http = new CalendarHttp()

    const promise = http.request<{ ok: boolean }>('GET', 'https://calendar.example/x')
    const assertion = expect(promise).resolves.toEqual({ ok: true })
    await jest.advanceTimersByTimeAsync(100_000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('treats Google 403 rateLimitExceeded as retryable (AC 21)', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(403, JSON.stringify({ error: { errors: [{ reason: 'rateLimitExceeded' }] } })),
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    const http = new CalendarHttp()

    const promise = http.request<{ ok: boolean }>('GET', 'https://calendar.example/x')
    const assertion = expect(promise).resolves.toEqual({ ok: true })
    await jest.advanceTimersByTimeAsync(100_000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('honours a Retry-After header instead of the computed backoff (AC 21)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, 'slow down', { 'retry-after': '2' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    const http = new CalendarHttp()
    const sleepSpy = jest.spyOn(global, 'setTimeout')

    const promise = http.request<{ ok: boolean }>('GET', 'https://calendar.example/x')
    const assertion = expect(promise).resolves.toEqual({ ok: true })
    // Advance 2s (the Retry-After), NOT the computed backoff — the request
    // must retry right after the header's wait.
    await jest.advanceTimersByTimeAsync(2_100)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // The first retry delay honoured the header (2s), not the computed
    // exponential backoff (100ms * 2^0 + jitter — far smaller).
    const firstDelay = sleepSpy.mock.calls[0]?.[1] ?? -1
    expect(firstDelay).toBe(2_000)
    sleepSpy.mockRestore()
  })

  it('aborts the pass (no thread block) when Retry-After exceeds the cap — 3600s', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, 'slow down', { 'retry-after': '3600' }))
    const http = new CalendarHttp()

    const promise = http.request('GET', 'https://calendar.example/x')
    const assertion = expect(promise).rejects.toThrow(CalendarRateLimitError)
    await jest.advanceTimersByTimeAsync(10_000)
    await assertion
    // Aborted before any further attempt.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('times out a hung call at 10s with a typed error', async () => {
    fetchMock.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(
            () => reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' })),
            10_000,
          )
        }),
    )
    const http = new CalendarHttp()

    const promise = http.request('GET', 'https://calendar.example/x')
    const assertion = expect(promise).rejects.toThrow(/timed out/)
    await jest.advanceTimersByTimeAsync(100_000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('opens the circuit after 5 consecutive failures and refuses calls while open', async () => {
    jest.setSystemTime(new Date('2026-08-01T00:00:00.000Z'))
    fetchMock.mockResolvedValue(jsonResponse(500, 'boom'))
    const http = new CalendarHttp()

    for (let i = 0; i < 5; i += 1) {
      const promise = http.request('GET', 'https://calendar.example/x')
      const assertion = expect(promise).rejects.toThrow(CalendarApiError)
      // Only the retry sleeps need to elapse (~100ms + ~200ms); the total
      // advance stays well under the 30s circuit cooldown.
      await jest.advanceTimersByTimeAsync(1_000)
      await assertion
    }

    expect(http.getCircuitState()).toBe('OPEN')
    await expect(http.request('GET', 'https://calendar.example/x')).rejects.toThrow(
      CalendarCircuitOpenError,
    )
    // No request was attempted while the circuit is open (15 = 5 × 3).
    expect(fetchMock).toHaveBeenCalledTimes(15)
  })

  it('half-opens after the cooldown and allows one probe', async () => {
    jest.setSystemTime(new Date('2026-08-01T00:00:00.000Z'))
    // 5 failing request() calls × 3 fetch attempts each = 15 failures,
    // then the HALF_OPEN probe succeeds.
    for (let i = 0; i < 15; i += 1) {
      fetchMock.mockResolvedValueOnce(jsonResponse(500, 'boom'))
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    const http = new CalendarHttp()

    for (let i = 0; i < 5; i += 1) {
      const promise = http.request('GET', 'https://calendar.example/x')
      const assertion = expect(promise).rejects.toThrow(CalendarApiError)
      await jest.advanceTimersByTimeAsync(1_000)
      await assertion
    }
    expect(http.getCircuitState()).toBe('OPEN')

    // Cooldown (30s) elapses FIRST, then the probe starts — canAttempt() is
    // evaluated synchronously when the request is created.
    await jest.advanceTimersByTimeAsync(40_000)
    const probe = http.request('GET', 'https://calendar.example/x')
    const probeAssertion = expect(probe).resolves.toEqual({ ok: true })
    await probeAssertion
    expect(http.getCircuitState()).toBe('CLOSED')
  })

  it('returns the JSON body for a successful call', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'evt-1' }))
    const http = new CalendarHttp()

    await expect(http.request('GET', 'https://calendar.example/x')).resolves.toEqual({
      id: 'evt-1',
    })
  })

  it('sends a JSON body with the JSON content type', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}))
    const http = new CalendarHttp()

    await http.request('POST', 'https://calendar.example/x', { body: { a: 1 } })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://calendar.example/x')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(init.body).toBe('{"a":1}')
  })

  it('exports a CircuitBreaker with the documented 5-failure threshold', () => {
    const breaker = new CircuitBreaker()
    expect(breaker.getState()).toBe('CLOSED')
    breaker.recordFailure()
    expect(breaker.getState()).toBe('CLOSED')
  })
})
