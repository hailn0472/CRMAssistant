import { randomBytes } from 'node:crypto'

import type { JwtPayload } from './strategies/jwt.strategy'

const TOKEN_TTL_MS = 15_000

type StoredEntry = {
  payload: JwtPayload
  expiresAt: number
}

/**
 * Short-lived, single-use tokens used only to authenticate the initial
 * GraphQL WebSocket handshake after a page reload (see
 * `GET /auth/ws-token`, `apps/web/src/app/api/auth/session/route.ts`, and
 * `AppGraphqlModule`'s `onConnect`).
 *
 * Exists so the real JWT never has to be handed back to client-side JS just
 * to open a WebSocket — the browser gets an opaque, one-time token instead
 * that expires in seconds and can only be used once (Story 8A.3 code review
 * fix: the previous approach returned the real httpOnly `auth-token` cookie
 * value to client JS, which measurably weakened httpOnly's XSS protection
 * for the whole app).
 *
 * Plain module-level singleton (not a Nest-managed provider) because
 * `AppGraphqlModule`'s `onConnect` is a static factory evaluated at
 * `GraphQLModule.forRoot()` registration time, before Nest's DI container is
 * available there — same constraint that already forces that file to
 * construct its own `ConfigService`/`JwtService` instances directly. In-memory
 * `Map` is acceptable for MVP (single instance) — same trade-off as the
 * Facebook outbound rate limiter.
 */
const tokens = new Map<string, StoredEntry>()

function evictExpired(): void {
  const now = Date.now()
  for (const [token, entry] of tokens) {
    if (entry.expiresAt < now) tokens.delete(token)
  }
}

export function issueWsHandshakeToken(payload: JwtPayload): string {
  evictExpired()
  const token = randomBytes(32).toString('hex')
  tokens.set(token, { payload, expiresAt: Date.now() + TOKEN_TTL_MS })
  return token
}

/** Single-use: the token is deleted whether or not it was still valid. */
export function consumeWsHandshakeToken(token: string): JwtPayload | null {
  const entry = tokens.get(token)
  tokens.delete(token)
  if (!entry || entry.expiresAt < Date.now()) return null
  return entry.payload
}
