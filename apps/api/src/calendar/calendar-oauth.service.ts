import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { randomUUID } from 'node:crypto'
import type { CalendarProvider } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { decryptToken, encryptToken } from '../common/crypto/token-crypto'
import { CalendarApiError } from './calendar-http'
import { CALENDAR_PROVIDERS } from './calendar-providers.token'
import type { CalendarProviderPort, CalendarTokenSet } from './calendar-provider.types'

/**
 * Calendar OAuth orchestration (Story 4.3, AC 12-17).
 *
 * - Authorization Code flow with a signed `state`: the `state` is generated
 *   server-side, bound to the caller, and verified by `connectCalendar` —
 *   skipping that verification is a live CSRF hole that lets an attacker
 *   graft their calendar onto a victim's account (AC 14).
 * - Token refresh is proactive and centralised in `getValidAccessToken`:
 *   refresh when `accessTokenExpiresAt` is absent or within 120 seconds of
 *   now; a refresh that fails with a 4xx sets `status = 'REAUTH_REQUIRED'`
 *   and `lastSyncError` and does NOT retry a permanently-invalid grant
 *   (AC 17).
 */

const STATE_TTL_MS = 10 * 60 * 1000 // ≤ 10 minutes (AC 14)
const PROACTIVE_REFRESH_LEAD_MS = 120 * 1000 // refresh within 120s of expiry (AC 17)

export type CalendarConnectionTokenRow = {
  id: string
  userId: string
  provider: CalendarProvider
  accessTokenEncrypted: string | null
  refreshTokenEncrypted: string | null
  accessTokenExpiresAt: Date | null
}

@Injectable()
export class CalendarOAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    @Inject(CALENDAR_PROVIDERS)
    private readonly providers: Record<CalendarProvider, CalendarProviderPort>,
  ) {}

  /** Server-side authorize URL + signed state bound to the caller (AC 14). */
  buildAuthorizeUrl(
    provider: CalendarProvider,
    userId: string,
    tenantId: string,
  ): { url: string; state: string } {
    const state = this.jwtService.sign(
      {
        userId,
        tenantId,
        provider,
        nonce: randomUUID(),
      },
      { expiresIn: '10m' },
    )
    const url = this.providers[provider].buildAuthorizeUrl(state)
    return { url, state }
  }

  /** Verifies a state returned from the provider's redirect (AC 14). Rejects
   * an expired state and a state whose userId/tenantId do not match the
   * caller. */
  verifyState(state: string, userId: string, tenantId: string, provider: CalendarProvider): void {
    let payload: { userId?: string; tenantId?: string; provider?: string; iat?: number }
    try {
      payload = this.jwtService.verify<{
        userId?: string
        tenantId?: string
        provider?: string
        iat?: number
      }>(state)
    } catch {
      throw new BadRequestException('Invalid or expired calendar authorization state')
    }

    // Belt and braces on top of the JWT exp claim: a state minted more than
    // 10 minutes ago is rejected even if the JWT itself still verifies.
    const iatMs = typeof payload.iat === 'number' ? payload.iat * 1000 : Number.NaN
    if (!Number.isFinite(iatMs) || Date.now() - iatMs > STATE_TTL_MS) {
      throw new BadRequestException('Calendar authorization state has expired')
    }

    if (
      payload.userId !== userId ||
      payload.tenantId !== tenantId ||
      payload.provider !== provider
    ) {
      throw new BadRequestException('Invalid calendar authorization state')
    }
  }

  async exchangeCode(provider: CalendarProvider, code: string): Promise<CalendarTokenSet> {
    return this.providers[provider].exchangeCode(code)
  }

  /**
   * Returns a valid (unencrypted) access token for a connection, refreshing
   * proactively when the stored one is absent or within 120 seconds of
   * expiry. A refresh that fails with a 4xx marks the connection
   * `REAUTH_REQUIRED` and throws a clear "reconnect required" error — it does
   * not retry a permanently-invalid grant (AC 17).
   */
  async getValidAccessToken(
    connection: CalendarConnectionTokenRow,
    now: Date = new Date(),
  ): Promise<string> {
    const expiresAt = connection.accessTokenExpiresAt
    const needsRefresh =
      !expiresAt || expiresAt.getTime() - now.getTime() <= PROACTIVE_REFRESH_LEAD_MS

    if (!needsRefresh && connection.accessTokenEncrypted) {
      return decryptToken(connection.accessTokenEncrypted)
    }

    if (!connection.refreshTokenEncrypted) {
      throw new BadRequestException('Calendar connection has no refresh token — reconnect required')
    }

    try {
      const tokenSet = await this.providers[connection.provider].refreshAccessToken(
        decryptToken(connection.refreshTokenEncrypted),
      )
      const accessTokenEncrypted = encryptToken(tokenSet.accessToken)
      const refreshTokenEncrypted = tokenSet.refreshToken
        ? encryptToken(tokenSet.refreshToken)
        : connection.refreshTokenEncrypted
      await this.prisma.calendarConnection.update({
        where: { id: connection.id },
        data: {
          accessTokenEncrypted,
          refreshTokenEncrypted,
          accessTokenExpiresAt: tokenSet.expiresInSeconds
            ? new Date(now.getTime() + tokenSet.expiresInSeconds * 1000)
            : null,
          updatedBy: connection.userId,
        },
      })
      return tokenSet.accessToken
    } catch (error) {
      // 4xx refresh = permanently-invalid grant → REAUTH_REQUIRED, no retry.
      if (error instanceof CalendarApiError && error.status >= 400 && error.status < 500) {
        await this.prisma.calendarConnection.update({
          where: { id: connection.id },
          data: {
            status: 'REAUTH_REQUIRED',
            lastSyncError: 'Refresh token rejected by provider — reconnect required',
            updatedBy: connection.userId,
          },
        })
        throw new BadRequestException(
          `Calendar connection requires reauthorization (${connection.provider})`,
        )
      }
      throw error
    }
  }
}
