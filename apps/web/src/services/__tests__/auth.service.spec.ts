import { authService } from '../auth.service'

const mockFetch = jest.fn()
global.fetch = mockFetch

function jsonResponse(body: unknown, ok = true, statusText = 'OK'): Response {
  return {
    ok,
    statusText,
    headers: { get: jest.fn(() => 'application/json') },
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response
}

describe('authService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should register a user', async () => {
    const response = {
      accessToken: 'token',
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: 'SALES_REP',
      email: 'user@example.com',
      name: 'Test User',
    }
    mockFetch.mockResolvedValue(jsonResponse(response))

    const result = await authService.register({
      email: 'user@example.com',
      password: 'Password123',
      name: 'Test User',
      tenantName: 'ACME Corp',
    })

    expect(result).toEqual(response)
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/auth/register',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('should throw when register fails with JSON message', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ message: 'Email already registered' }, false))

    await expect(
      authService.register({
        email: 'user@example.com',
        password: 'Password123',
        name: 'Test User',
        tenantName: 'ACME Corp',
      }),
    ).rejects.toThrow('Email already registered')
  })

  it('should fallback when register error body is not JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      statusText: 'Bad Gateway',
      headers: { get: jest.fn(() => 'text/html') },
    })

    await expect(
      authService.register({
        email: 'user@example.com',
        password: 'Password123',
        name: 'Test User',
        tenantName: 'ACME Corp',
      }),
    ).rejects.toThrow('Bad Gateway')
  })

  it('should login a user', async () => {
    const response = {
      accessToken: 'token',
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: 'SALES_REP',
      email: 'user@example.com',
      name: 'Test User',
    }
    mockFetch.mockResolvedValue(jsonResponse(response))

    const result = await authService.login({ email: 'user@example.com', password: 'Password123' })

    expect(result).toEqual(response)
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('should throw when login fails', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ message: 'Invalid credentials' }, false))

    await expect(
      authService.login({ email: 'user@example.com', password: 'WrongPass123' }),
    ).rejects.toThrow('Invalid credentials')
  })

  it('should fallback when JSON error parsing fails', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      statusText: 'Unauthorized',
      headers: { get: jest.fn(() => 'application/json') },
      json: jest.fn().mockRejectedValue(new Error('invalid json')),
    })

    await expect(
      authService.login({ email: 'user@example.com', password: 'WrongPass123' }),
    ).rejects.toThrow('Login failed')
  })

  it('should request password recovery', async () => {
    mockFetch.mockResolvedValue({ ok: true })

    await expect(authService.forgotPassword('user@example.com')).resolves.toBeUndefined()

    expect(mockFetch).toHaveBeenCalledWith('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com' }),
    })
  })

  it('should throw when password recovery fails', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ message: 'Unable to send reset email' }, false))

    await expect(authService.forgotPassword('user@example.com')).rejects.toThrow(
      'Unable to send reset email',
    )
  })

  it('should logout a user', async () => {
    mockFetch.mockResolvedValue({ ok: true })

    await expect(authService.logout()).resolves.toBeUndefined()

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
