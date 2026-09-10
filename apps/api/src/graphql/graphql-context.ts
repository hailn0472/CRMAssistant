import type { JwtPayload } from '../auth/strategies/jwt.strategy'

export type GraphqlContext = {
  user?: JwtPayload
  rolesBatchCache?: Map<string, { id: string; name: string }[]>
  permissionCache?: Map<string, { resource: string; action: string; granted: boolean }[]>
  /** Set true when the request comes from a WebSocket subscription (no Express req) */
  isSubscription?: boolean
}
