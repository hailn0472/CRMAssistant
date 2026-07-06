import { TextDecoder, TextEncoder } from 'util'

Object.assign(globalThis, { TextDecoder, TextEncoder })

jest.mock('next/server', () => ({
  NextResponse: {
    next: jest.fn(() => ({
      status: 200,
      headers: new Map<string, string>(),
      cookies: { delete: jest.fn() },
    })),
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
  const { createHmac } = require('crypto') as typeof import('crypto')
  const header = encodeBase64Url({ alg: 'HS256', typ: 'JWT' })
  const body = encodeBase64Url(payload)
  const secret = process.env['JWT_SECRET'] || 'middleware-test-secret-min-32-chars!!'
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
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
  })

  it('should redirect unauthenticated users to login for protected routes preserving query string', async () => {
    const response = await middleware(makeRequest('/dashboard?tab=deals') as never)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/login')
    expect(response.headers.get('location')).toContain('redirect=%2Fdashboard%3Ftab%3Ddeals')
  })

  it('should allow unauthenticated users to visit public auth pages', async () => {
    await expect(middleware(makeRequest('/login') as never)).resolves.toMatchObject({ status: 200 })
    await expect(middleware(makeRequest('/register') as never)).resolves.toMatchObject({
      status: 200,
    })
    await expect(middleware(makeRequest('/forgot-password') as never)).resolves.toMatchObject({
      status: 200,
    })
  })

  it('should not treat sibling routes as public auth pages', async () => {
    const response = await middleware(makeRequest('/login-help') as never)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/login')
    expect(response.headers.get('location')).toContain('redirect=%2Flogin-help')
  })

  it('should not treat nested auth routes as public pages', async () => {
    const response = await middleware(makeRequest('/login/help') as never)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/login')
    expect(response.headers.get('location')).toContain('redirect=%2Flogin%2Fhelp')
  })

  it('should protect routes containing dots', async () => {
    const response = await middleware(makeRequest('/contacts/john.doe') as never)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/login')
    expect(response.headers.get('location')).toContain('redirect=%2Fcontacts%2Fjohn.doe')
  })

  it('should redirect authenticated users away from login page to Command Center', async () => {
    const token = makeToken({
      userId: 'user-1',
      tenantId: 'tenant-1',
      roles: ['SALES_REP'],
      exp: Math.floor(Date.now() / 1000) + 60,
    })

    const response = await middleware(makeRequest('/login', token) as never)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/dashboard')
  })

  it('should redirect authenticated users from the root page to Command Center', async () => {
    const token = makeToken({
      userId: 'user-1',
      tenantId: 'tenant-1',
      roles: ['SALES_REP'],
      exp: Math.floor(Date.now() / 1000) + 60,
    })

    const response = await middleware(makeRequest('/', token) as never)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/dashboard')
  })

  it('should allow authenticated users to visit protected routes', async () => {
    const token = makeToken({
      userId: 'user-1',
      tenantId: 'tenant-1',
      roles: ['SALES_REP'],
      exp: Math.floor(Date.now() / 1000) + 60,
    })

    const response = await middleware(makeRequest('/dashboard', token) as never)

    expect(response.status).toBe(200)
  })

  it('should reject expired tokens', async () => {
    const token = makeToken({
      userId: 'user-1',
      tenantId: 'tenant-1',
      roles: ['SALES_REP'],
      exp: Math.floor(Date.now() / 1000) - 60,
    })

    const response = await middleware(makeRequest('/dashboard', token) as never)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/login')
  })

  it('should reject invalid signatures and delete the stale auth cookie', async () => {
    const token = makeToken({
      userId: 'user-1',
      tenantId: 'tenant-1',
      roles: ['SALES_REP'],
      exp: Math.floor(Date.now() / 1000) + 60,
    })
    // Tamper with the signature
    const [header, payload] = token.split('.')
    const tamperedToken = `${header}.${payload}.badtoken`

    const response = await middleware(makeRequest('/dashboard', tamperedToken) as never)

    expect(response.status).toBe(307)
    expect(response.cookies.delete).toHaveBeenCalledWith('auth-token')
  })

  it('should reject malformed tokens without throwing', async () => {
    const response = await middleware(makeRequest('/contacts', 'malformed-token') as never)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/login')
    expect(response.cookies.delete).toHaveBeenCalledWith('auth-token')
  })

  it('should delete stale auth cookies on public auth pages', async () => {
    const response = await middleware(makeRequest('/login', 'malformed-token') as never)

    expect(response.status).toBe(200)
    expect(response.cookies.delete).toHaveBeenCalledWith('auth-token')
  })
})
