import { createHmac } from 'crypto'

import type { BrowserContext, Page } from '@playwright/test'

export interface AuthSession {
  accessToken: string
  refreshToken?: string
  userId: string
  tenantId: string
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value).toString('base64url')
}

function createTestJwt(): string {
  const secret = process.env['JWT_SECRET'] || 'playwright-test-secret-min-32-chars!!'
  const header = encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = encodeBase64Url(
    JSON.stringify({
      userId: 'playwright-user-1',
      tenantId: 'playwright-tenant-1',
      role: 'SALES_REP',
      exp: Math.floor(Date.now() / 1000) + 60 * 60,
    }),
  )
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')

  return `${header}.${payload}.${signature}`
}

export async function applyAuthSession(
  context: BrowserContext,
  session: AuthSession,
): Promise<void> {
  await context.addInitScript((authSession) => {
    window.localStorage.setItem('test-auth-session', JSON.stringify(authSession))
  }, session)
}

export async function applyAuthCookie(context: BrowserContext): Promise<void> {
  await context.addCookies([
    {
      name: 'auth-token',
      value: createTestJwt(),
      domain: new URL(process.env['BASE_URL'] ?? 'http://localhost:3000').hostname,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
}

export async function clearAuthSession(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.localStorage.removeItem('test-auth-session')
  })
}
