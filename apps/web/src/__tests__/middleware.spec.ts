import { TextDecoder, TextEncoder } from 'util'

Object.assign(globalThis, { TextDecoder, TextEncoder })

jest.mock('next/server', () => ({
  NextResponse: {
    next: jest.fn(() => ({ status: 200, headers: new Map<string, string>() })),
    redirect: jest.fn((url: URL) => ({
      status: 307,
      headers: new Map<string, string>([['location', url.toString()]]),
      cookies: { delete: jest.fn() },
    })),
  },
}))

import { middleware } from '../middleware'

type MockRequest = {
  url: string
  nextUrl: { pathname: string; search: string }
  cookies: { get: (name: string) => { value: string } | undefined }
}

function encodeBase64Url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function makeToken(payload: Record<string, unknown>): string {
  return `${encodeBase64Url({ alg: 'HS256', typ: 'JWT' })}.${encodeBase64Url(payload)}.c2ln`
}

function makeRequest(path: string, token?: string): MockRequest {
  const url = new URL(`http://localhost:3000${path}`)
  return {
    url: url.toString(),
    nextUrl: { pathname: url.pathname, search: url.search },
    cookies: {
      get: (name: string) => (name === 'auth-token' && token ? { value: token } : undefined),
    },
  }
}

describe('middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env['JWT_SECRET'] = 'middleware-test-secret-min-32-chars!!'
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        subtle: {
          importKey: jest.fn().mockResolvedValue('key'),
          verify: jest.fn().mockResolvedValue(true),
        },
      },
    })
  })

  it('should redirect unauthenticated users to login for protected routes preserving query string', async () => {
    const response = await middleware(makeRequest('/dashboard?tab=deals') as never)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/login')
    expect(response.headers.get('location')).toContain('redirect=%2Fdashboard%3Ftab%3Ddeals')
  })

  it('should allow unauthenticated users to visit login page', async () => {
    const response = await middleware(makeRequest('/login') as never)

    expect(response.status).toBe(200)
  })

  it('should redirect authenticated users away from login page', async () => {
    const token = makeToken({
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: 'SALES_REP',
      exp: Math.floor(Date.now() / 1000) + 60,
    })

    const response = await middleware(makeRequest('/login', token) as never)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/contacts')
  })

  it('should allow authenticated users to visit protected routes', async () => {
    const token = makeToken({
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: 'SALES_REP',
      exp: Math.floor(Date.now() / 1000) + 60,
    })

    const response = await middleware(makeRequest('/dashboard', token) as never)

    expect(response.status).toBe(200)
  })

  it('should reject expired tokens', async () => {
    const token = makeToken({
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: 'SALES_REP',
      exp: Math.floor(Date.now() / 1000) - 60,
    })

    const response = await middleware(makeRequest('/dashboard', token) as never)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/login')
  })

  it('should reject invalid signatures', async () => {
    ;(crypto.subtle.verify as jest.Mock).mockResolvedValue(false)
    const token = makeToken({
      userId: 'user-1',
      tenantId: 'tenant-1',
      role: 'SALES_REP',
      exp: Math.floor(Date.now() / 1000) + 60,
    })

    const response = await middleware(makeRequest('/dashboard', token) as never)

    expect(response.status).toBe(307)
  })
})
