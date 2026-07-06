/** @jest-environment node */

const mockCookieSet = jest.fn()

jest.mock('next/headers', () => ({
  cookies: jest.fn(() => ({
    set: mockCookieSet,
  })),
}))

describe('POST /api/auth/oauth', () => {
  let POST: (request: Request) => Promise<Response>

  beforeAll(async () => {
    const mod = await import('../route')
    POST = mod.POST
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 400 when accessToken is missing', async () => {
    const response = await POST(
      new Request('http://localhost/api/auth/oauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.message).toBe('Missing access token')
  })

  it('returns 400 for non-JSON body', async () => {
    const response = await POST(
      new Request('http://localhost/api/auth/oauth', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'not-json',
      }),
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.message).toBe('Invalid JSON body')
  })

  it('forwards access_token to backend and sets cookie on success', async () => {
    const backendResponse = {
      accessToken: 'jwt-token-123',
      userId: 'user-1',
      tenantId: 'tenant-1',
      roles: ['SALES_REP'],
      email: 'user@example.com',
      firstName: 'Test',
      lastName: 'User',
    }

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => backendResponse,
    } as Response)
    global.fetch = mockFetch

    const response = await POST(
      new Request('http://localhost/api/auth/oauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: 'supabase-token-xyz' }),
      }),
    )

    expect(response.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/oauth-login'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: 'supabase-token-xyz' }),
      }),
    )
    expect(mockCookieSet).toHaveBeenCalledWith(
      'auth-token',
      'jwt-token-123',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 86_400,
      }),
    )
  })

  it('returns backend error status on non-OK response', async () => {
    const backendError = { message: 'OAuth login failed', statusCode: 401 }

    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => backendError,
    } as Response)
    global.fetch = mockFetch

    const response = await POST(
      new Request('http://localhost/api/auth/oauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: 'invalid-token' }),
      }),
    )

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.message).toBe('OAuth login failed')
  })

  it('returns 502 when backend response has no accessToken', async () => {
    const backendResponse = { userId: 'user-1' }

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => backendResponse,
    } as Response)
    global.fetch = mockFetch

    const response = await POST(
      new Request('http://localhost/api/auth/oauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: 'token-xyz' }),
      }),
    )

    expect(response.status).toBe(502)
  })
})
