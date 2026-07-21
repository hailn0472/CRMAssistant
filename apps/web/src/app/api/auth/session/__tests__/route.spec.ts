/** @jest-environment node */

const mockCookieGet = jest.fn()

jest.mock('next/headers', () => ({
  cookies: jest.fn(() => ({
    get: mockCookieGet,
  })),
}))

describe('GET /api/auth/session', () => {
  let GET: () => Promise<Response>

  beforeAll(async () => {
    const mod = await import('../route')
    GET = mod.GET
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns wsToken: null without calling the backend when there is no auth cookie', async () => {
    mockCookieGet.mockReturnValue(undefined)
    const mockFetch = jest.fn()
    global.fetch = mockFetch

    const response = await GET()

    expect(mockFetch).not.toHaveBeenCalled()
    const body = await response.json()
    expect(body).toEqual({ wsToken: null })
  })

  it('mints a one-time ws token via the backend and never returns the real cookie value', async () => {
    mockCookieGet.mockReturnValue({ value: 'real-jwt-value' })
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ wsToken: 'one-time-token-abc' }),
    } as Response)
    global.fetch = mockFetch

    const response = await GET()

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/ws-token'),
      expect.objectContaining({ headers: { Authorization: 'Bearer real-jwt-value' } }),
    )
    const body = await response.json()
    expect(body).toEqual({ wsToken: 'one-time-token-abc' })
    expect(JSON.stringify(body)).not.toContain('real-jwt-value')
  })

  it('returns wsToken: null when the backend rejects the request', async () => {
    mockCookieGet.mockReturnValue({ value: 'expired-or-invalid' })
    const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 401 } as Response)
    global.fetch = mockFetch

    const response = await GET()

    const body = await response.json()
    expect(body).toEqual({ wsToken: null })
  })

  it('returns wsToken: null when the backend call throws', async () => {
    mockCookieGet.mockReturnValue({ value: 'some-token' })
    global.fetch = jest.fn().mockRejectedValue(new Error('network error'))

    const response = await GET()

    const body = await response.json()
    expect(body).toEqual({ wsToken: null })
  })
})
