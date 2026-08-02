import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import type { CalendarProvider, Prisma } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { encryptToken } from '../common/crypto/token-crypto'
import { CalendarOAuthService } from './calendar-oauth.service'
import { CALENDAR_PROVIDERS } from './calendar-providers.token'
import type { CalendarProviderRegistry } from './calendar-providers.token'

/**
 * Calendar connection lifecycle (Story 4.3, AC 3/18/19/33-34).
 *
 * AC 3 (the single most important structural difference from
 * ChannelConnection): every read/write path filters on
 * `{ tenantId, userId: <caller's own userId> }` unconditionally — ADMIN
 * included. `resolveVisibilityFilter` is NOT the right tool here (it resolves
 * on an `ownerId` column and an ADMIN bypasses it entirely); an ADMIN reading
 * another user's calendar tokens is a privacy defect, not an admin feature.
 */

// The select must cover EVERY field the Pothos CalendarConnectionRef exposes
// (id, provider, externalAccountEmail, calendarId, status, lastSyncedAt,
// lastSyncError, createdAt) or the resolver crashes at QUERY time, not
// compile time — there is no @pothos/plugin-prisma, hence no compile-time
// drift detection (AC 34; Critical on Story 3.4, re-flagged ever since).
// Token/syncToken/externalAccountId columns are intentionally NOT selected
// here and must never be exposed over GraphQL (AC 5/33).
export const calendarConnectionSelect = {
  id: true,
  tenantId: true,
  userId: true,
  provider: true,
  externalAccountEmail: true,
  calendarId: true,
  status: true,
  lastSyncedAt: true,
  lastSyncError: true,
  createdAt: true,
  updatedAt: true,
} as const

export type CalendarConnectionListItem = Prisma.CalendarConnectionGetPayload<{
  select: typeof calendarConnectionSelect
}>

export type ConnectCalendarInput = {
  provider: CalendarProvider
  authCode: string
  state: string
}

@Injectable()
export class CalendarConnectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly oauth: CalendarOAuthService,
    @Inject(CALENDAR_PROVIDERS)
    private readonly providers: CalendarProviderRegistry,
  ) {}

  /** Caller's own connections only (AC 3) — soft-deleted (disconnected) rows
   * are excluded so the UI shows "Connect" again for that provider. */
  async listMine(tenantId: string, userId: string): Promise<CalendarConnectionListItem[]> {
    return this.prisma.calendarConnection.findMany({
      where: { tenantId, userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: calendarConnectionSelect,
    })
  }

  /**
   * Connects (or reconnects) the caller's calendar for a provider (AC 14/18).
   * The `state` must verify against the caller, the auth code is exchanged
   * for tokens, the account identity is fetched, and the row is UPSERTED on
   * `tenantId_userId_provider`. The update branch MUST set `deletedAt: null`
   * and `status: 'ACTIVE'`, clear `lastSyncError`, and reset `syncToken` to
   * null — a stale token from a previous grant is invalid (AC 18; finding
   * 3.7-F2).
   */
  async connectCalendar(
    tenantId: string,
    userId: string,
    input: ConnectCalendarInput,
    now: Date = new Date(),
  ): Promise<CalendarConnectionListItem> {
    this.oauth.verifyState(input.state, userId, tenantId, input.provider)

    const tokenSet = await this.oauth.exchangeCode(input.provider, input.authCode)
    const accessTokenEncrypted = encryptToken(tokenSet.accessToken)
    const refreshTokenEncrypted = tokenSet.refreshToken ? encryptToken(tokenSet.refreshToken) : null

    const identity = await this.providers[input.provider].fetchAccountIdentity(tokenSet.accessToken)

    const connection = await this.prisma.calendarConnection.upsert({
      where: {
        tenantId_userId_provider: { tenantId, userId, provider: input.provider },
      },
      create: {
        tenantId,
        userId,
        provider: input.provider,
        externalAccountId: identity.externalAccountId,
        externalAccountEmail: identity.email,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        accessTokenExpiresAt: tokenSet.expiresInSeconds
          ? new Date(now.getTime() + tokenSet.expiresInSeconds * 1000)
          : null,
        scope: tokenSet.scope ?? null,
        status: 'ACTIVE',
        syncToken: null,
        lastSyncError: null,
        createdBy: userId,
        updatedBy: userId,
      },
      update: {
        externalAccountId: identity.externalAccountId,
        externalAccountEmail: identity.email,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        accessTokenExpiresAt: tokenSet.expiresInSeconds
          ? new Date(now.getTime() + tokenSet.expiresInSeconds * 1000)
          : null,
        scope: tokenSet.scope ?? null,
        // AC 18: revive a soft-deleted row, reset status, clear the error and
        // the stale sync token (a token from a previous grant is invalid).
        status: 'ACTIVE',
        syncToken: null,
        lastSyncError: null,
        deletedAt: null,
        updatedBy: userId,
      },
      select: calendarConnectionSelect,
    })

    // Explicit service-level audit (AC 37-39): never contains tokens/auth
    // code/state. The global AuditInterceptor never fires for GraphQL
    // mutations in this repo — this write is the only path that produces a
    // row.
    await this.audit.log({
      tenantId,
      userId,
      action: 'CREATE',
      entity: 'CALENDAR_CONNECTION',
      entityId: connection.id,
      details: {
        provider: input.provider,
        externalAccountEmail: identity.email,
      },
    })

    return connection
  }

  /**
   * Disconnects the caller's calendar for a provider (AC 19): sets
   * `status = 'DISCONNECTED'`, `deletedAt = now()`, nulls BOTH encrypted
   * token columns (do not keep a revoked secret at rest) and hard-deletes
   * that connection's `TaskCalendarEvent` rows. It does NOT delete the events
   * already in the user's external calendar — deleting a user's real calendar
   * data on disconnect is destructive and surprising; the confirm dialog copy
   * states this impact (AC 40).
   */
  async disconnectCalendar(
    tenantId: string,
    userId: string,
    provider: CalendarProvider,
    now: Date = new Date(),
  ): Promise<boolean> {
    const connection = await this.prisma.calendarConnection.findFirst({
      where: { tenantId, userId, provider, deletedAt: null },
      select: { id: true },
    })
    if (!connection) {
      throw new NotFoundException('Calendar connection not found')
    }

    await this.prisma.calendarConnection.update({
      where: { id: connection.id },
      data: {
        status: 'DISCONNECTED',
        deletedAt: now,
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
        updatedBy: userId,
      },
    })

    await this.prisma.taskCalendarEvent.deleteMany({
      where: { calendarConnectionId: connection.id },
    })

    await this.audit.log({
      tenantId,
      userId,
      action: 'DELETE',
      entity: 'CALENDAR_CONNECTION',
      entityId: connection.id,
      details: { provider },
    })

    return true
  }

  /** Own-connection lookup for the sync engine (AC 3). Returns the FULL row
   * including encrypted tokens — never exposed over GraphQL. */
  async findOwnConnection(
    tenantId: string,
    userId: string,
    provider: CalendarProvider,
  ): Promise<{ id: string } | null> {
    const connection = await this.prisma.calendarConnection.findFirst({
      where: { tenantId, userId, provider, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    })
    return connection
  }
}
