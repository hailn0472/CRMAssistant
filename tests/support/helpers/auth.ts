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

/** @internal shared implementation */
function buildTestJwt(secretOverride?: string, rolesOverride?: string[]): string {
  const secret =
    secretOverride ?? process.env['JWT_SECRET'] ?? 'playwright-test-secret-min-32-chars!!'
  const roles = rolesOverride ?? ['SALES_REP']
  // Allow overrides via env vars so E2E tests can match a real tenant/user
  const userId = process.env['PLAYWRIGHT_USER_ID'] ?? 'playwright-user-1'
  const tenantId = process.env['PLAYWRIGHT_TENANT_ID'] ?? 'playwright-tenant-1'
  const email = process.env['PLAYWRIGHT_EMAIL'] ?? 'playwright@test.local'
  const header = encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = encodeBase64Url(
    JSON.stringify({
      sub: userId,
      userId,
      tenantId,
      roles,
      email,
      exp: Math.floor(Date.now() / 1000) + 60 * 60,
    }),
  )
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')

  return `${header}.${payload}.${signature}`
}

export function createTestJwt(secretOverride?: string, rolesOverride?: string[]): string {
  return buildTestJwt(secretOverride, rolesOverride)
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
      value: buildTestJwt(),
      url: process.env['BASE_URL'] ?? 'http://localhost:3000',
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
