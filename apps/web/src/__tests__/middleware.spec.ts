import { webcrypto } from 'crypto'
import { TextDecoder, TextEncoder } from 'util'

Object.assign(globalThis, { TextDecoder, TextEncoder })
Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: webcrypto,
})

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
import { createWebSessionCookieValue, WEB_SESSION_COOKIE } from '../lib/auth-cookies'

type MockRequest = {
  url: string
  nextUrl: { pathname: string; search: string }
  cookies: { get: (name: string) => { value: string } | undefined }
}

function makeRequest(path: string, session?: string): MockRequest {
  const url = new URL(`http://localhost:3000${path}`)
  return {
    url: url.toString(),
    nextUrl: { pathname: url.pathname, search: url.search },
    cookies: {
      get: (name: string) =>
        name === WEB_SESSION_COOKIE && session ? { value: session } : undefined,
    },
  }
}

async function makeSession(expiresAtSeconds: number): Promise<string> {
  return createWebSessionCookieValue(expiresAtSeconds)
}

describe('middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env['JWT_SECRET']
    process.env['WEB_SESSION_SECRET'] = 'middleware-web-session-secret-32-chars'
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

  it('should redirect authenticated users away from login page without JWT_SECRET', async () => {
    const session = await makeSession(Math.floor(Date.now() / 1000) + 60)

    const response = await middleware(makeRequest('/login', session) as never)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/contacts')
  })

  it('should allow authenticated users to visit protected routes without JWT_SECRET', async () => {
    const session = await makeSession(Math.floor(Date.now() / 1000) + 60)

    const response = await middleware(makeRequest('/dashboard', session) as never)

    expect(response.status).toBe(200)
  })

  it('should reject expired web sessions', async () => {
    const session = await makeSession(Math.floor(Date.now() / 1000) - 60)

    const response = await middleware(makeRequest('/dashboard', session) as never)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/login')
  })

  it('should reject tampered web sessions and delete auth cookies', async () => {
    const session = await makeSession(Math.floor(Date.now() / 1000) + 60)
    const tamperedSession = `${session.slice(0, -1)}x`

    const response = await middleware(makeRequest('/dashboard', tamperedSession) as never)

    expect(response.status).toBe(307)
    expect(response.cookies.delete).toHaveBeenCalledWith('web-auth-session')
    expect(response.cookies.delete).toHaveBeenCalledWith('backend-auth-token')
  })
})
