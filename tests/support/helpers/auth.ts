import type { BrowserContext, Page } from '@playwright/test'

export interface AuthSession {
  accessToken: string
  refreshToken?: string
  userId: string
  tenantId: string
}

export async function applyAuthSession(
  context: BrowserContext,
  session: AuthSession,
): Promise<void> {
  await context.addInitScript((authSession) => {
    window.localStorage.setItem('test-auth-session', JSON.stringify(authSession))
  }, session)
}

export async function clearAuthSession(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.localStorage.removeItem('test-auth-session')
  })
}
