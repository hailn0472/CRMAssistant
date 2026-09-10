import { BadRequestException } from '@nestjs/common'
import type { CalendarProvider } from '@prisma/client'

/**
 * Environment configuration for the calendar OAuth providers (Story 4.3,
 * AC 12). A missing client id/secret must produce a clear
 * `BadRequestException` naming the variable when that provider is used —
 * never an opaque 500 (there is no global exception filter in this repo).
 */

export type CalendarProviderClientConfig = {
  clientId: string
  clientSecret: string
}

const GOOGLE_CLIENT_ID_VAR = 'GOOGLE_CALENDAR_CLIENT_ID'
const GOOGLE_CLIENT_SECRET_VAR = 'GOOGLE_CALENDAR_CLIENT_SECRET'
const MICROSOFT_CLIENT_ID_VAR = 'MICROSOFT_CALENDAR_CLIENT_ID'
const MICROSOFT_CLIENT_SECRET_VAR = 'MICROSOFT_CALENDAR_CLIENT_SECRET'
export const OAUTH_REDIRECT_URI_VAR = 'CALENDAR_OAUTH_REDIRECT_URI'
export const MICROSOFT_TENANT_ID_VAR = 'MICROSOFT_CALENDAR_TENANT_ID'
export const SYNC_ON_STARTUP_VAR = 'CALENDAR_SYNC_ON_STARTUP'

export function requireProviderClientConfig(
  provider: CalendarProvider,
): CalendarProviderClientConfig {
  if (provider === 'GOOGLE') {
    return {
      clientId: requireEnv(GOOGLE_CLIENT_ID_VAR),
      clientSecret: requireEnv(GOOGLE_CLIENT_SECRET_VAR),
    }
  }
  return {
    clientId: requireEnv(MICROSOFT_CLIENT_ID_VAR),
    clientSecret: requireEnv(MICROSOFT_CLIENT_SECRET_VAR),
  }
}

export function requireOAuthRedirectUri(): string {
  return requireEnv(OAUTH_REDIRECT_URI_VAR)
}

/** Microsoft tenant id — defaults to `common` (any Microsoft account). */
export function getMicrosoftTenantId(): string {
  return process.env[MICROSOFT_TENANT_ID_VAR] ?? 'common'
}

/** Bootstrap opt-out mirroring `FACEBOOK_HISTORY_SYNC_ON_STARTUP` (AC 26). */
export function isCalendarSyncOnStartupEnabled(): boolean {
  return process.env[SYNC_ON_STARTUP_VAR] !== 'false'
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new BadRequestException(`${name} is not configured`)
  }
  return value
}
