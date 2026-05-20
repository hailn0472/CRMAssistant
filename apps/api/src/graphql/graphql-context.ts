import type { JwtPayload } from '../auth/strategies/jwt.strategy'

export type GraphqlContext = {
  user?: JwtPayload
}
