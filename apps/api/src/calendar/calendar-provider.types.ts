import type { CalendarProvider } from '@prisma/client'

/**
 * Shared types for the calendar integration (Story 4.3).
 *
 * `CalendarProviderPort` is the single seam behind which every
 * provider-specific fact lives (Google Calendar and Outlook Calendar). The
 * sync engine, the OAuth flow, the link model, the conflict logic, the
 * GraphQL surface and the frontend are provider-agnostic and written once —
 * a provider is nothing more than an entry in a
 * `Record<CalendarProvider, CalendarProviderPort>`.
 */

export type CalendarTokenSet = {
  accessToken: string
  /** Nullable — a provider may not return one on re-consent. */
  refreshToken: string | null
  /** Seconds until the access token expires; null when unknown. */
  expiresInSeconds: number | null
  /** Granted scopes as returned by the provider. */
  scope?: string | null
}

export type CalendarEventPayload = {
  summary: string
  description: string | null
  start: Date
  end: Date
}

export type CalendarBusySlot = {
  start: Date
  end: Date
  /** The occupying event's provider id, when the provider exposes it — used
   * to exclude our own events from conflict detection (AC 27). */
  externalEventId?: string | null
  /** The occupying event's subject, when the provider exposes it — used for
   * the human-readable conflict summary (AC 27). */
  title?: string | null
}

export type CalendarRemoteEvent = {
  externalEventId: string
  title: string | null
  description: string | null
  start: Date | null
  end: Date | null
  /** Provider's `updated` / `lastModifiedDateTime` — the loop guard (AC 24). */
  remoteUpdatedAt: Date | null
  /** True when the provider reports the event cancelled/removed (AC 25). */
  cancelled: boolean
}

export type CalendarProviderContext = {
  accessToken: string
  /** Google calendar id (`primary`) / Graph calendar id. */
  calendarId: string
  /** Injected wall-clock time for deterministic tests; defaults to now. */
  now?: Date
}

export type CalendarProviderPort = {
  buildAuthorizeUrl(state: string): string
  exchangeCode(code: string): Promise<CalendarTokenSet>
  refreshAccessToken(refreshToken: string): Promise<CalendarTokenSet>
  fetchAccountIdentity(
    accessToken: string,
  ): Promise<{ externalAccountId: string; email: string | null }>
  createEvent(
    ctx: CalendarProviderContext,
    event: CalendarEventPayload,
  ): Promise<{ externalEventId: string; remoteUpdatedAt: Date | null }>
  updateEvent(
    ctx: CalendarProviderContext,
    externalEventId: string,
    event: CalendarEventPayload,
  ): Promise<{ remoteUpdatedAt: Date | null }>
  deleteEvent(ctx: CalendarProviderContext, externalEventId: string): Promise<void>
  listBusy(ctx: CalendarProviderContext, from: Date, to: Date): Promise<CalendarBusySlot[]>
  listChanges(
    ctx: CalendarProviderContext,
    syncToken: string | null,
  ): Promise<{
    changes: CalendarRemoteEvent[]
    nextSyncToken: string | null
    requiresFullResync: boolean
  }>
}

export { CalendarProvider }
